import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { redirect, notFound } from 'next/navigation'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { monthlyEquivalentCents, getAssignablePlans } from '@/lib/plans'
import { getNumberSetting } from '@/lib/settings'
import AdminShell from '@/components/admin/AdminShell'
import MerchantDetail from '@/components/admin/MerchantDetail'

export default async function MerchantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
  if (!session.isLoggedIn || !session.merchantId) redirect('/login')
  const me = await queryOne<{ is_superadmin: boolean }>('SELECT is_superadmin FROM merchants WHERE id = $1', [session.merchantId])
  if (!me?.is_superadmin) redirect('/dashboard')

  const id = Number((await params).id)
  if (!id) notFound()

  const merchant = await queryOne<{
    id: number; email: string; full_name: string; plan: string
    is_superadmin: boolean; is_active: boolean; created_at: string
  }>('SELECT id, email, full_name, plan, is_superadmin, is_active, created_at FROM merchants WHERE id = $1', [id])
  if (!merchant) notFound()

  const siteRows = await query<{
    id: number; domain: string; site_key: string; is_active: boolean; rum_enabled: boolean
    created_at: string; pv30: string; rum30: string; last_ping: string | null
  }>(
    `SELECT s.id, s.domain, s.site_key, s.is_active, s.rum_enabled, s.created_at,
       (SELECT COUNT(*) FROM pageview_events pe WHERE pe.site_id = s.id AND pe.created_at >= NOW() - INTERVAL '30 days') pv30,
       (SELECT COUNT(*) FROM rum_page_views rp WHERE rp.site_id = s.id AND rp.created_at >= NOW() - INTERVAL '30 days') rum30,
       (SELECT MAX(created_at) FROM ping_log pl WHERE pl.site_id = s.id) last_ping
     FROM sites s WHERE s.merchant_id = $1 ORDER BY s.created_at DESC`,
    [id]
  )

  const sites = siteRows.map(s => ({
    id: s.id, domain: s.domain, site_key: s.site_key, is_active: s.is_active, rum_enabled: s.rum_enabled,
    created_at: s.created_at, pv30: Number(s.pv30), rum30: Number(s.rum30), last_ping: s.last_ping,
  }))

  const rumSites = sites.filter(s => s.rum_enabled && s.is_active).length

  // Resolve the merchant's effective plan + interval the same way entitlements do,
  // and pull the RUM add-on price from settings — all DB-driven, nothing hardcoded.
  const [planRow, rumAddonCents, plans] = await Promise.all([
    queryOne<{ name: string; price_cents: number; price_yearly_cents: number; billing_interval: string | null }>(
      `SELECT p.name, p.price_cents, p.price_yearly_cents, s.billing_interval
       FROM plans p
       LEFT JOIN subscriptions s ON s.merchant_id = $1 AND s.plan_id = p.id
       WHERE p.id = COALESCE(
         (SELECT plan_id FROM subscriptions WHERE merchant_id = $1),
         (SELECT id FROM plans WHERE key = $2)
       )`,
      [id, merchant.plan]
    ),
    getNumberSetting('rum_addon_price_cents', 0),
    getAssignablePlans(),
  ])

  const planMonthlyCents = planRow
    ? monthlyEquivalentCents(Number(planRow.price_cents), Number(planRow.price_yearly_cents), planRow.billing_interval || 'monthly')
    : 0
  const billing = {
    plan: merchant.plan,
    planName: planRow?.name ?? merchant.plan,
    planMonthlyCents,
    interval: planRow?.billing_interval || 'monthly',
    rumSites,
    rumAddonCents,
    mrrCents: planMonthlyCents + rumAddonCents * rumSites,
    pv30: sites.reduce((a, s) => a + s.pv30, 0),
    rum30: sites.reduce((a, s) => a + s.rum30, 0),
  }

  return (
    <AdminShell fullName={session.fullName ?? ''} email={session.email ?? ''}>
      <MerchantDetail
        currentMerchantId={session.merchantId}
        merchant={merchant}
        sites={sites}
        billing={billing}
        plans={plans}
      />
    </AdminShell>
  )
}
