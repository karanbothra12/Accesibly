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

// GET /api/internet-monitoring/incidents?status=open|all — merchant's incidents.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const superadmin = await isSuperadmin(session.merchantId)
  const status = new URL(request.url).searchParams.get('status') || 'all'

  const where: string[] = []
  const params: unknown[] = []
  if (!superadmin) { params.push(session.merchantId); where.push(`mw.merchant_id = $${params.length}`) }
  if (status === 'open') where.push(`i.status IN ('open','acknowledged')`)

  const rows = await query(
    `SELECT i.id, i.website_id, mw.name AS website_name, mw.url, i.status, i.kind, i.cause_hypothesis,
            i.failure_count, i.last_error, i.started_at, i.detected_at, i.resolved_at, i.acknowledged_at
     FROM monitoring_incidents i JOIN monitored_websites mw ON mw.id = i.website_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY i.status = 'resolved', i.started_at DESC LIMIT 100`,
    params
  )
  return NextResponse.json({ incidents: rows })
}

// PATCH — acknowledge or resolve. { id, action: 'acknowledge'|'resolve' }
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const superadmin = await isSuperadmin(session.merchantId)
  const body = await request.json().catch(() => ({}))
  const id = Number(body.id)
  const action = body.action === 'resolve' ? 'resolve' : 'acknowledge'
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const owned = await queryOne<{ id: number }>(
    `SELECT i.id FROM monitoring_incidents i JOIN monitored_websites mw ON mw.id = i.website_id
     WHERE i.id = $1 ${superadmin ? '' : 'AND mw.merchant_id = $2'}`,
    superadmin ? [id] : [id, session.merchantId]
  )
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'resolve') {
    await query(`UPDATE monitoring_incidents SET status = 'resolved', resolved_at = NOW() WHERE id = $1`, [id])
  } else {
    await query(`UPDATE monitoring_incidents SET status = 'acknowledged', acknowledged_at = NOW() WHERE id = $1 AND status = 'open'`, [id])
  }
  return NextResponse.json({ ok: true })
}
