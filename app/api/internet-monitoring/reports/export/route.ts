import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'

export const runtime = 'nodejs'

const PERIOD_HOURS: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

const csvCell = (v: unknown) => {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /api/internet-monitoring/reports/export?website_id=X&period=7d — CSV download.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const p = new URL(request.url).searchParams
  const websiteId = Number(p.get('website_id'))
  if (!websiteId) return NextResponse.json({ error: 'website_id is required' }, { status: 400 })
  const superadmin = await isSuperadmin(session.merchantId)
  const site = superadmin
    ? await queryOne<{ name: string }>('SELECT name FROM monitored_websites WHERE id = $1', [websiteId])
    : await queryOne<{ name: string }>('SELECT name FROM monitored_websites WHERE id = $1 AND merchant_id = $2', [websiteId, session.merchantId])
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const hours = PERIOD_HOURS[p.get('period') || '7d'] ?? 168
  const rows = await query<Record<string, unknown>>(
    `SELECT measured_at, available, status_code, error_type, isp, asn, country_code,
            dns_ms, tcp_ms, tls_ms, ttfb_ms, download_ms, total_ms, response_size, resolved_ip
     FROM synthetic_results WHERE website_id = $1 AND measured_at >= NOW() - make_interval(hours => $2)
     ORDER BY measured_at DESC LIMIT 20000`,
    [websiteId, hours]
  )

  const cols = ['measured_at', 'available', 'status_code', 'error_type', 'isp', 'asn', 'country_code', 'dns_ms', 'tcp_ms', 'tls_ms', 'ttfb_ms', 'download_ms', 'total_ms', 'response_size', 'resolved_ip']
  const csv = [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n')
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="monitoring_${websiteId}_${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
