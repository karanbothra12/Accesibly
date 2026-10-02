import { NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { hasFeature } from '@/lib/entitlements'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

type Prefs = { audit_done: boolean; limit_reached: boolean; recipient: string | null }

// GET /api/notifications — the merchant's email-notification prefs + whether the plan allows them.
export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const enabled = await hasFeature(session.merchantId, 'email_notifications')
  const prefs = (await queryOne<Prefs>(
    'SELECT audit_done, limit_reached, recipient FROM notification_settings WHERE merchant_id = $1',
    [session.merchantId]
  )) ?? { audit_done: true, limit_reached: true, recipient: null }

  return NextResponse.json({ enabled, prefs })
}

// PATCH /api/notifications — update prefs (only when the plan includes the feature).
export async function PATCH(request: Request) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasFeature(session.merchantId, 'email_notifications'))) {
    return NextResponse.json({ code: 'FEATURE_DISABLED', message: 'Email Notifications are not included in your plan.' }, { status: 403 })
  }

  const b = await request.json().catch(() => ({}))
  const auditDone = b.audit_done !== false
  const limitReached = b.limit_reached !== false
  const recipient = typeof b.recipient === 'string' && b.recipient.trim() ? b.recipient.trim().slice(0, 320) : null

  await query(
    `INSERT INTO notification_settings (merchant_id, audit_done, limit_reached, recipient)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (merchant_id) DO UPDATE SET audit_done = EXCLUDED.audit_done,
       limit_reached = EXCLUDED.limit_reached, recipient = EXCLUDED.recipient, updated_at = NOW()`,
    [session.merchantId, auditDone, limitReached, recipient]
  )
  return NextResponse.json({ ok: true })
}
