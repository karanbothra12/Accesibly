import { query } from '@/lib/db'

// ── Plan helpers (DB-driven) ─────────────────────────────────────
// Shared readers so admin views, the marketing page and MRR math all use the
// same source of truth (the plans table) — nothing plan-specific is hardcoded.

export type PlanRow = {
  id: number; key: string; name: string; description: string | null
  price_cents: number; price_yearly_cents: number; currency: string
  is_active: boolean; is_archived: boolean; sort_order: number
  page_overage_enabled: boolean; extra_page_price_cents: number
}

export type PublicPlan = {
  key: string; name: string; description: string | null; currency: string
  priceMonthlyCents: number; priceYearlyCents: number
  yearlyOffered: boolean; yearlySavingsPct: number
  features: { key: string; label: string }[]
  limits: { key: string; label: string; value: number; unit: string | null }[]
  overage: { enabled: boolean; pricePerPageCents: number }
}

// Monthly-equivalent price for MRR math, honoring the chosen interval.
export function monthlyEquivalentCents(priceMonthlyCents: number, priceYearlyCents: number, interval: string): number {
  return interval === 'yearly' && priceYearlyCents > 0 ? Math.round(priceYearlyCents / 12) : priceMonthlyCents
}

export function yearlySavingsPct(priceMonthlyCents: number, priceYearlyCents: number): number {
  if (priceYearlyCents <= 0 || priceMonthlyCents <= 0) return 0
  return Math.max(0, Math.round((1 - priceYearlyCents / (priceMonthlyCents * 12)) * 100))
}

// Active, non-archived plans with their enabled features + limits — for the
// public pricing page. Reflects SuperAdmin config automatically.
export async function getPublicPlans(): Promise<PublicPlan[]> {
  const [plans, pf, pl, features, limitDefs] = await Promise.all([
    query<PlanRow>(`SELECT * FROM plans WHERE is_active = TRUE AND is_archived = FALSE ORDER BY sort_order, id`),
    query<{ plan_id: number; feature_key: string; enabled: boolean }>('SELECT plan_id, feature_key, enabled FROM plan_features'),
    query<{ plan_id: number; limit_key: string; limit_value: number }>('SELECT plan_id, limit_key, limit_value FROM plan_limits'),
    query<{ key: string; label: string; sort_order: number }>('SELECT key, label, sort_order FROM features ORDER BY sort_order'),
    query<{ key: string; label: string; unit: string | null; sort_order: number }>('SELECT key, label, unit, sort_order FROM limit_definitions ORDER BY sort_order'),
  ])
  const featLabel = new Map(features.map(f => [f.key, f.label]))
  const featOrder = new Map(features.map((f, i) => [f.key, f.sort_order ?? i]))
  const limitMeta = new Map(limitDefs.map(l => [l.key, l]))

  return plans.map(p => ({
    key: p.key, name: p.name, description: p.description, currency: p.currency,
    priceMonthlyCents: p.price_cents, priceYearlyCents: p.price_yearly_cents,
    yearlyOffered: p.price_yearly_cents > 0,
    yearlySavingsPct: yearlySavingsPct(p.price_cents, p.price_yearly_cents),
    features: pf
      .filter(x => x.plan_id === p.id && x.enabled && featLabel.has(x.feature_key))
      .map(x => ({ key: x.feature_key, label: featLabel.get(x.feature_key)! }))
      .sort((a, b) => (featOrder.get(a.key) ?? 0) - (featOrder.get(b.key) ?? 0)),
    limits: pl
      .filter(x => x.plan_id === p.id && limitMeta.has(x.limit_key))
      .map(x => {
        const m = limitMeta.get(x.limit_key)!
        return { key: x.limit_key, label: m.label, value: Number(x.limit_value), unit: m.unit }
      })
      .sort((a, b) => (limitMeta.get(a.key)!.sort_order ?? 0) - (limitMeta.get(b.key)!.sort_order ?? 0)),
    overage: { enabled: p.page_overage_enabled, pricePerPageCents: p.extra_page_price_cents },
  }))
}

// Simple list of assignable plans (key + name) for admin dropdowns.
export async function getAssignablePlans(): Promise<{ id: number; key: string; name: string }[]> {
  return query<{ id: number; key: string; name: string }>(
    `SELECT id, key, name FROM plans WHERE is_archived = FALSE ORDER BY sort_order, id`
  )
}
