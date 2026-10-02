/**
 * Standalone crawl worker.
 *
 * Runs OUTSIDE Vercel (Railway / Fly / Render / any container or VM) as a
 * long-lived process, so full-site crawls are not bound by a serverless
 * function's maxDuration. It polls the database for queued crawl jobs and runs
 * them to completion using the exact same runner the web app uses.
 *
 * Deploy:
 *   1. Provide the same env as the web app (DATABASE_URL, VNU_URL,
 *      CSS_VALIDATOR_URL, INTERNAL_TOKEN, RESEND_API_KEY, …).
 *   2. npm ci  &&  npx playwright install --with-deps chromium
 *   3. npm run worker
 *   4. On the Vercel web app, set CRAWL_WORKER_ENABLED=1 so it stops running
 *      crawls in-process and leaves them queued for this worker.
 *
 * Locally you can load env with Node's flag:  tsx --env-file=.env.local worker/crawl-worker.ts
 */
import { nextQueuedCrawlJobId, requeueStalledCrawlJobs, processCrawlJob } from '@/lib/audit-runner'
import { enqueueDueMonitors, finalizeMonitorJob } from '@/lib/monitor-runner'

const POLL_MS = Number(process.env.WORKER_POLL_MS || 5000)
const STALL_MINUTES = Number(process.env.WORKER_STALL_MINUTES || 15)

let running = true
let draining = false

function log(...args: unknown[]) {
  console.log(new Date().toISOString(), '[crawl-worker]', ...args)
}

async function drainQueue(): Promise<void> {
  // Recover anything a previous (crashed) worker left mid-flight.
  try {
    const recovered = await requeueStalledCrawlJobs(STALL_MINUTES)
    if (recovered > 0) log(`requeued ${recovered} stalled job(s)`)
  } catch (err) {
    log('stalled-requeue error', err)
  }

  // Turn any due monitoring schedules into queued jobs before draining.
  try {
    const queued = await enqueueDueMonitors()
    if (queued > 0) log(`enqueued ${queued} scheduled monitor(s)`)
  } catch (err) {
    log('monitor-enqueue error', err)
  }

  // Process queued jobs one at a time until the queue is empty.
  let id = await nextQueuedCrawlJobId()
  while (id != null && running) {
    log(`processing job ${id}…`)
    const started = Date.now()
    try {
      const result = await processCrawlJob(id)
      log(`job ${id} finished in ${Math.round((Date.now() - started) / 1000)}s`, result)
      // Monitor jobs: compare to baseline and alert on regression (no-op otherwise).
      await finalizeMonitorJob(id)
    } catch (err) {
      // processCrawlJob already marks the job failed + logs; this is a backstop.
      log(`job ${id} threw`, err)
    }
    if (!running) break
    id = await nextQueuedCrawlJobId()
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    log('FATAL: DATABASE_URL is not set')
    process.exit(1)
  }
  log(`started — polling every ${POLL_MS}ms, stall recovery at ${STALL_MINUTES}m`)

  while (running) {
    draining = true
    try {
      await drainQueue()
    } catch (err) {
      log('drain error', err)
    } finally {
      draining = false
    }
    if (!running) break
    await new Promise(r => setTimeout(r, POLL_MS))
  }
  log('stopped')
  process.exit(0)
}

// Graceful shutdown: stop accepting new jobs; the in-flight job finishes (or is
// recovered by stalled-requeue on the next start).
function shutdown(sig: string) {
  log(`received ${sig} — shutting down after the current job${draining ? ' (draining)' : ''}`)
  running = false
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

main().catch(err => {
  log('fatal', err)
  process.exit(1)
})
