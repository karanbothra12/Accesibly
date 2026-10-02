import { NextRequest, NextResponse } from 'next/server'
import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// Double-check superadmin in DB — never trust session flag alone
async function requireSuperadmin(session: IronSession<SessionData>): Promise<boolean> {
  if (!session.isLoggedIn || !session.merchantId) return false
  const row = await queryOne<{ is_superadmin: boolean }>(
    'SELECT is_superadmin FROM merchants WHERE id = $1',
    [session.merchantId]
  )
  return row?.is_superadmin === true
}

// GET /api/admin/merchants — list all merchants with site counts
export async function GET() {
  const session = await getSession()
  if (!(await requireSuperadmin(session))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const merchants = await query<{
    id: number; email: string; full_name: string; plan: string;
    is_superadmin: boolean; created_at: string; site_count: string
  }>(
    `SELECT
       m.id, m.email, m.full_name, m.plan, m.is_superadmin, m.created_at,
       COUNT(s.id) AS site_count
     FROM merchants m
     LEFT JOIN sites s ON s.merchant_id = m.id
     GROUP BY m.id ORDER BY m.created_at DESC`
  )

  return NextResponse.json({
    merchants: merchants.map(m => ({ ...m, siteCount: Number(m.site_count) })),
  })
}

// PATCH /api/admin/merchants — update plan or suspend (delete) a merchant
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!(await requireSuperadmin(session))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id, plan, is_active } = await request.json()

  if (!id) return NextResponse.json({ error: 'Merchant id required' }, { status: 400 })

  // Prevent superadmin from modifying themselves
  if (id === session.merchantId) {
    return NextResponse.json({ error: 'Cannot modify your own account via admin panel' }, { status: 400 })
  }

  if (plan !== undefined) {
    // Validate against the plans table (plans are data, not a fixed enum).
    const planRow = await queryOne<{ id: number }>('SELECT id FROM plans WHERE key = $1 AND is_archived = FALSE', [plan])
    if (!planRow) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }
    // Keep the legacy string in sync AND update the subscription that entitlements read.
    await query('UPDATE merchants SET plan = $1 WHERE id = $2', [plan, id])
    await query(
      `INSERT INTO subscriptions (merchant_id, plan_id) VALUES ($1, $2)
       ON CONFLICT (merchant_id) DO UPDATE SET plan_id = EXCLUDED.plan_id, updated_at = NOW()`,
      [id, planRow.id]
    )
  }

  // Pause / resume a merchant (never allow suspending another superadmin).
  if (typeof is_active === 'boolean') {
    const target = await queryOne<{ is_superadmin: boolean }>('SELECT is_superadmin FROM merchants WHERE id = $1', [id])
    if (target?.is_superadmin) {
      return NextResponse.json({ error: 'Cannot suspend a superadmin account' }, { status: 400 })
    }
    await query('UPDATE merchants SET is_active = $1 WHERE id = $2', [is_active, id])
  }

  const updated = await queryOne(
    'SELECT id, email, full_name, plan, is_superadmin, is_active, created_at FROM merchants WHERE id = $1',
    [id]
  )
  if (!updated) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 })

  return NextResponse.json({ merchant: updated })
}

// DELETE /api/admin/merchants — delete (suspend) a merchant
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!(await requireSuperadmin(session))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Merchant id required' }, { status: 400 })

  if (id === session.merchantId) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM merchants WHERE id = $1',
    [id]
  )
  if (!existing) return NextResponse.json({ error: 'Merchant not found' }, { status: 404 })

  await query('DELETE FROM merchants WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
