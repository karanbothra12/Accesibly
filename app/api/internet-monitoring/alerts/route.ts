import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'

export const runtime = 'nodejs'

const CONDITIONS = ['down', 'slow', 'ssl_expiry', 'agent_offline']
const CHANNELS = ['email', 'webhook', 'inapp']

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET — list this merchant's alert rules.
export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await query(
    `SELECT a.id, a.website_id, mw.name AS website_name, a.condition, a.threshold, a.channel, a.target, a.enabled
     FROM alert_configurations a LEFT JOIN monitored_websites mw ON mw.id = a.website_id
     WHERE a.merchant_id = $1 ORDER BY a.created_at DESC`,
    [session.merchantId]
  )
  return NextResponse.json({ alerts: rows })
}

// POST — create a rule. { condition, channel, website_id?, threshold?, target? }
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await request.json().catch(() => ({}))
  if (!CONDITIONS.includes(b.condition)) return NextResponse.json({ error: 'Invalid condition' }, { status: 400 })
  const channel = CHANNELS.includes(b.channel) ? b.channel : 'email'
  if (channel === 'webhook' && !/^https:\/\//i.test(String(b.target || ''))) {
    return NextResponse.json({ error: 'Webhook target must be an https URL' }, { status: 400 })
  }
  // If a website is specified, it must belong to the merchant.
  if (b.website_id) {
    const own = await queryOne<{ id: number }>('SELECT id FROM monitored_websites WHERE id = $1 AND merchant_id = $2', [Number(b.website_id), session.merchantId])
    if (!own) return NextResponse.json({ error: 'Website not found' }, { status: 404 })
  }
  const row = await queryOne(
    `INSERT INTO alert_configurations (merchant_id, website_id, condition, threshold, channel, target)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, website_id, condition, threshold, channel, target, enabled`,
    [session.merchantId, b.website_id ? Number(b.website_id) : null, b.condition, b.threshold ? Number(b.threshold) : null, channel, b.target ? String(b.target).slice(0, 500) : null]
  )
  return NextResponse.json({ alert: row }, { status: 201 })
}

// DELETE /api/internet-monitoring/alerts?id=X
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  await query('DELETE FROM alert_configurations WHERE id = $1 AND merchant_id = $2', [id, session.merchantId])
  return NextResponse.json({ ok: true })
}
