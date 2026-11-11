/**
 * One-shot Internet-Monitoring tick for scheduled runners (GitHub Actions cron,
 * external cron, etc.) — no long-lived process or paid host needed.
 *
 * Runs a single cycle as the central agent: recover stalled jobs → schedule due
 * checks → run them (DNS/TCP/TLS/TTFB) → detect/resolve incidents, then exits.
 * Measurements originate from wherever this runs (e.g. the GitHub runner).
 *
 * Env: DATABASE_URL (required), IPINFO_TOKEN (optional, for ISP/ASN),
 *      AUDIT_USER_AGENT (optional).
 *
 * Run:  DATABASE_URL=… npx tsx worker/monitor-tick.ts
 */
import { runMonitoringTick } from '@/lib/monitoring/scheduler'

;(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('[monitor-tick] FATAL: DATABASE_URL is not set')
    process.exit(1)
  }
  const t0 = Date.now()
  const result = await runMonitoringTick()
  console.log(`[monitor-tick] ${JSON.stringify(result)} in ${Date.now() - t0}ms`)
  process.exit(0)
})().catch(e => {
  console.error('[monitor-tick] error', e instanceof Error ? e.message : e)
  process.exit(1)
})
