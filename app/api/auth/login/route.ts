import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { queryOne } from '@/lib/db'
import { verifyPassword, validateEmail } from '@/lib/auth'
import { rateLimit, clientIp } from '@/lib/ratelimit'

interface Merchant {
  id: number
  email: string
  full_name: string
  password_hash: string
  is_superadmin: boolean
  is_active: boolean
}

const GENERIC_ERROR = 'Invalid email or password'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password || !validateEmail(email)) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
    }

    // Throttle brute force: per-IP and per-email fixed windows.
    const ip = clientIp(request)
    const emailKey = String(email).toLowerCase().trim()
    const [ipLimit, emailLimit] = await Promise.all([
      rateLimit(`login:ip:${ip}`, 20, 900),        // 20 / 15 min per IP
      rateLimit(`login:email:${emailKey}`, 8, 900), // 8 / 15 min per email
    ])
    if (!ipLimit.ok || !emailLimit.ok) {
      const retry = Math.max(ipLimit.retryAfter, emailLimit.retryAfter)
      return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(retry) } })
    }

    const merchant = await queryOne<Merchant>(
      'SELECT id, email, full_name, password_hash, is_superadmin, is_active FROM merchants WHERE email = $1',
      [email.toLowerCase().trim()]
    )

    // Always run bcrypt to prevent timing attacks
    const dummyHash = '$2a$12$invalidhashfortimingatttackprevention123456789'
    const isValid = merchant
      ? await verifyPassword(password, merchant.password_hash)
      : await verifyPassword(password, dummyHash)

    if (!merchant || !isValid) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 })
    }

    // Suspended by a superadmin — deny access without leaking which check failed elsewhere.
    if (merchant.is_active === false) {
      return NextResponse.json({ error: 'This account has been suspended. Please contact support.' }, { status: 403 })
    }

    const cookieStore = await cookies()
    const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)

    session.isLoggedIn = true
    session.merchantId = merchant.id
    session.email = merchant.email
    session.fullName = merchant.full_name
    session.isSuperadmin = merchant.is_superadmin

    await session.save()

    return NextResponse.json({
      ok: true,
      isSuperadmin: merchant.is_superadmin,
    })
  } catch (err) {
    console.error('Login error:', err)
    const { logError } = await import('@/lib/errorlog')
    await logError({ source: 'api', message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : null, path: '/api/auth/login', method: 'POST' })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
