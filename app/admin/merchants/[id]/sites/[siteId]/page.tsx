import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { redirect, notFound } from 'next/navigation'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import AdminShell from '@/components/admin/AdminShell'
import SiteAdminDetail from '@/components/admin/SiteAdminDetail'

export default async function AdminSitePage({ params }: { params: Promise<{ id: string; siteId: string }> }) {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
  if (!session.isLoggedIn || !session.merchantId) redirect('/login')
  const me = await queryOne<{ is_superadmin: boolean }>('SELECT is_superadmin FROM merchants WHERE id = $1', [session.merchantId])
  if (!me?.is_superadmin) redirect('/dashboard')

  const p = await params
  const merchantId = Number(p.id)
  const siteId = Number(p.siteId)
  if (!merchantId || !siteId) notFound()

  const site = await queryOne<{
    id: number; domain: string; site_key: string; is_active: boolean; rum_enabled: boolean
    created_at: string; merchant_id: number; merchant_name: string; merchant_email: string
  }>(
    `SELECT s.id, s.domain, s.site_key, s.is_active, s.rum_enabled, s.created_at,
            m.id AS merchant_id, m.full_name AS merchant_name, m.email AS merchant_email
     FROM sites s JOIN merchants m ON m.id = s.merchant_id
     WHERE s.id = $1 AND s.merchant_id = $2`,
    [siteId, merchantId]
  )
  if (!site) notFound()

  // Traffic / health snapshot (last 30 days).
  const [pv] = await query<{ total: string }>(`SELECT COUNT(*) total FROM pageview_events WHERE site_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`, [siteId])
  const [wo] = await query<{ total: string }>(`SELECT COUNT(*) total FROM pageview_events WHERE site_id = $1 AND widget_opened = TRUE AND created_at >= NOW() - INTERVAL '30 days'`, [siteId])
  const [ping] = await query<{ total: string; ok: string; avg_ms: string | null }>(
    `SELECT COUNT(*) total, COUNT(*) FILTER (WHERE success) ok, ROUND(AVG(response_ms)) avg_ms
     FROM ping_log WHERE site_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`, [siteId])
  const [au] = await query<{ total: string }>(`SELECT COUNT(*) total FROM crawl_jobs WHERE site_id = $1 AND job_type = 'accessibility'`, [siteId])
  const [seoAu] = await query<{ total: string }>(`SELECT COUNT(*) total FROM crawl_jobs WHERE site_id = $1 AND job_type = 'seo'`, [siteId])
  const [htmlAu] = await query<{ total: string }>(`SELECT COUNT(*) total FROM crawl_jobs WHERE site_id = $1 AND job_type = 'html'`, [siteId])
  const [cssAu] = await query<{ total: string }>(`SELECT COUNT(*) total FROM crawl_jobs WHERE site_id = $1 AND job_type = 'css'`, [siteId])
  const [secAu] = await query<{ total: string }>(`SELECT COUNT(*) total FROM crawl_jobs WHERE site_id = $1 AND job_type = 'security'`, [siteId])
  const [linksAu] = await query<{ total: string }>(`SELECT COUNT(*) total FROM crawl_jobs WHERE site_id = $1 AND job_type = 'links'`, [siteId])
  const [comp] = await query<{ total: string }>(`SELECT COUNT(*) total FROM competitor_reports WHERE site_id = $1`, [siteId])
  const [rumPv] = await query<{ total: string }>(`SELECT COUNT(*) total FROM rum_page_views WHERE site_id = $1 AND created_at >= NOW() - INTERVAL '30 days'`, [siteId])

  const pageviews = Number(pv?.total ?? 0)
  const widgetOpens = Number(wo?.total ?? 0)
  const pings = Number(ping?.total ?? 0)
  const overview = {
    pageviews, widgetOpens,
    openRate: pageviews > 0 ? Math.round((widgetOpens / pageviews) * 100) : 0,
    uptime: pings > 0 ? Math.round((Number(ping.ok) / pings) * 1000) / 10 : null,
    avgMs: ping?.avg_ms != null ? Number(ping.avg_ms) : null,
    audits: Number(au?.total ?? 0),
    seoAudits: Number(seoAu?.total ?? 0),
    htmlAudits: Number(htmlAu?.total ?? 0),
    cssAudits: Number(cssAu?.total ?? 0),
    securityAudits: Number(secAu?.total ?? 0),
    linksAudits: Number(linksAu?.total ?? 0),
    competitorChecks: Number(comp?.total ?? 0),
    rumPv: Number(rumPv?.total ?? 0),
  }

  return (
    <AdminShell fullName={session.fullName ?? ''} email={session.email ?? ''}>
      <SiteAdminDetail merchantId={merchantId} site={site} overview={overview} />
    </AdminShell>
  )
}
