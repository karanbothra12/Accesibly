import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { hashPassword, validateEmail, validatePassword } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/ratelimit'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, fullName } = body

    if (!email || !password || !fullName) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    // Throttle account-creation spam per IP.
    const reg = await rateLimit(`register:ip:${clientIp(request)}`, 5, 3600) // 5 / hour per IP
    if (!reg.ok) {
      return NextResponse.json({ error: 'Too many sign-ups from this network. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(reg.retryAfter) } })
    }

    if (!validateEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const pwError = validatePassword(password)
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    const existing = await queryOne('SELECT id FROM merchants WHERE email = $1', [normalizedEmail])
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    const passwordHash = await hashPassword(password)

    const rows = await query<{ id: number; is_superadmin: boolean }>(
      `INSERT INTO merchants (email, password_hash, full_name, plan)
       VALUES ($1, $2, $3, 'starter')
       RETURNING id, is_superadmin`,
      [normalizedEmail, passwordHash, fullName.trim()]
    )
    const merchant = rows[0]

    const cookieStore = await cookies()
    const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)

    session.isLoggedIn = true
    session.merchantId = merchant.id
    session.email = normalizedEmail
    session.fullName = fullName.trim()
    session.isSuperadmin = merchant.is_superadmin

    await session.save()

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('Register error:', err)
    const { logError } = await import('@/lib/errorlog')
    await logError({ source: 'api', message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : null, path: '/api/auth/register', method: 'POST' })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
