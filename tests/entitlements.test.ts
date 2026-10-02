import { describe, it, expect } from 'vitest'
import {
  calculateOverage,
  checkPages,
  remaining,
  getLimit,
  periodKeys,
  type Entitlements,
} from '@/lib/entitlements'

// Build a minimal entitlements object for decision-logic tests.
function ent(over: Partial<Entitlements> = {}): Entitlements {
  return {
    plan: {
      id: 1, key: 'starter', name: 'Starter', description: null,
      price_cents: 1900, price_yearly_cents: 19000, currency: 'USD', billing_period: 'monthly',
      is_active: true, is_archived: false, sort_order: 0,
      page_overage_enabled: false, extra_page_price_cents: 5,
    },
    features: { website_audit: true },
    limits: { pages_per_audit: 100, daily_audits: 1, monthly_audits: 5 },
    overage: { enabled: false, pricePerPageCents: 5 },
    billingInterval: 'monthly',
    ...over,
  }
}

describe('getLimit', () => {
  it('reads a configured limit', () => {
    expect(getLimit(ent(), 'pages_per_audit')).toBe(100)
  })
  it('defaults missing limits to 0 (deny by default)', () => {
    expect(getLimit(ent(), 'nonexistent')).toBe(0)
  })
})

describe('remaining', () => {
  it('computes remaining and clamps at 0', () => {
    expect(remaining(5, 2)).toBe(3)
    expect(remaining(5, 9)).toBe(0)
  })
  it('returns null for unlimited (-1)', () => {
    expect(remaining(-1, 999)).toBeNull()
  })
})

describe('calculateOverage', () => {
  it('is zero when within the included allowance', () => {
    const o = calculateOverage(100, 80, 5)
    expect(o.extraPages).toBe(0)
    expect(o.extraCostCents).toBe(0)
  })
  it('charges per extra page beyond the allowance', () => {
    const o = calculateOverage(100, 130, 5)
    expect(o.extraPages).toBe(30)
    expect(o.extraCostCents).toBe(150)
  })
  it('never goes negative', () => {
    const o = calculateOverage(100, 50, 5)
    expect(o.extraPages).toBe(0)
  })
})

describe('checkPages', () => {
  it('allows requests within the page limit', () => {
    const r = checkPages(ent(), 50, false)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.includedPages).toBe(100)
      expect(r.extraPages).toBe(0)
      expect(r.extraCostCents).toBe(0)
    }
  })

  it('treats unlimited pages_per_audit as always allowed', () => {
    const r = checkPages(ent({ limits: { pages_per_audit: -1 } }), 4000, false)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.includedPages).toBe(4000)
      expect(r.extraPages).toBe(0)
    }
  })

  it('rejects over-limit requests when overage is disabled', () => {
    const r = checkPages(ent(), 150, false)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(402)
      expect(r.body.code).toBe('PAGE_LIMIT_EXCEEDED')
      expect(r.body.overageAllowed).toBe(false)
    }
  })

  it('asks for confirmation when overage is enabled but not confirmed', () => {
    const r = checkPages(
      ent({ overage: { enabled: true, pricePerPageCents: 5 } }),
      150, false,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(402)
      expect(r.body.code).toBe('PAGE_LIMIT_EXCEEDED')
      expect(r.body.confirmationRequired).toBe(true)
      expect(r.body.extraPages).toBe(50)
      expect(r.body.extraCost).toBe(2.5) // 50 * 5c = 250c = $2.50
    }
  })

  it('authorizes overage once confirmed, computing the extra cost', () => {
    const r = checkPages(
      ent({ overage: { enabled: true, pricePerPageCents: 5 } }),
      150, true,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.includedPages).toBe(100)
      expect(r.extraPages).toBe(50)
      expect(r.extraCostCents).toBe(250)
    }
  })

  it('does not authorize overage on confirm when overage is disabled', () => {
    // Even with confirm=true, a plan without overage must be rejected.
    const r = checkPages(ent(), 150, true)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.body.overageAllowed).toBe(false)
  })
})

describe('periodKeys', () => {
  it('derives UTC day and month keys (timezone-independent)', () => {
    const d = new Date('2026-09-17T23:30:00Z')
    const k = periodKeys(d)
    expect(k.day).toBe('day:2026-09-17')
    expect(k.month).toBe('month:2026-09')
  })
  it('uses UTC, not local time, at day boundaries', () => {
    // 2026-01-01T00:30Z is still Jan 1 in UTC regardless of the host timezone.
    const k = periodKeys(new Date('2026-01-01T00:30:00Z'))
    expect(k.day).toBe('day:2026-01-01')
    expect(k.month).toBe('month:2026-01')
  })
})
