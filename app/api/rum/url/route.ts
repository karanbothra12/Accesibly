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

// GET /api/rum/url?site_id=&path=&period= — Web Vitals detail for a single URL.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const siteIdParam = sp.get('site_id')
  const path = sp.get('path') || ''
  const period = PERIODS[sp.get('period') || '7d'] ? (sp.get('period') as string) : '7d'
  const { interval, unit } = PERIODS[period]
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

  const superadmin = await isSuperadmin(session.merchantId)
  let siteIds: number[]
  if (siteIdParam) {
    const s = superadmin
      ? await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1', [Number(siteIdParam)])
      : await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1 AND merchant_id = $2', [Number(siteIdParam), session.merchantId])
    if (!s) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    siteIds = [s.id]
  } else {
    const rows = await query<{ id: number }>('SELECT id FROM sites WHERE merchant_id = $1', [session.merchantId])
    siteIds = rows.map(r => r.id)
  }
  if (siteIds.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const where = `site_id = ANY($1) AND path = $2 AND created_at >= NOW() - INTERVAL '${interval}'`
  const params: unknown[] = [siteIds, path]

  const attr = (col: string) => query(
    `SELECT COALESCE(NULLIF(${col}::text,''),'Unknown') label, COUNT(*) page_views,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) lcp,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) inp,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY cls) cls
     FROM rum_page_views WHERE ${where} GROUP BY 1 ORDER BY page_views DESC LIMIT 12`, params)

  const [summaryRows, seriesRows, byDevice, byBrowser, byOs, byCountry, byConnection] = await Promise.all([
    query(`SELECT COUNT(*) page_views,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY lcp) lcp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY inp) inp,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY cls) cls,
              percentile_cont(0.75) WITHIN GROUP (ORDER BY load_time) load_time
            FROM rum_page_views WHERE ${where}`, params),
    query(`SELECT date_trunc('${unit}', created_at) bucket, COUNT(*) page_views,
              AVG(lcp) lcp, AVG(inp) inp, AVG(cls) cls
            FROM rum_page_views WHERE ${where} GROUP BY 1 ORDER BY 1`, params),
    attr('device_type'), attr('browser'), attr('os'), attr('country'), attr('connection'),
  ])

  const s = summaryRows[0] as Record<string, unknown>
  const mapAttr = (rows: Record<string, unknown>[]) => rows.map(r => ({ label: r.label, pageViews: Number(r.page_views), lcp: n(r.lcp), inp: n(r.inp), cls: n(r.cls) }))

  return NextResponse.json({
    path, period,
    summary: { pageViews: Number(s.page_views || 0), lcp: n(s.lcp), inp: n(s.inp), cls: n(s.cls), loadTime: n(s.load_time) },
    series: seriesRows.map((r: Record<string, unknown>) => ({ bucket: r.bucket, pageViews: Number(r.page_views), lcp: n(r.lcp), inp: n(r.inp), cls: n(r.cls) })),
    byDevice: mapAttr(byDevice), byBrowser: mapAttr(byBrowser), byOs: mapAttr(byOs),
    byCountry: mapAttr(byCountry), byConnection: mapAttr(byConnection),
  })
}
