import { NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { getEntitlements, getUsage, remaining, setBillingInterval, setUserPlan } from '@/lib/entitlements'
import { getPublicPlans } from '@/lib/plans'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/usage — the signed-in merchant's plan, features, limits, and live usage.
// The dashboard renders entirely from this; it never hardcodes plan rules.
export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ent = await getEntitlements(session.merchantId)
  if (!ent) return NextResponse.json({ error: 'No active plan' }, { status: 404 })

  const [usage, seoUsage, htmlUsage, cssUsage, secUsage, linksUsage, compUsage, featureCatalog, limitCatalog, siteCountRows, availablePlans] = await Promise.all([
    getUsage(session.merchantId, 'audit'),
    getUsage(session.merchantId, 'seo_audit'),
    getUsage(session.merchantId, 'html_audit'),
    getUsage(session.merchantId, 'css_audit'),
    getUsage(session.merchantId, 'security_audit'),
    getUsage(session.merchantId, 'links_audit'),
    getUsage(session.merchantId, 'competitor'),
    query<{ key: string; label: string; sort_order: number }>('SELECT key, label, sort_order FROM features ORDER BY sort_order'),
    query<{ key: string; label: string; period: string; unit: string; sort_order: number }>('SELECT key, label, period, unit, sort_order FROM limit_definitions ORDER BY sort_order'),
    query<{ c: string }>('SELECT COUNT(*) c FROM sites WHERE merchant_id = $1', [session.merchantId]),
    getPublicPlans(),
  ])
  const siteCount = Number(siteCountRows[0]?.c || 0)

  const usedFor = (key: string): number | null => {
    if (key === 'daily_audits') return usage.day
    if (key === 'monthly_audits') return usage.month
    if (key === 'daily_seo_audits') return seoUsage.day
    if (key === 'monthly_seo_audits') return seoUsage.month
    if (key === 'daily_html_audits') return htmlUsage.day
    if (key === 'monthly_html_audits') return htmlUsage.month
    if (key === 'daily_css_audits') return cssUsage.day
    if (key === 'monthly_css_audits') return cssUsage.month
    if (key === 'daily_security_audits') return secUsage.day
    if (key === 'monthly_security_audits') return secUsage.month
    if (key === 'daily_links_audits') return linksUsage.day
    if (key === 'monthly_links_audits') return linksUsage.month
    if (key === 'daily_competitor_reports') return compUsage.day
    if (key === 'monthly_competitor_reports') return compUsage.month
    if (key === 'projects') return siteCount
    return null
  }

  // Yearly is only offered when the plan has a yearly price configured.
  const yearlyOffered = ent.plan.price_yearly_cents > 0
  // Savings vs. paying monthly for a year, as a percentage (server-computed).
  const yearlySavingsPct = yearlyOffered && ent.plan.price_cents > 0
    ? Math.max(0, Math.round((1 - ent.plan.price_yearly_cents / (ent.plan.price_cents * 12)) * 100))
    : 0

  return NextResponse.json({
    plan: {
      key: ent.plan.key, name: ent.plan.name, description: ent.plan.description,
      currency: ent.plan.currency,
      priceMonthlyCents: ent.plan.price_cents,
      priceYearlyCents: ent.plan.price_yearly_cents,
      yearlyOffered,
      yearlySavingsPct,
      billingInterval: ent.billingInterval,
      // Overage (extra pages) is always billed monthly, independent of the plan cadence.
      overageBilling: 'monthly' as const,
    },
    features: featureCatalog.map(f => ({ key: f.key, label: f.label, enabled: !!ent.features[f.key] })),
    limits: limitCatalog
      .filter(l => ent.limits[l.key] !== undefined)
      .map(l => {
        const value = ent.limits[l.key]
        const used = usedFor(l.key)
        return {
          key: l.key, label: l.label, period: l.period, unit: l.unit,
          value, unlimited: value === -1,
          used, remaining: used == null ? null : remaining(value, used),
        }
      }),
    overage: { enabled: ent.overage.enabled, pricePerPage: ent.overage.pricePerPageCents / 100 },
    // All active plans, so the user can compare and switch/upgrade.
    availablePlans: availablePlans.map(p => ({
      key: p.key, name: p.name, description: p.description, currency: p.currency,
      priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents,
      yearlyOffered: p.yearlyOffered, yearlySavingsPct: p.yearlySavingsPct,
      features: p.features, current: p.key === ent.plan.key,
    })),
  })
}

// PATCH /api/usage — change the signed-in merchant's billing cadence or plan.
// Both are validated server-side against what actually exists.
export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))

  // Plan switch. Downgrades / same-tier apply instantly; UPGRADES to a
  // higher-priced plan require payment (not free) — this prevents a user from
  // granting themselves Enterprise entitlements without paying.
  if (typeof body.planKey === 'string') {
    const [current, target] = await Promise.all([
      getEntitlements(session.merchantId),
      queryOne<{ price_cents: number; is_active: boolean; is_archived: boolean }>(
        'SELECT price_cents, is_active, is_archived FROM plans WHERE key = $1', [body.planKey]
      ),
    ])
    if (!target || !target.is_active || target.is_archived) {
      return NextResponse.json({ error: 'Plan not available' }, { status: 400 })
    }
    const isUpgrade = !!current && target.price_cents > current.plan.price_cents
    const paymentBypass = process.env.ALLOW_FREE_PLAN_UPGRADES === '1'
    if (isUpgrade && !paymentBypass) {
      return NextResponse.json({
        code: 'PAYMENT_REQUIRED',
        error: 'Upgrading to a higher plan requires checkout. Contact us to enable billing.',
      }, { status: 402 })
    }
    const res = await setUserPlan(session.merchantId, body.planKey)
    if (!res.ok) return NextResponse.json({ error: res.error || 'Could not change plan' }, { status: 400 })
    return NextResponse.json({ ok: true, planKey: body.planKey })
  }

  // Billing cadence switch.
  const requested = body.billingInterval
  if (requested !== 'monthly' && requested !== 'yearly') {
    return NextResponse.json({ error: 'billingInterval must be "monthly" or "yearly"' }, { status: 400 })
  }
  const effective = await setBillingInterval(session.merchantId, requested)
  return NextResponse.json({ billingInterval: effective })
}
