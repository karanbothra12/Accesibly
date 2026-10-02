import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

const PERIODS: Record<string, { interval: string; unit: string }> = {
  '24h': { interval: '1 day', unit: 'hour' },
  '7d': { interval: '7 days', unit: 'day' },
  '30d': { interval: '30 days', unit: 'day' },
  '90d': { interval: '90 days', unit: 'day' },
}

const n = (v: unknown) => (v == null ? null : Number(v))

// GET /api/rum/stats?period=7d&site_id=optional — merchant-scoped RUM aggregates.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const period = PERIODS[sp.get('period') || '7d'] ? (sp.get('period') as string) : '7d'
  const { interval, unit } = PERIODS[period]
  const siteIdParam = sp.get('site_id')

  // Resolve the set of site ids the viewer may see. Superadmins can read any site.
  const superadmin = await isSuperadmin(session.merchantId)
  let siteIds: number[]
  if (siteIdParam) {
    const site = superadmin
      ? await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1', [Number(siteIdParam)])
      : await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1 AND merchant_id = $2', [Number(siteIdParam), session.merchantId])
    if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    siteIds = [site.id]
  } else {
    const rows = await query<{ id: number }>('SELECT id FROM sites WHERE merchant_id = $1', [session.merchantId])
    siteIds = rows.map(r => r.id)
  }

  if (siteIds.length === 0) {
    return NextResponse.json({ empty: true })
  }

  const since = `NOW() - INTERVAL '${interval}'`
  const pvWhere = `site_id = ANY($1) AND created_at >= ${since}`

  const [
    overviewRows, errCountRows, ajaxRateRows,
    seriesRows, errSeriesRows, ajaxSeriesRows,
    byPath, byBrowser, byDevice, byOs, slowestPages, topErrors, slowestAjax,
    urlVitals, byBrowserVer, byCountry, byConnection, distRows, byCityRows,
  ] = await Promise.all([
    query(`SELECT COUNT(*) page_views, COUNT(DISTINCT session_id) sessions,
              AVG(load_time) avg_load,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY load_time) p75_load,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY load_time) p95_load,
              AVG(ttfb) avg_ttfb, AVG(lcp) avg_lcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) p75_lcp,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY lcp) p95_lcp,
              AVG(fcp) avg_fcp, AVG(inp) avg_inp, AVG(cls) avg_cls,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) p75_inp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY cls) p75_cls,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY fcp) p75_fcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY ttfb) p75_ttfb,
              COUNT(*) FILTER (WHERE nav_type = 'spa') spa_routes,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY spa_fcp) spa_fcp_p75
            FROM rum_page_views WHERE ${pvWhere}`, [siteIds]),
    query(`SELECT COUNT(*) c FROM rum_errors WHERE site_id = ANY($1) AND created_at >= ${since}`, [siteIds]),
    query(`SELECT COUNT(*) total, COUNT(*) FILTER (WHERE NOT success) errors
            FROM rum_ajax WHERE site_id = ANY($1) AND created_at >= ${since}`, [siteIds]),
    query(`SELECT date_trunc('${unit}', created_at) bucket, COUNT(*) page_views,
              AVG(lcp) lcp, AVG(fcp) fcp, AVG(ttfb) ttfb, AVG(inp) inp, AVG(cls) cls, AVG(load_time) load_time
            FROM rum_page_views WHERE ${pvWhere} GROUP BY 1 ORDER BY 1`, [siteIds]),
    query(`SELECT date_trunc('${unit}', created_at) bucket, COUNT(*) errors
            FROM rum_errors WHERE site_id = ANY($1) AND created_at >= ${since} GROUP BY 1 ORDER BY 1`, [siteIds]),
    query(`SELECT date_trunc('${unit}', created_at) bucket, COUNT(*) total, COUNT(*) FILTER (WHERE NOT success) errors
            FROM rum_ajax WHERE site_id = ANY($1) AND created_at >= ${since} GROUP BY 1 ORDER BY 1`, [siteIds]),
    query(`SELECT path, COUNT(*) views, AVG(load_time) avg_load, AVG(lcp) avg_lcp
            FROM rum_page_views WHERE ${pvWhere} GROUP BY path ORDER BY views DESC LIMIT 20`, [siteIds]),
    query(`SELECT COALESCE(browser,'Unknown') browser, COUNT(*) views FROM rum_page_views WHERE ${pvWhere} GROUP BY 1 ORDER BY views DESC`, [siteIds]),
    query(`SELECT COALESCE(device_type,'Unknown') device, COUNT(*) views FROM rum_page_views WHERE ${pvWhere} GROUP BY 1 ORDER BY views DESC`, [siteIds]),
    query(`SELECT COALESCE(os,'Unknown') os, COUNT(*) views FROM rum_page_views WHERE ${pvWhere} GROUP BY 1 ORDER BY views DESC`, [siteIds]),
    query(`SELECT path, COUNT(*) views, percentile_cont(0.75) WITHIN GROUP (ORDER BY load_time) p75_load
            FROM rum_page_views WHERE ${pvWhere} GROUP BY path HAVING COUNT(*) >= 3 ORDER BY p75_load DESC NULLS LAST LIMIT 10`, [siteIds]),
    query(`SELECT message, error_type, COUNT(*) count, MAX(created_at) last_seen
            FROM rum_errors WHERE site_id = ANY($1) AND created_at >= ${since} GROUP BY message, error_type ORDER BY count DESC LIMIT 15`, [siteIds]),
    query(`SELECT url, method, COUNT(*) calls, AVG(duration_ms) avg_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) p95_ms,
              COUNT(*) FILTER (WHERE NOT success) errors
            FROM rum_ajax WHERE site_id = ANY($1) AND created_at >= ${since} GROUP BY url, method HAVING COUNT(*) >= 2 ORDER BY avg_ms DESC NULLS LAST LIMIT 15`, [siteIds]),
    // Web Vitals (p75) per URL — powers the sortable Page URLs table.
    query(`SELECT path, COUNT(*) page_views,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) lcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) inp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY cls) cls,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY load_time) load_time
            FROM rum_page_views WHERE ${pvWhere} GROUP BY path ORDER BY page_views DESC LIMIT 100`, [siteIds]),
    // Browser + version (p75 vitals).
    query(`SELECT COALESCE(browser,'Unknown') browser, COALESCE(NULLIF(browser_version,''),'—') version, COUNT(*) page_views,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) lcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) inp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY cls) cls
            FROM rum_page_views WHERE ${pvWhere} GROUP BY 1,2 ORDER BY page_views DESC LIMIT 40`, [siteIds]),
    // Geography (p75 vitals per country).
    query(`SELECT COALESCE(NULLIF(country,''),'Unknown') country, COUNT(*) page_views,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) lcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) inp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY cls) cls
            FROM rum_page_views WHERE ${pvWhere} GROUP BY 1 ORDER BY page_views DESC LIMIT 40`, [siteIds]),
    // Network connection type.
    query(`SELECT COALESCE(NULLIF(connection,''),'Unknown') connection, COUNT(*) page_views,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) lcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) inp
            FROM rum_page_views WHERE ${pvWhere} GROUP BY 1 ORDER BY page_views DESC LIMIT 20`, [siteIds]),
    // Good / needs-improvement / poor distribution per Core Web Vital.
    query(`SELECT
              COUNT(*) FILTER (WHERE lcp <= 2500) lcp_good, COUNT(*) FILTER (WHERE lcp > 2500 AND lcp <= 4000) lcp_ni, COUNT(*) FILTER (WHERE lcp > 4000) lcp_poor,
              COUNT(*) FILTER (WHERE inp <= 200) inp_good, COUNT(*) FILTER (WHERE inp > 200 AND inp <= 500) inp_ni, COUNT(*) FILTER (WHERE inp > 500) inp_poor,
              COUNT(*) FILTER (WHERE cls <= 0.1) cls_good, COUNT(*) FILTER (WHERE cls > 0.1 AND cls <= 0.25) cls_ni, COUNT(*) FILTER (WHERE cls > 0.25) cls_poor
            FROM rum_page_views WHERE ${pvWhere}`, [siteIds]),
    // Top cities (Vercel/Cloudflare geo).
    query(`SELECT city, COALESCE(NULLIF(country,''),'') country, COUNT(*) page_views,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) lcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) inp
            FROM rum_page_views WHERE ${pvWhere} AND city IS NOT NULL AND city <> '' GROUP BY 1,2 ORDER BY page_views DESC LIMIT 30`, [siteIds]),
  ])

  const o = overviewRows[0] as Record<string, unknown>
  const ajax = ajaxRateRows[0] as Record<string, unknown>
  const ajaxTotal = Number(ajax.total || 0)
  const ajaxErrors = Number(ajax.errors || 0)

  return NextResponse.json({
    period,
    overview: {
      pageViews: Number(o.page_views || 0),
      sessions: Number(o.sessions || 0),
      avgLoad: n(o.avg_load), p75Load: n(o.p75_load), p95Load: n(o.p95_load),
      avgTtfb: n(o.avg_ttfb),
      avgLcp: n(o.avg_lcp), p75Lcp: n(o.p75_lcp), p95Lcp: n(o.p95_lcp),
      avgFcp: n(o.avg_fcp), avgInp: n(o.avg_inp), avgCls: n(o.avg_cls),
      p75Inp: n(o.p75_inp), p75Cls: n(o.p75_cls), p75Fcp: n(o.p75_fcp), p75Ttfb: n(o.p75_ttfb),
      spaRoutes: Number(o.spa_routes || 0), spaFcp: n(o.spa_fcp_p75),
      jsErrors: Number((errCountRows[0] as Record<string, unknown>).c || 0),
      ajaxTotal, ajaxErrors,
      ajaxErrorRate: ajaxTotal > 0 ? Math.round((ajaxErrors / ajaxTotal) * 1000) / 10 : 0,
    },
    series: seriesRows.map((r: Record<string, unknown>) => ({
      bucket: r.bucket, pageViews: Number(r.page_views),
      lcp: n(r.lcp), fcp: n(r.fcp), ttfb: n(r.ttfb), inp: n(r.inp), cls: n(r.cls), loadTime: n(r.load_time),
    })),
    errorSeries: errSeriesRows.map((r: Record<string, unknown>) => ({ bucket: r.bucket, errors: Number(r.errors) })),
    ajaxSeries: ajaxSeriesRows.map((r: Record<string, unknown>) => ({ bucket: r.bucket, total: Number(r.total), errors: Number(r.errors) })),
    byPath: byPath.map((r: Record<string, unknown>) => ({ path: r.path, views: Number(r.views), avgLoad: n(r.avg_load), avgLcp: n(r.avg_lcp) })),
    byBrowser: byBrowser.map((r: Record<string, unknown>) => ({ label: r.browser, views: Number(r.views) })),
    byDevice: byDevice.map((r: Record<string, unknown>) => ({ label: r.device, views: Number(r.views) })),
    byOs: byOs.map((r: Record<string, unknown>) => ({ label: r.os, views: Number(r.views) })),
    slowestPages: slowestPages.map((r: Record<string, unknown>) => ({ path: r.path, views: Number(r.views), p75Load: n(r.p75_load) })),
    topErrors: topErrors.map((r: Record<string, unknown>) => ({ message: r.message, type: r.error_type, count: Number(r.count), lastSeen: r.last_seen })),
    slowestAjax: slowestAjax.map((r: Record<string, unknown>) => ({ url: r.url, method: r.method, calls: Number(r.calls), avgMs: n(r.avg_ms), p95Ms: n(r.p95_ms), errors: Number(r.errors) })),
    urlVitals: urlVitals.map((r: Record<string, unknown>) => ({ path: r.path, pageViews: Number(r.page_views), lcp: n(r.lcp), inp: n(r.inp), cls: n(r.cls), loadTime: n(r.load_time) })),
    byBrowserVersion: byBrowserVer.map((r: Record<string, unknown>) => ({ browser: r.browser, version: r.version, pageViews: Number(r.page_views), lcp: n(r.lcp), inp: n(r.inp), cls: n(r.cls) })),
    byCountry: byCountry.map((r: Record<string, unknown>) => ({ country: r.country, pageViews: Number(r.page_views), lcp: n(r.lcp), inp: n(r.inp), cls: n(r.cls) })),
    byConnection: byConnection.map((r: Record<string, unknown>) => ({ connection: r.connection, pageViews: Number(r.page_views), lcp: n(r.lcp), inp: n(r.inp) })),
    byCity: byCityRows.map((r: Record<string, unknown>) => ({ city: r.city, country: r.country, pageViews: Number(r.page_views), lcp: n(r.lcp), inp: n(r.inp) })),
    distributions: (() => {
      const d = distRows[0] as Record<string, unknown>
      const mk = (g: unknown, ni: unknown, p: unknown) => ({ good: Number(g || 0), ni: Number(ni || 0), poor: Number(p || 0) })
      return { lcp: mk(d.lcp_good, d.lcp_ni, d.lcp_poor), inp: mk(d.inp_good, d.inp_ni, d.inp_poor), cls: mk(d.cls_good, d.cls_ni, d.cls_poor) }
    })(),
  })
}
