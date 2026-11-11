import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'

export const runtime = 'nodejs'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

const PERIOD_HOURS: Record<string, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 }

// GET /api/internet-monitoring/websites/[id]/results?period=24h — history + summary.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number((await params).id)
  const superadmin = await isSuperadmin(session.merchantId)

  const site = superadmin
    ? await queryOne<{ id: number }>('SELECT id FROM monitored_websites WHERE id = $1', [id])
    : await queryOne<{ id: number }>('SELECT id FROM monitored_websites WHERE id = $1 AND merchant_id = $2', [id, session.merchantId])
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const period = String(new URL(request.url).searchParams.get('period') || '24h')
  const hours = PERIOD_HOURS[period] ?? 24

  const summary = await queryOne<{
    checks: string; up: string; avg_total: number | null; p95_total: number | null
    avg_dns: number | null; avg_tcp: number | null; avg_tls: number | null; avg_ttfb: number | null
    cache_hits: string; cacheable: string; avg_origin_ttfb: number | null; avg_origin_total: number | null
  }>(
    `SELECT COUNT(*) checks,
            COUNT(*) FILTER (WHERE available) up,
            AVG(total_ms) avg_total,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_ms) p95_total,
            AVG(dns_ms) avg_dns, AVG(tcp_ms) avg_tcp, AVG(tls_ms) avg_tls, AVG(ttfb_ms) avg_ttfb,
            COUNT(*) FILTER (WHERE cache_status = 'hit') cache_hits,
            COUNT(*) FILTER (WHERE cache_status IN ('hit','miss','expired','stale','revalidated')) cacheable,
            AVG(origin_ttfb_ms) avg_origin_ttfb, AVG(origin_total_ms) avg_origin_total
     FROM synthetic_results
     WHERE website_id = $1 AND measured_at >= NOW() - make_interval(hours => $2)`,
    [id, hours]
  )

  // CDN / edge PoP distribution over the window.
  const cdn = await query<{ cdn_vendor: string | null; edge_pop: string | null; n: string }>(
    `SELECT cdn_vendor, edge_pop, COUNT(*) n
     FROM synthetic_results
     WHERE website_id = $1 AND measured_at >= NOW() - make_interval(hours => $2)
     GROUP BY cdn_vendor, edge_pop
     ORDER BY n DESC LIMIT 20`,
    [id, hours]
  )

  const results = await query(
    `SELECT id, measured_at, available, status_code, error_type, error_detail,
            dns_ms, tcp_ms, tls_ms, ttfb_ms, download_ms, total_ms, response_size, resolved_ip, ssl_expiry, agent_id,
            cdn_vendor, cache_status, edge_pop, origin_total_ms, origin_ttfb_ms, origin_available
     FROM synthetic_results
     WHERE website_id = $1 AND measured_at >= NOW() - make_interval(hours => $2)
     ORDER BY measured_at DESC
     LIMIT 500`,
    [id, hours]
  )

  const checks = Number(summary?.checks || 0)
  const up = Number(summary?.up || 0)
  const cacheable = Number(summary?.cacheable || 0)
  const cacheHits = Number(summary?.cache_hits || 0)
  return NextResponse.json({
    summary: {
      checks,
      availability: checks ? (up / checks) * 100 : null,
      avgTotal: summary?.avg_total ?? null,
      p95Total: summary?.p95_total ?? null,
      avgDns: summary?.avg_dns ?? null,
      avgTcp: summary?.avg_tcp ?? null,
      avgTls: summary?.avg_tls ?? null,
      avgTtfb: summary?.avg_ttfb ?? null,
      cacheHitRate: cacheable ? (cacheHits / cacheable) * 100 : null,
      avgOriginTtfb: summary?.avg_origin_ttfb ?? null,
      avgOriginTotal: summary?.avg_origin_total ?? null,
    },
    cdn: cdn.map(c => ({ vendor: c.cdn_vendor, pop: c.edge_pop, count: Number(c.n) })),
    results,
  })
}
