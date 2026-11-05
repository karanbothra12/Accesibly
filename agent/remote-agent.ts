/**
 * Accessly remote monitoring agent.
 *
 * Runs on a VPS in a target location/network, polls the central API for jobs,
 * runs the synthetic HTTP check locally (so timing reflects THIS network), and
 * posts results back. It authenticates with a per-agent bearer token and never
 * touches the database directly.
 *
 * Reuses the exact same measurement engine as the central agent
 * (lib/monitoring/synthetic.ts), so timings are consistent fleet-wide.
 *
 * Env:
 *   MONITORING_API_URL   e.g. https://accesibly.vercel.app   (required)
 *   AGENT_TOKEN          the token shown once at registration (required)
 *   AGENT_POLL_MS        default 5000
 *   AGENT_HEARTBEAT_MS   default 30000
 *
 * Run:  AGENT_TOKEN=… MONITORING_API_URL=… npm run agent
 */
import { runHttpCheck } from '@/lib/monitoring/synthetic'

const API = (process.env.MONITORING_API_URL || '').replace(/\/$/, '')
const TOKEN = process.env.AGENT_TOKEN || ''
const POLL_MS = Number(process.env.AGENT_POLL_MS || 5000)
const HEARTBEAT_MS = Number(process.env.AGENT_HEARTBEAT_MS || 30000)

let running = true
let failed = 0

function log(...a: unknown[]) { console.log(new Date().toISOString(), '[agent]', ...a) }
const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

async function heartbeat(): Promise<void> {
  try {
    await fetch(`${API}/api/internet-monitoring/agent/heartbeat`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ failed_jobs: failed }),
    })
  } catch (e) { log('heartbeat failed', e instanceof Error ? e.message : e) }
}

async function pollOnce(): Promise<boolean> {
  const res = await fetch(`${API}/api/internet-monitoring/agent/poll`, { headers: auth })
  if (!res.ok) { log('poll error', res.status); return false }
  const { job } = await res.json()
  if (!job) return false

  const result = await runHttpCheck(job.url, { expectedStatus: job.expected_status, timeoutMs: job.timeout_ms })
  if (!result.available) failed++
  await fetch(`${API}/api/internet-monitoring/agent/results`, {
    method: 'POST', headers: auth, body: JSON.stringify({ job_id: job.id, result }),
  })
  log(`checked ${job.url} → ${result.available ? 'up' : 'down'} (${result.totalMs ? Math.round(result.totalMs) + 'ms' : result.errorType})`)
  return true
}

async function main(): Promise<void> {
  if (!API || !TOKEN) { log('FATAL: MONITORING_API_URL and AGENT_TOKEN are required'); process.exit(1) }
  log(`started → ${API} (poll ${POLL_MS}ms, heartbeat ${HEARTBEAT_MS}ms)`)
  await heartbeat()
  const hb = setInterval(heartbeat, HEARTBEAT_MS)

  while (running) {
    try {
      // Drain everything currently available, then sleep.
      let had = false
      while (running && (await pollOnce())) had = true
      if (!had) await new Promise(r => setTimeout(r, POLL_MS))
    } catch (e) {
      log('loop error', e instanceof Error ? e.message : e)
      await new Promise(r => setTimeout(r, POLL_MS))
    }
  }
  clearInterval(hb)
  process.exit(0)
}

function shutdown(sig: string) { log(`received ${sig} — stopping`); running = false }
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main().catch(e => { log('fatal', e); process.exit(1) })
