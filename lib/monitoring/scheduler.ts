import { query, queryOne } from '@/lib/db'
import { runHttpCheck } from '@/lib/monitoring/synthetic'
import {
  claimMonitoringJob, completeMonitoringJob, failMonitoringJob,
  requeueStalledMonitoringJobs, enqueueMonitoringJob,
} from '@/lib/monitoring/queue'
import { ensureCentralAgent, saveSyntheticResult } from '@/lib/monitoring/agents'
import { runDiagnostic, type DiagKind } from '@/lib/monitoring/diagnostics'
import { detectIncidents } from '@/lib/monitoring/incidents'
import { enrichIp } from '@/lib/monitoring/geoip'

// Add location + ISP/ASN to each public traceroute hop (best-effort, cached).
async function enrichHops(summary: Record<string, unknown> | null): Promise<Record<string, unknown> | null> {
  if (!summary || !Array.isArray(summary.hops)) return summary
  const isPriv = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)
  const hops = summary.hops as { hop: number; host: string; rttMs: number | null }[]
  const out = []
  for (const h of hops) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(h.host) || isPriv(h.host)) {
      out.push({ ...h, private: /^\d/.test(h.host) && isPriv(h.host) })
      continue
    }
    const intel = await enrichIp(h.host).catch(() => null)
    out.push({ ...h, city: intel?.city ?? null, country: intel?.countryCode ?? null, isp: intel?.isp ?? null, asn: intel?.asn ?? null })
  }
  return { ...summary, hops: out }
}

// ── Monitoring scheduler + central-agent processor ────────────────────────────
// Mirrors lib/monitor-runner.ts but with MINUTE cadences (1/5/10/15/30). Turns due
// monitored_websites into monitoring_jobs (one per selected agent, or one
// unassigned job any agent can claim), de-duped so a slow agent can't pile up work.

type DueWebsite = { id: number; agent_ids: number[] }

export async function enqueueDueMonitoringChecks(): Promise<number> {
  const due = await query<DueWebsite>(
    `SELECT mw.id, mw.agent_ids
     FROM monitored_websites mw
     JOIN merchants m ON m.id = mw.merchant_id
     WHERE mw.enabled = TRUE AND mw.verified = TRUE AND m.is_active = TRUE
       AND mw.next_run_at <= NOW()
     ORDER BY mw.next_run_at ASC
     LIMIT 200`
  )

  let created = 0
  for (const w of due) {
    const agentIds = Array.isArray(w.agent_ids) ? w.agent_ids : []
    const targets: (number | null)[] = agentIds.length ? agentIds : [null]
    for (const aid of targets) {
      // No pile-up: skip if a job for this (website, agent) is still pending.
      const pending = await queryOne<{ one: number }>(
        `SELECT 1 AS one FROM monitoring_jobs
         WHERE website_id = $1 AND status IN ('queued','running')
           AND (($2::int IS NULL AND agent_id IS NULL) OR agent_id = $2)
         LIMIT 1`,
        [w.id, aid]
      )
      if (!pending) { await enqueueMonitoringJob(w.id, aid); created++ }
    }
    // Advance the next run regardless (so one failure doesn't stall the cadence).
    await query(
      `UPDATE monitored_websites
       SET next_run_at = NOW() + make_interval(mins => frequency_minutes), updated_at = NOW()
       WHERE id = $1`,
      [w.id]
    )
  }
  return created
}

type JobWebsite = { url: string; expected_status: number; timeout_ms: number; origin_host: string | null }

// Build a direct-to-origin URL (same protocol + path, but the origin host the
// merchant configured) so we can time the origin without the CDN in front.
function originUrlFor(url: string, originHost: string): string | null {
  try {
    const u = new URL(url)
    const o = originHost.includes('://') ? new URL(originHost) : new URL(`${u.protocol}//${originHost}`)
    return `${o.protocol}//${o.host}${u.pathname}${u.search}`
  } catch { return null }
}

// Run queued jobs as the in-process central agent (the worker = agent #1).
export async function drainCentralMonitoringJobs(agentId: number, max = 50): Promise<number> {
  // The central agent's own network dimensions (so its results carry ISP/ASN too).
  const dims = await queryOne<{ country_code: string | null; isp: string | null; asn: number | null }>(
    'SELECT country_code, isp, asn FROM monitoring_agents WHERE id = $1', [agentId]
  ) || { country_code: null, isp: null, asn: null }

  let done = 0
  for (let i = 0; i < max; i++) {
    const job = await claimMonitoringJob(agentId)
    if (!job) break
    try {
      const w = await queryOne<JobWebsite>(
        `SELECT url, expected_status, timeout_ms, origin_host FROM monitored_websites WHERE id = $1`,
        [job.website_id]
      )
      if (!w) { await failMonitoringJob(job.id, agentId, 'website no longer exists'); continue }

      if (job.job_type === 'diagnostic') {
        const kind = ((job.payload?.kind as string) || 'ping') as DiagKind
        const diag = await runDiagnostic(kind, w.url)
        const summary = kind === 'traceroute' ? await enrichHops(diag.summary) : diag.summary
        await query(
          `INSERT INTO network_diagnostics (website_id, agent_id, job_id, kind, target, success, summary, raw, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [job.website_id, agentId, job.id, diag.kind, diag.target, diag.success,
           summary ? JSON.stringify(summary) : null, diag.raw, diag.error]
        )
        await completeMonitoringJob(job.id, agentId)
        done++
        continue
      }

      const result = await runHttpCheck(w.url, { expectedStatus: w.expected_status, timeoutMs: w.timeout_ms })

      // Edge-vs-origin: if an origin host is configured, time it directly too.
      let origin = null
      if (w.origin_host) {
        const ou = originUrlFor(w.url, w.origin_host)
        if (ou) {
          const o = await runHttpCheck(ou, { timeoutMs: w.timeout_ms }).catch(() => null)
          if (o) origin = { totalMs: o.totalMs, ttfbMs: o.ttfbMs, available: o.available }
        }
      }

      await saveSyntheticResult(job.website_id, agentId, job.id, result,
        { countryCode: dims.country_code, isp: dims.isp, asn: dims.asn }, origin)
      await completeMonitoringJob(job.id, agentId)
      done++
    } catch (e) {
      await failMonitoringJob(job.id, agentId, e instanceof Error ? e.message : String(e))
    }
  }
  return done
}

// One full monitoring tick for the worker: recover leases, schedule, drain,
// then detect/resolve incidents (which fires alerts).
export async function runMonitoringTick(leaseSeconds = 90): Promise<{ recovered: number; enqueued: number; processed: number; incidentsOpened: number; incidentsResolved: number }> {
  const recovered = await requeueStalledMonitoringJobs(leaseSeconds)
  const enqueued = await enqueueDueMonitoringChecks()
  const agentId = await ensureCentralAgent()
  const processed = await drainCentralMonitoringJobs(agentId)
  const inc = await detectIncidents()
  return { recovered, enqueued, processed, incidentsOpened: inc.opened, incidentsResolved: inc.resolved }
}
