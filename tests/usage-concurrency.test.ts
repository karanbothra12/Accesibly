import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { consumeAuditSlot, getUsage, periodKeys } from '@/lib/entitlements'
import pool, { query, queryOne } from '@/lib/db'

// These exercise the atomic, race-safe usage counter against a real database.
// Skipped automatically when no DATABASE_URL is configured (e.g. CI without a DB).
const hasDb = !!process.env.DATABASE_URL

describe.skipIf(!hasDb)('consumeAuditSlot (atomic concurrency)', () => {
  let merchantId: number

  beforeAll(async () => {
    const m = await queryOne<{ id: number }>(
      `INSERT INTO merchants (email, password_hash, full_name, plan)
       VALUES ($1, 'x', 'Concurrency Test', 'starter') RETURNING id`,
      [`vitest+${Date.now()}@example.test`]
    )
    merchantId = m!.id
  })

  afterAll(async () => {
    if (merchantId) {
      await query(`DELETE FROM usage_ledger WHERE merchant_id = $1`, [merchantId])
      await query(`DELETE FROM merchants WHERE id = $1`, [merchantId])
    }
    await pool.end()
  })

  it('never lets concurrent requests exceed the daily limit', async () => {
    const DAILY = 3
    const ATTEMPTS = 12
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () => consumeAuditSlot(merchantId, DAILY, 1000))
    )
    const granted = results.filter(r => r.ok).length
    expect(granted).toBe(DAILY)

    // The persisted counter must match exactly what was granted — no over-count.
    const usage = await getUsage(merchantId)
    expect(usage.day).toBe(DAILY)
    expect(usage.month).toBe(DAILY)

    // Every rejection must be attributed to the daily scope.
    for (const r of results) {
      if (!r.ok) expect(r.scope).toBe('day')
    }
  })

  it('enforces the monthly limit independently of the daily limit', async () => {
    // Fresh merchant so day usage starts clean.
    const m = await queryOne<{ id: number }>(
      `INSERT INTO merchants (email, password_hash, full_name, plan)
       VALUES ($1, 'x', 'Monthly Test', 'starter') RETURNING id`,
      [`vitest-month+${Date.now()}@example.test`]
    )
    const id = m!.id
    try {
      const MONTHLY = 2
      const results = await Promise.all(
        Array.from({ length: 6 }, () => consumeAuditSlot(id, 1000, MONTHLY))
      )
      expect(results.filter(r => r.ok).length).toBe(MONTHLY)
      const usage = await getUsage(id)
      expect(usage.month).toBe(MONTHLY)
      for (const r of results) {
        if (!r.ok) expect(r.scope).toBe('month')
      }
    } finally {
      await query(`DELETE FROM usage_ledger WHERE merchant_id = $1`, [id])
      await query(`DELETE FROM merchants WHERE id = $1`, [id])
    }
  })

  it('treats -1 as unlimited', async () => {
    const m = await queryOne<{ id: number }>(
      `INSERT INTO merchants (email, password_hash, full_name, plan)
       VALUES ($1, 'x', 'Unlimited Test', 'enterprise') RETURNING id`,
      [`vitest-unl+${Date.now()}@example.test`]
    )
    const id = m!.id
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => consumeAuditSlot(id, -1, -1))
      )
      expect(results.every(r => r.ok)).toBe(true)
      const usage = await getUsage(id)
      expect(usage.day).toBe(8)
      // Sanity: the period key we counted under is the current UTC day.
      expect(periodKeys().day.startsWith('day:')).toBe(true)
    } finally {
      await query(`DELETE FROM usage_ledger WHERE merchant_id = $1`, [id])
      await query(`DELETE FROM merchants WHERE id = $1`, [id])
    }
  })
})
