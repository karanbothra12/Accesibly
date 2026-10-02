import { query, queryOne } from '@/lib/db'
import { notifyMerchant } from '@/lib/email'
import { isRegression, regressionSummary, MONITOR_TYPE_LABEL, type RunMetrics } from '@/lib/monitors'

// ── Scheduled-monitoring runner (driven by the background worker) ──
// enqueueDueMonitors() turns due schedules into queued crawl_jobs; the worker
// drains them like any audit; finalizeMonitorJob() then compares the result to
// the previous baseline and emails the merchant on a regression.

function withScheme(domain: string): string {
  if (/^https?:\/\//i.test(domain)) return domain
  const host = domain.split('/')[0].toLowerCase()
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|.+\.local(host)?)(:\d+)?$/.test(host)
  return (isLocal ? 'http://' : 'https://') + domain
}

// Create crawl jobs for every schedule that is due, then advance its next run.
// Skips a schedule that already has an unfinished job so runs never pile up.
export async function enqueueDueMonitors(): Promise<number> {
  const due = await query<{ id: number; site_id: number; job_type: string; domain: string }>(
    `SELECT ms.id, ms.site_id, ms.job_type, s.domain
       FROM monitor_schedules ms
       JOIN sites s ON s.id = ms.site_id
       JOIN merchants m ON m.id = s.merchant_id
      WHERE ms.enabled = TRUE AND ms.next_run_at <= NOW()
        AND s.is_active = TRUE AND m.is_active = TRUE
      ORDER BY ms.next_run_at ASC
      LIMIT 100`
  )

  let created = 0
  for (const s of due) {
    const pending = await queryOne<{ id: number }>(
      `SELECT id FROM crawl_jobs WHERE monitor_schedule_id = $1 AND status IN ('queued','running') LIMIT 1`,
      [s.id]
    )
    if (!pending) {
      const mode = s.job_type === 'security' ? 'single' : 'full'
      await query(
        `INSERT INTO crawl_jobs (site_id, mode, start_url, max_pages, status, ruleset, seo_enabled, job_type, monitor_schedule_id)
         VALUES ($1, $2, $3, $4, 'queued', 'default', $5, $6, $7)`,
        [s.site_id, mode, withScheme(s.domain), 25, s.job_type === 'seo', s.job_type, s.id]
      )
      created++
    }
    // Advance the schedule regardless, so a skipped (still-running) cycle doesn't
    // immediately re-fire on the next tick.
    await query(
      `UPDATE monitor_schedules
         SET last_run_at = NOW(), next_run_at = NOW() + make_interval(days => interval_days), updated_at = NOW()
       WHERE id = $1`,
      [s.id]
    )
  }
  return created
}

// After a monitor-created job finishes: compare to baseline, alert on regression,
// and store the new baseline. No-op for non-monitor jobs.
export async function finalizeMonitorJob(jobId: number): Promise<void> {
  const job = await queryOne<{ monitor_schedule_id: number | null; job_type: string; total_issues: number; seo_score: number | null; status: string }>(
    `SELECT monitor_schedule_id, job_type, total_issues, seo_score, status FROM crawl_jobs WHERE id = $1`,
    [jobId]
  )
  if (!job || job.monitor_schedule_id == null || job.status !== 'done') return

  const sched = await queryOne<{ last_issues: number | null; last_score: number | null; site_id: number }>(
    `SELECT last_issues, last_score, site_id FROM monitor_schedules WHERE id = $1`,
    [job.monitor_schedule_id]
  )
  if (!sched) return

  const prev: RunMetrics | null =
    sched.last_issues == null && sched.last_score == null ? null : { issues: sched.last_issues ?? 0, score: sched.last_score }
  const next: RunMetrics = { issues: job.total_issues, score: job.seo_score }

  if (prev && isRegression(prev, next)) {
    const owner = await queryOne<{ merchant_id: number; domain: string }>(
      'SELECT merchant_id, domain FROM sites WHERE id = $1',
      [sched.site_id]
    )
    if (owner) {
      const label = MONITOR_TYPE_LABEL[job.job_type] || 'Audit'
      await notifyMerchant(
        owner.merchant_id,
        'monitor_alert',
        `⚠ ${label} regressed on ${owner.domain}`,
        `<p>Scheduled <b>${label}</b> monitoring for <b>${owner.domain}</b> detected a regression: ${regressionSummary(prev, next)}.</p>
         <p>Open your Accessly dashboard to review the new findings.</p>`
      )
    }
  }

  await query(
    'UPDATE monitor_schedules SET last_issues = $2, last_score = $3, updated_at = NOW() WHERE id = $1',
    [job.monitor_schedule_id, job.total_issues, job.seo_score]
  )
}
