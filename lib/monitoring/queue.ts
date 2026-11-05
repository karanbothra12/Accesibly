import { query, queryOne } from '@/lib/db'

// ── Monitoring job queue (multi-agent safe) ───────────────────────────────────
// Unlike crawl_jobs (serial, single worker, conditional-UPDATE claim), the agent
// fleet polls this concurrently, so we claim with FOR UPDATE SKIP LOCKED inside a
// single atomic statement: the inner SELECT locks one unlocked queued row and the
// outer UPDATE flips it to 'running' and bumps attempts — no two agents get the
// same job. Leases are recovered by time (requeueStalledMonitoringJobs), and a job
// that exhausts max_attempts becomes 'dead' (dead-letter).

export type ClaimedJob = {
  id: string
  website_id: number
  job_type: string
  payload: Record<string, unknown> | null
  attempts: number
  max_attempts: number
}

// Atomically claim the next due job for this agent (or any unassigned job).
export async function claimMonitoringJob(agentId: number): Promise<ClaimedJob | null> {
  return queryOne<ClaimedJob>(
    `UPDATE monitoring_jobs j
     SET status = 'running', locked_at = NOW(), locked_by = $1, attempts = attempts + 1
     WHERE j.id = (
       SELECT id FROM monitoring_jobs
       WHERE status = 'queued' AND scheduled_at <= NOW()
         AND (agent_id IS NULL OR agent_id = $1)
       ORDER BY priority DESC, scheduled_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING j.id::text, j.website_id, j.job_type, j.payload, j.attempts, j.max_attempts`,
    [agentId]
  )
}

export async function completeMonitoringJob(jobId: string | number, agentId: number): Promise<void> {
  await query(
    `UPDATE monitoring_jobs SET status = 'done', completed_at = NOW(), locked_at = NULL
     WHERE id = $1 AND status = 'running' AND locked_by = $2`,
    [jobId, agentId]
  )
}

// Fail a running job: dead-letter once attempts are exhausted, else re-queue with
// a short linear backoff so a flapping target doesn't hot-loop.
export async function failMonitoringJob(jobId: string | number, agentId: number, error: string): Promise<void> {
  await query(
    `UPDATE monitoring_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
         locked_at = NULL, locked_by = NULL,
         scheduled_at = CASE WHEN attempts >= max_attempts THEN scheduled_at
                             ELSE NOW() + make_interval(secs => 30 * attempts) END,
         last_error = $3,
         completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END
     WHERE id = $1 AND status = 'running' AND locked_by = $2`,
    [jobId, agentId, error.slice(0, 1000)]
  )
}

// Recover jobs whose agent died mid-run (lease expired). Returns count recovered.
export async function requeueStalledMonitoringJobs(leaseSeconds = 90): Promise<number> {
  const rows = await query<{ id: string }>(
    `UPDATE monitoring_jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
         locked_at = NULL, locked_by = NULL,
         last_error = COALESCE(last_error, 'lease expired')
     WHERE status = 'running' AND locked_at < NOW() - make_interval(secs => $1)
     RETURNING id`,
    [leaseSeconds]
  )
  return rows.length
}

// Insert a job. agentId null = any agent may claim it.
export async function enqueueMonitoringJob(
  websiteId: number,
  agentId: number | null,
  payload: Record<string, unknown> = {},
  jobType = 'http_check'
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO monitoring_jobs (website_id, agent_id, job_type, payload)
     VALUES ($1, $2, $3, $4) RETURNING id::text`,
    [websiteId, agentId, jobType, JSON.stringify(payload)]
  )
  return row!.id
}
