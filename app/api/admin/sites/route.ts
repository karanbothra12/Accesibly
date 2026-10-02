import { NextRequest, NextResponse } from 'next/server'
import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

async function requireSuperadmin(session: IronSession<SessionData>): Promise<boolean> {
  if (!session.isLoggedIn || !session.merchantId) return false
  const row = await queryOne<{ is_superadmin: boolean }>(
    'SELECT is_superadmin FROM merchants WHERE id = $1',
    [session.merchantId]
  )
  return row?.is_superadmin === true
}

// GET /api/admin/sites — list all sites platform-wide with owner info
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!(await requireSuperadmin(session))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const merchantId = searchParams.get('merchant_id')

  const params: unknown[] = []
  const filter = merchantId ? `WHERE s.merchant_id = $1` : ''
  if (merchantId) params.push(Number(merchantId))

  const sites = await query<{
    id: number; domain: string; site_key: string; is_active: boolean; created_at: string;
    merchant_id: number; merchant_email: string; merchant_name: string; merchant_plan: string;
    pageview_count: string; ping_count: string
  }>(
    `SELECT
       s.id, s.domain, s.site_key, s.is_active, s.created_at,
       m.id AS merchant_id, m.email AS merchant_email,
       m.full_name AS merchant_name, m.plan AS merchant_plan,
       COUNT(DISTINCT pe.id) AS pageview_count,
       COUNT(DISTINCT pl.id) AS ping_count
     FROM sites s
     JOIN merchants m ON m.id = s.merchant_id
     LEFT JOIN pageview_events pe ON pe.site_id = s.id AND pe.created_at >= NOW() - INTERVAL '30 days'
     LEFT JOIN ping_log pl ON pl.site_id = s.id AND pl.created_at >= NOW() - INTERVAL '30 days'
     ${filter}
     GROUP BY s.id, m.id ORDER BY s.created_at DESC`,
    params
  )

  return NextResponse.json({
    sites: sites.map(s => ({
      ...s,
      pageviewCount: Number(s.pageview_count),
      pingCount: Number(s.ping_count),
    })),
  })
}

// PATCH /api/admin/sites — admin toggle active for any site
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!(await requireSuperadmin(session))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, is_active } = await request.json()
  if (!id) return NextResponse.json({ error: 'Site id required' }, { status: 400 })

  const site = await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1', [id])
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  if (typeof is_active === 'boolean') {
    await query('UPDATE sites SET is_active = $1 WHERE id = $2', [is_active, id])
  }

  const updated = await queryOne('SELECT id, domain, site_key, is_active, merchant_id FROM sites WHERE id = $1', [id])
  return NextResponse.json({ site: updated })
}
