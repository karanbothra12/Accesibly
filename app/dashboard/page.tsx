import Link from 'next/link'
import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import AnalyticsPanel from '@/components/dashboard/AnalyticsPanel'
import { StatCard, Card, CardHeader } from '@/components/dashboard/ui'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

type SiteRow = { id: number; domain: string; is_active: boolean }

export default async function DashboardPage() {
  const session = await getSession()

  const sites = await query<SiteRow>(
    `SELECT id, domain, is_active FROM sites WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [session.merchantId]
  )
  const siteIds = sites.map(s => s.id)

  let pageviews = 0
  let widgetOpens = 0
  let upSites = 0
  let dailyRows: { day: string; pageviews: string; widget_opens: string }[] = []
  type AuditRow = { id: number; status: string; total_issues: number; pages_crawled: number; created_at: string; domain: string; job_type: string; seo_score: number | null }
  let recentA11y: AuditRow[] = []
  let recentSeo: AuditRow[] = []

  if (siteIds.length > 0) {
    const [pv] = await query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM pageview_events
       WHERE site_id = ANY($1) AND created_at >= NOW() - INTERVAL '30 days'`,
      [siteIds]
    )
    pageviews = Number(pv?.total ?? 0)

    const [wo] = await query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM pageview_events
       WHERE site_id = ANY($1) AND widget_opened = TRUE AND created_at >= NOW() - INTERVAL '30 days'`,
      [siteIds]
    )
    widgetOpens = Number(wo?.total ?? 0)

    const [up] = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT site_id) AS count FROM ping_log
       WHERE site_id = ANY($1) AND success = TRUE AND created_at >= NOW() - INTERVAL '24 hours'`,
      [siteIds]
    )
    upSites = Number(up?.count ?? 0)

    dailyRows = await query<{ day: string; pageviews: string; widget_opens: string }>(
      `SELECT DATE_TRUNC('day', created_at)::date::text AS day,
              COUNT(*) AS pageviews,
              COUNT(*) FILTER (WHERE widget_opened) AS widget_opens
       FROM pageview_events
       WHERE site_id = ANY($1) AND created_at >= NOW() - INTERVAL '14 days'
       GROUP BY 1 ORDER BY 1`,
      [siteIds]
    )

    const auditSql = (jobType: string) => query<AuditRow>(
      `SELECT j.id, j.status, j.total_issues, j.pages_crawled, j.created_at, s.domain,
              j.job_type, j.seo_score
       FROM crawl_jobs j JOIN sites s ON s.id = j.site_id
       WHERE s.merchant_id = $1 AND j.job_type = $2 ORDER BY j.created_at DESC LIMIT 5`,
      [session.merchantId, jobType]
    )
    ;[recentA11y, recentSeo] = await Promise.all([auditSql('accessibility'), auditSql('seo')])
  }

  const activeSites = sites.filter(s => s.is_active).length
  const openRate = pageviews > 0 ? Math.round((widgetOpens / pageviews) * 100) : 0
  const firstName = (session.fullName ?? '').split(' ')[0]
  const pvSpark = dailyRows.map(r => Number(r.pageviews))
  const woSpark = dailyRows.map(r => Number(r.widget_opens))
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Hero banner — indigo/violet gradient */}
      <div className="relative overflow-hidden rounded-3xl hero-indigo text-white p-7 lg:p-8 mb-6 beam-sweep">
        <div className="pointer-events-none absolute inset-0 grid-dots opacity-20" aria-hidden />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-white/70 mb-1">{today}</p>
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Welcome back{firstName ? `, ${firstName}` : ''} 👋</h1>
            <p className="text-white/80 text-sm mt-1.5">Here&apos;s how your sites performed over the last 30 days.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/sites" className="px-4 py-2.5 text-sm font-medium text-white bg-white/15 backdrop-blur rounded-xl hover:bg-white/25 transition-colors">
              Manage sites
            </Link>
            <Link href="/dashboard/audits" className="px-4 py-2.5 text-sm font-semibold text-primary-dark bg-white rounded-xl hover:bg-white/90 shadow-lg transition-all hover:-translate-y-0.5">
              Run an audit →
            </Link>
          </div>
        </div>
      </div>

      {/* Empty state */}
      {sites.length === 0 && (
        <div className="mb-6 ui-card border-dashed p-10 text-center">
          <div className="w-14 h-14 rounded-2xl tint-indigo mx-auto flex items-center justify-center text-3xl mb-4">🚀</div>
          <h2 className="text-lg font-semibold text-slate-900">Add your first site</h2>
          <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">Register a domain to get your embed snippet, then start tracking analytics and running audits.</p>
          <Link href="/dashboard/sites" className="mt-5 inline-block px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-dark transition-colors">
            Add a site
          </Link>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon="⊞" label="Total sites" value={sites.length} sub={`${activeSites} active`} tint="tint-violet" />
        <StatCard icon="👁" label="Pageviews (30d)" value={pageviews.toLocaleString()} sub="across all sites" tint="tint-indigo" spark={pvSpark} />
        <StatCard icon="♿" label="Widget opens (30d)" value={widgetOpens.toLocaleString()} sub={pageviews > 0 ? `${openRate}% open rate` : '—'} tint="tint-teal" spark={woSpark} />
        <StatCard icon="✓" label="Sites online" value={upSites} sub={`of ${activeSites} active`} tint="tint-sky" />
      </div>

      {/* Chart */}
      <AnalyticsPanel
        title="Pageviews & widget opens — last 14 days"
        daily={dailyRows.map(r => ({ day: r.day, pageviews: Number(r.pageviews), widgetOpens: Number(r.widget_opens) }))}
      />

      {/* Two columns: sites + recent audits */}
      <div className="mt-8 grid lg:grid-cols-2 gap-6">
        {/* Sites preview */}
        <Card>
          <CardHeader title="Your sites" action={<Link href="/dashboard/sites" className="text-xs text-primary hover:underline">Manage →</Link>} />
          {sites.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No sites yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sites.slice(0, 5).map(s => (
                <li key={s.id} className="px-5 py-3 flex items-center justify-between">
                  <span className="text-sm text-slate-700 truncate">{s.domain}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Recent accessibility audits */}
        <Card>
          <CardHeader title="Recent accessibility audits" action={<Link href="/dashboard/audits" className="text-xs text-primary hover:underline">View all →</Link>} />
          {recentA11y.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No accessibility audits yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentA11y.map(a => (
                <li key={a.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700 truncate">{a.domain}</p>
                    <p className="text-xs text-slate-400">{new Date(a.created_at).toLocaleDateString()} · {a.pages_crawled} pages</p>
                  </div>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="text-sm font-semibold text-slate-900">{a.total_issues}</span>
                    <span className="text-xs text-slate-400">issues</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Recent SEO audits */}
      <div className="mt-6">
        <Card>
          <CardHeader title="Recent SEO audits" action={<Link href="/dashboard/seo" className="text-xs text-primary hover:underline">View all →</Link>} />
          {recentSeo.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No SEO audits yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentSeo.map(a => (
                <li key={a.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700 truncate">{a.domain}</p>
                    <p className="text-xs text-slate-400">{new Date(a.created_at).toLocaleDateString()} · {a.pages_crawled} pages</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {a.seo_score != null && (
                      <span className="flex items-center gap-1">
                        <span className={`text-sm font-semibold ${a.seo_score >= 90 ? 'text-green-600' : a.seo_score >= 70 ? 'text-amber-600' : 'text-red-600'}`}>{Math.round(a.seo_score)}</span>
                        <span className="text-xs text-slate-400">score</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <span className="text-sm font-semibold text-slate-900">{a.total_issues}</span>
                      <span className="text-xs text-slate-400">issues</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
