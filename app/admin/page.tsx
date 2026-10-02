import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { redirect } from 'next/navigation'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { monthlyEquivalentCents, getAssignablePlans } from '@/lib/plans'
import { getNumberSetting } from '@/lib/settings'
import AdminDashboard from '@/components/admin/AdminDashboard'

export default async function AdminPage() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)

  if (!session.isLoggedIn) redirect('/login')
  if (!session.merchantId) redirect('/login')
  const me = await queryOne<{ is_superadmin: boolean }>(
    'SELECT is_superadmin FROM merchants WHERE id = $1',
    [session.merchantId]
  )
  if (!me?.is_superadmin) redirect('/dashboard')

  const [merchantCount] = await query<{ total: string }>('SELECT COUNT(*) AS total FROM merchants')
  const [siteCount] = await query<{ total: string }>('SELECT COUNT(*) AS total FROM sites')
  const [pvCount] = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM pageview_events WHERE created_at >= NOW() - INTERVAL '30 days'`
  )

  const merchants = await query<{
    id: number; email: string; full_name: string; plan: string
    is_superadmin: boolean; is_active: boolean; created_at: string; site_count: string
  }>(
    `SELECT m.id, m.email, m.full_name, m.plan, m.is_superadmin, m.is_active, m.created_at,
            COUNT(s.id) AS site_count
     FROM merchants m
     LEFT JOIN sites s ON s.merchant_id = m.id
     GROUP BY m.id ORDER BY m.created_at DESC`
  )

  // Estimated platform MRR — fully DB-driven. Per active non-admin merchant:
  // monthly-equivalent plan price (from the subscription/plan) + RUM add-on × active RUM sites.
  const rumAddonCents = await getNumberSetting('rum_addon_price_cents', 0)
  const billingRows = await query<{
    price_cents: number; price_yearly_cents: number; billing_interval: string; rum_sites: string
  }>(
    `SELECT p.price_cents, p.price_yearly_cents,
            COALESCE(s.billing_interval, 'monthly') AS billing_interval,
            COUNT(st.id) FILTER (WHERE st.rum_enabled AND st.is_active) AS rum_sites
     FROM merchants m
     LEFT JOIN subscriptions s ON s.merchant_id = m.id
     LEFT JOIN plans p ON p.id = COALESCE(s.plan_id, (SELECT id FROM plans WHERE key = m.plan))
     LEFT JOIN sites st ON st.merchant_id = m.id
     WHERE m.is_active = TRUE AND m.is_superadmin = FALSE
     GROUP BY m.id, p.price_cents, p.price_yearly_cents, s.billing_interval`
  )
  const mrrCents = billingRows.reduce((sum, r) => {
    const plan = r.price_cents != null
      ? monthlyEquivalentCents(Number(r.price_cents), Number(r.price_yearly_cents), r.billing_interval)
      : 0
    return sum + plan + rumAddonCents * Number(r.rum_sites)
  }, 0)

  const plans = await getAssignablePlans()

  return (
    <AdminDashboard
      currentMerchantId={session.merchantId ?? 0}
      fullName={session.fullName ?? ''}
      email={session.email ?? ''}
      stats={{
        merchants: Number(merchantCount?.total ?? 0),
        sites: Number(siteCount?.total ?? 0),
        pageviews30d: Number(pvCount?.total ?? 0),
        mrr: Math.round(mrrCents / 100),
      }}
      plans={plans}
      merchants={merchants.map(m => ({ ...m, siteCount: Number(m.site_count) }))}
    />
  )
}
