import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// Exercises the real FOR UPDATE SKIP LOCKED claim against Postgres. Writes + cleans
// up test rows, so it only runs when explicitly opted in:
//   RUN_DB_TESTS=1 DATABASE_URL=... npx vitest run tests/monitoring-queue.test.ts
const enabled = process.env.RUN_DB_TESTS === '1' && !!process.env.DATABASE_URL

describe.skipIf(!enabled)('monitoring queue (SKIP LOCKED)', () => {
  let query: typeof import('@/lib/db').query
  let claimMonitoringJob: typeof import('@/lib/monitoring/queue').claimMonitoringJob
  let enqueueMonitoringJob: typeof import('@/lib/monitoring/queue').enqueueMonitoringJob
  let merchantId: number, websiteId: number, agentId: number

  beforeAll(async () => {
    ;({ query } = await import('@/lib/db'))
    ;({ claimMonitoringJob, enqueueMonitoringJob } = await import('@/lib/monitoring/queue'))
    const m = await query<{ id: number }>(
      `INSERT INTO merchants (email, password_hash, full_name) VALUES ($1,'x','QueueTest') RETURNING id`,
      [`queue-test-${Date.now()}@example.test`]
    )
    merchantId = m[0].id
    const w = await query<{ id: number }>(
      `INSERT INTO monitored_websites (merchant_id, name, url) VALUES ($1,'qt','https://example.com') RETURNING id`,
      [merchantId]
    )
    websiteId = w[0].id
    const a = await query<{ id: number }>(
      `INSERT INTO monitoring_agents (name, kind, status) VALUES ('qt-agent','remote','active') RETURNING id`
    )
    agentId = a[0].id
  })

  afterAll(async () => {
    if (!enabled) return
    await query('DELETE FROM monitoring_jobs WHERE website_id = $1', [websiteId])
    await query('DELETE FROM monitoring_agents WHERE id = $1', [agentId])
    await query('DELETE FROM merchants WHERE id = $1', [merchantId]) // cascades website
  })

  it('never hands the same job to two concurrent claimers', async () => {
    const N = 12
    for (let i = 0; i < N; i++) await enqueueMonitoringJob(websiteId, null)

    // Fire many claims concurrently (simulating a fleet polling at once).
    const claims = await Promise.all(Array.from({ length: N + 4 }, () => claimMonitoringJob(agentId)))
    const ids = claims.filter(Boolean).map(j => j!.id)

    expect(ids.length).toBe(N)                       // all jobs claimed
    expect(new Set(ids).size).toBe(ids.length)       // each exactly once (no double-claim)
    expect(claims.filter(j => j === null).length).toBe(4) // extra pollers got nothing
  })
})
