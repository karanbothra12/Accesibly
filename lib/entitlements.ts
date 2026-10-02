import pool, { query, queryOne } from '@/lib/db'

// ── Centralized entitlement / usage / overage layer ──────────────
// The ONE source of truth for plan rules. Nothing plan-specific is hardcoded;
// everything is read from the SuperAdmin-configured plans/features/limits tables.

export type BillingInterval = 'monthly' | 'yearly'

export type Plan = {
  id: number; key: string; name: string; description: string | null
  price_cents: number; price_yearly_cents: number; currency: string; billing_period: string
  is_active: boolean; is_archived: boolean; sort_order: number
  page_overage_enabled: boolean; extra_page_price_cents: number
}

export type Entitlements = {
  plan: Plan
  features: Record<string, boolean>
  limits: Record<string, number>        // -1 = unlimited
  overage: { enabled: boolean; pricePerPageCents: number }
  // The subscriber's chosen cadence. Overage is always billed monthly regardless.
  billingInterval: BillingInterval
}

const UNLIMITED = -1

// Resolve a merchant's active plan: subscription → merchants.plan key → 'starter'.
export async function getUserPlan(merchantId: number): Promise<Plan | null> {
  return (
    (await queryOne<Plan>(
      `SELECT p.* FROM plans p JOIN subscriptions s ON s.plan_id = p.id WHERE s.merchant_id = $1`,
      [merchantId]
    )) ||
    (await queryOne<Plan>(
      `SELECT p.* FROM plans p WHERE p.key = (SELECT plan FROM merchants WHERE id = $1)`,
      [merchantId]
    )) ||
    (await queryOne<Plan>(`SELECT * FROM plans WHERE key = 'starter'`))
  )
}

export async function getEntitlements(merchantId: number): Promise<Entitlements | null> {
  const plan = await getUserPlan(merchantId)
  if (!plan) return null
  const [featRows, limitRows, sub] = await Promise.all([
    query<{ feature_key: string; enabled: boolean }>('SELECT feature_key, enabled FROM plan_features WHERE plan_id = $1', [plan.id]),
    query<{ limit_key: string; limit_value: number }>('SELECT limit_key, limit_value FROM plan_limits WHERE plan_id = $1', [plan.id]),
    queryOne<{ billing_interval: string }>('SELECT billing_interval FROM subscriptions WHERE merchant_id = $1', [merchantId]),
  ])
  const features: Record<string, boolean> = {}
  for (const r of featRows) features[r.feature_key] = r.enabled
  const limits: Record<string, number> = {}
  for (const r of limitRows) limits[r.limit_key] = Number(r.limit_value)
  // Only offer yearly if the plan actually has a yearly price configured.
  const interval: BillingInterval =
    sub?.billing_interval === 'yearly' && plan.price_yearly_cents > 0 ? 'yearly' : 'monthly'
  return {
    plan,
    features,
    limits,
    overage: { enabled: plan.page_overage_enabled, pricePerPageCents: plan.extra_page_price_cents },
    billingInterval: interval,
  }
}

// Switch the merchant's own plan (self-serve upgrade/downgrade). Validates the
// target plan is active + not archived, then updates the subscription (source of
// truth) and keeps merchants.plan in sync. No payment provider is wired up yet.
export async function setUserPlan(merchantId: number, planKey: string): Promise<{ ok: boolean; error?: string }> {
  const plan = await queryOne<{ id: number }>(
    'SELECT id FROM plans WHERE key = $1 AND is_active = TRUE AND is_archived = FALSE', [planKey]
  )
  if (!plan) return { ok: false, error: 'Plan not available' }
  await query('UPDATE merchants SET plan = $1 WHERE id = $2', [planKey, merchantId])
  await query(
    `INSERT INTO subscriptions (merchant_id, plan_id) VALUES ($1, $2)
     ON CONFLICT (merchant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = NOW()`,
    [merchantId, plan.id]
  )
  return { ok: true }
}

// Persist a subscriber's billing cadence. Yearly is only allowed when the plan
// offers a yearly price. Ensures a subscription row exists (backfill safety).
export async function setBillingInterval(merchantId: number, interval: BillingInterval): Promise<BillingInterval> {
  const plan = await getUserPlan(merchantId)
  const effective: BillingInterval = interval === 'yearly' && (plan?.price_yearly_cents ?? 0) > 0 ? 'yearly' : 'monthly'
  await query(
    `INSERT INTO subscriptions (merchant_id, plan_id, billing_interval)
       VALUES ($1, $2, $3)
     ON CONFLICT (merchant_id) DO UPDATE SET billing_interval = EXCLUDED.billing_interval, updated_at = NOW()`,
    [merchantId, plan?.id ?? null, effective]
  )
  return effective
}

export async function hasFeature(merchantId: number, featureKey: string): Promise<boolean> {
  const ent = await getEntitlements(merchantId)
  return !!ent?.features[featureKey]
}

// Resolve a site's plan-feature flags by site_key in one query — for the public
// widget/RUM endpoints, which enforce entitlements server-side (can't be bypassed
// by loading the script). Plan resolves via subscription, else merchants.plan.
export async function siteEntitlement(siteKey: string): Promise<
  { siteId: number; isActive: boolean; rumEnabled: boolean; hasWidget: boolean; hasRum: boolean; widgetPosition: string; widgetHidden: boolean } | null
> {
  const row = await queryOne<{
    site_id: number; is_active: boolean; rum_enabled: boolean; has_widget: boolean; has_rum: boolean
    widget_position: string; widget_hidden: boolean
  }>(
    `SELECT s.id AS site_id, s.is_active, s.rum_enabled, s.widget_position, s.widget_hidden,
       COALESCE(bool_or(pf.enabled) FILTER (WHERE pf.feature_key = 'accessibility_widget'), FALSE) AS has_widget,
       COALESCE(bool_or(pf.enabled) FILTER (WHERE pf.feature_key = 'rum_monitoring'),       FALSE) AS has_rum
     FROM sites s
     JOIN merchants m ON m.id = s.merchant_id
     LEFT JOIN subscriptions sub ON sub.merchant_id = m.id
     LEFT JOIN plan_features pf ON pf.plan_id = COALESCE(sub.plan_id, (SELECT id FROM plans WHERE key = m.plan))
     WHERE s.site_key = $1 AND m.is_active = TRUE
     GROUP BY s.id`,
    [siteKey]
  )
  if (!row) return null
  return {
    siteId: row.site_id, isActive: row.is_active, rumEnabled: row.rum_enabled,
    hasWidget: row.has_widget, hasRum: row.has_rum,
    widgetPosition: row.widget_position || 'bottom-right', widgetHidden: !!row.widget_hidden,
  }
}

export function getLimit(ent: Entitlements, limitKey: string): number {
  return ent.limits[limitKey] ?? 0
}

// UTC day/month period keys — reliable and timezone-independent (never derived from the client).
export function periodKeys(d = new Date()): { day: string; month: string } {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return { day: `day:${y}-${m}-${day}`, month: `month:${y}-${m}` }
}

export async function getUsage(merchantId: number, usageType = 'audit'): Promise<{ day: number; month: number }> {
  const k = periodKeys()
  const rows = await query<{ period_key: string; count: number }>(
    `SELECT period_key, count FROM usage_ledger WHERE merchant_id = $1 AND usage_type = $2 AND period_key = ANY($3)`,
    [merchantId, usageType, [k.day, k.month]]
  )
  const byKey: Record<string, number> = {}
  for (const r of rows) byKey[r.period_key] = Number(r.count)
  return { day: byKey[k.day] || 0, month: byKey[k.month] || 0 }
}

export function remaining(limit: number, used: number): number | null {
  return limit === UNLIMITED ? null : Math.max(0, limit - used)
}

// Overage math (server-side only — never trust client prices).
export function calculateOverage(includedPages: number, requestedPages: number, pricePerPageCents: number) {
  const extraPages = Math.max(0, requestedPages - includedPages)
  const extraCostCents = extraPages * pricePerPageCents
  return { includedPages, requestedPages, extraPages, pricePerPageCents, extraCostCents }
}

export type StartCheck =
  | { ok: true; includedPages: number; extraPages: number; extraCostCents: number }
  | { ok: false; status: number; body: Record<string, unknown> }

// Page-limit + overage decision (does NOT consume a slot). Feature + audit-count
// checks are done separately so we never consume on a request that will be rejected.
export function checkPages(ent: Entitlements, requestedPages: number, confirmOverage: boolean, limitKey = 'pages_per_audit'): StartCheck {
  const included = getLimit(ent, limitKey)
  if (included === UNLIMITED || requestedPages <= included) {
    return { ok: true, includedPages: included === UNLIMITED ? requestedPages : included, extraPages: 0, extraCostCents: 0 }
  }
  const o = calculateOverage(included, requestedPages, ent.overage.pricePerPageCents)
  if (!ent.overage.enabled) {
    return {
      ok: false, status: 402,
      body: {
        code: 'PAGE_LIMIT_EXCEEDED', message: `Your plan allows up to ${included} pages per audit.`,
        includedPages: included, requestedPages, extraPages: o.extraPages,
        overageAllowed: false, upgradeRequired: true,
      },
    }
  }
  if (!confirmOverage) {
    return {
      ok: false, status: 402,
      body: {
        code: 'PAGE_LIMIT_EXCEEDED', message: `Requesting ${requestedPages} pages exceeds your ${included}-page limit.`,
        includedPages: included, requestedPages, extraPages: o.extraPages,
        pricePerPage: o.pricePerPageCents / 100, extraCost: o.extraCostCents / 100,
        overageAllowed: true, confirmationRequired: true,
      },
    }
  }
  return { ok: true, includedPages: included, extraPages: o.extraPages, extraCostCents: o.extraCostCents }
}

// Race-safe consumption of a daily + monthly audit slot in one transaction.
// Atomic guarded upserts prevent two concurrent requests from over-consuming.
export async function consumeAuditSlot(
  merchantId: number, dailyLimit: number, monthlyLimit: number, usageType = 'audit'
): Promise<{ ok: true } | { ok: false; scope: 'day' | 'month'; limit: number }> {
  const k = periodKeys()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const bump = async (periodKey: string, limit: number): Promise<boolean> => {
      if (limit === 0) return false
      if (limit === UNLIMITED) {
        await client.query(
          `INSERT INTO usage_ledger (merchant_id, usage_type, period_key, count) VALUES ($1,$3,$2,1)
           ON CONFLICT (merchant_id, usage_type, period_key) DO UPDATE SET count = usage_ledger.count + 1, updated_at = NOW()`,
          [merchantId, periodKey, usageType]
        )
        return true
      }
      const r = await client.query(
        `INSERT INTO usage_ledger (merchant_id, usage_type, period_key, count) VALUES ($1,$4,$2,1)
         ON CONFLICT (merchant_id, usage_type, period_key)
         DO UPDATE SET count = usage_ledger.count + 1, updated_at = NOW()
         WHERE usage_ledger.count < $3
         RETURNING count`,
        [merchantId, periodKey, limit, usageType]
      )
      return (r.rowCount ?? 0) > 0
    }
    if (!(await bump(k.day, dailyLimit))) { await client.query('ROLLBACK'); return { ok: false, scope: 'day', limit: dailyLimit } }
    if (!(await bump(k.month, monthlyLimit))) { await client.query('ROLLBACK'); return { ok: false, scope: 'month', limit: monthlyLimit } }
    await client.query('COMMIT')
    return { ok: true }
  } catch (e) {
    try { await client.query('ROLLBACK') } catch {}
    throw e
  } finally {
    client.release()
  }
}

// Best-effort decrement if the audit could not be created after consuming.
export async function releaseAuditSlot(merchantId: number, usageType = 'audit'): Promise<void> {
  const k = periodKeys()
  try {
    await query(
      `UPDATE usage_ledger SET count = GREATEST(0, count - 1) WHERE merchant_id = $1 AND usage_type = $3 AND period_key = ANY($2)`,
      [merchantId, [k.day, k.month], usageType]
    )
  } catch {}
}
