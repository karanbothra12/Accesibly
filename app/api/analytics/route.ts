import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/analytics?period=7d&site_id=optional
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || '7d'
  const siteId = searchParams.get('site_id')

  // Map period string to interval
  const intervalMap: Record<string, string> = {
    '24h': '1 day',
    '7d':  '7 days',
    '30d': '30 days',
    '90d': '90 days',
  }
  const interval = intervalMap[period] ?? '7 days'

  // Site filter — scoped to this merchant, unless a superadmin is inspecting a site.
  // Placeholders are built to match `params` exactly (no unused $-params, which
  // Postgres rejects with "could not determine data type of parameter").
  const superadmin = await isSuperadmin(session.merchantId)
  let siteFilter: string
  const params: unknown[] = []

  if (siteId && superadmin) {
    params.push(Number(siteId))
    siteFilter = `AND pe.site_id = $1`
  } else if (siteId) {
    params.push(Number(siteId), session.merchantId)
    siteFilter = `AND pe.site_id = $1 AND $1::int IN (SELECT id FROM sites WHERE merchant_id = $2)`
  } else {
    params.push(session.merchantId)
    siteFilter = `AND pe.site_id IN (SELECT id FROM sites WHERE merchant_id = $1)`
  }

  // Total pageviews in period
  const [pvRow] = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM pageview_events pe
     WHERE pe.created_at >= NOW() - INTERVAL '${interval}' ${siteFilter}`,
    params
  )

  // Widget opens in period
  const [woRow] = await query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM pageview_events pe
     WHERE pe.created_at >= NOW() - INTERVAL '${interval}'
       AND pe.widget_opened = TRUE ${siteFilter}`,
    params
  )

  // Daily breakdown (pageviews + widget opens per day)
  const dailyRows = await query<{ day: string; pageviews: string; widget_opens: string }>(
    `SELECT
       DATE_TRUNC('day', pe.created_at)::date::text AS day,
       COUNT(*) AS pageviews,
       COUNT(*) FILTER (WHERE pe.widget_opened) AS widget_opens
     FROM pageview_events pe
     WHERE pe.created_at >= NOW() - INTERVAL '${interval}' ${siteFilter}
     GROUP BY 1 ORDER BY 1`,
    params
  )

  // Top pages
  const topPages = await query<{ path: string; views: string }>(
    `SELECT pe.path, COUNT(*) AS views
     FROM pageview_events pe
     WHERE pe.created_at >= NOW() - INTERVAL '${interval}' ${siteFilter}
     GROUP BY pe.path ORDER BY views DESC LIMIT 10`,
    params
  )

  // Ping health stats per site
  let pingWhere: string
  let pingParams: unknown[]
  if (siteId && superadmin) {
    pingWhere = 'WHERE s.id = $1'; pingParams = [Number(siteId)]
  } else if (siteId) {
    pingWhere = 'WHERE s.merchant_id = $1 AND s.id = $2'; pingParams = [session.merchantId, Number(siteId)]
  } else {
    pingWhere = 'WHERE s.merchant_id = $1'; pingParams = [session.merchantId]
  }

  const pingStats = await query<{
    site_id: number; domain: string;
    total_pings: string; success_pings: string; avg_ms: string
  }>(
    `SELECT
       s.id AS site_id, s.domain,
       COUNT(pl.id) AS total_pings,
       COUNT(pl.id) FILTER (WHERE pl.success) AS success_pings,
       ROUND(AVG(pl.response_ms)) AS avg_ms
     FROM sites s
     LEFT JOIN ping_log pl
       ON pl.site_id = s.id AND pl.created_at >= NOW() - INTERVAL '${interval}'
     ${pingWhere}
     GROUP BY s.id, s.domain ORDER BY s.created_at DESC`,
    pingParams
  )

  return NextResponse.json({
    period,
    summary: {
      pageviews: Number(pvRow?.total ?? 0),
      widgetOpens: Number(woRow?.total ?? 0),
    },
    daily: dailyRows.map(r => ({
      day: r.day,
      pageviews: Number(r.pageviews),
      widgetOpens: Number(r.widget_opens),
    })),
    topPages: topPages.map(r => ({ path: r.path, views: Number(r.views) })),
    siteHealth: pingStats.map(r => ({
      siteId: r.site_id,
      domain: r.domain,
      totalPings: Number(r.total_pings),
      successPings: Number(r.success_pings),
      avgMs: r.avg_ms ? Number(r.avg_ms) : null,
      uptimePct: r.total_pings === '0' ? null
        : Math.round((Number(r.success_pings) / Number(r.total_pings)) * 1000) / 10,
    })),
  })
}
