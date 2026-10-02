import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { queryOne, query } from '@/lib/db'
import { hashPassword, verifyPassword, validatePassword } from '@/lib/auth'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/settings — return current merchant profile
export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const merchant = await queryOne<{ id: number; email: string; full_name: string; plan: string; created_at: string }>(
    'SELECT id, email, full_name, plan, created_at FROM merchants WHERE id = $1',
    [session.merchantId]
  )

  if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ merchant })
}

// PATCH /api/settings — update fullName and/or password
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fullName, currentPassword, newPassword } = await request.json()

  if (fullName !== undefined) {
    if (typeof fullName !== 'string' || fullName.trim().length < 1) {
      return NextResponse.json({ error: 'Full name cannot be empty' }, { status: 400 })
    }
    await query('UPDATE merchants SET full_name = $1 WHERE id = $2', [fullName.trim(), session.merchantId])

    // Update session so the UI reflects immediately
    session.fullName = fullName.trim()
    await session.save()
  }

  if (newPassword !== undefined) {
    if (!currentPassword) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 })
    }
    const pwError = validatePassword(newPassword)
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 })

    const merchant = await queryOne<{ password_hash: string }>(
      'SELECT password_hash FROM merchants WHERE id = $1',
      [session.merchantId]
    )
    if (!merchant) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const ok = await verifyPassword(currentPassword, merchant.password_hash)
    if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 })

    const newHash = await hashPassword(newPassword)
    await query('UPDATE merchants SET password_hash = $1 WHERE id = $2', [newHash, session.merchantId])
  }

  return NextResponse.json({ ok: true })
}
