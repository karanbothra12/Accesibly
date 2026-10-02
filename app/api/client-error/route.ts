import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { logError } from '@/lib/errorlog'
import { rateLimit, clientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'

// POST /api/client-error — records a browser-side script error. Fail-soft (204).
export async function POST(request: NextRequest) {
  try {
    // Cap volume so a broken page can't flood the log.
    const rl = await rateLimit(`clierr:${clientIp(request)}`, 30, 60)
    if (!rl.ok) return new NextResponse(null, { status: 204 })

    const raw = await request.text()
    if (!raw || raw.length > 12000) return new NextResponse(null, { status: 204 })
    let b: Record<string, unknown>
    try { b = JSON.parse(raw) } catch { return new NextResponse(null, { status: 204 }) }

    let merchantId: number | null = null
    try {
      const session = await getIronSession<SessionData>(await cookies(), SESSION_OPTIONS)
      if (session.isLoggedIn && session.merchantId) merchantId = session.merchantId
    } catch { /* anonymous */ }

    await logError({
      source: 'client',
      message: String(b.message ?? 'Client error'),
      stack: b.stack ? String(b.stack) : null,
      path: b.path ? String(b.path) : null,
      merchantId,
      meta: { userAgent: request.headers.get('user-agent')?.slice(0, 300) || null, kind: b.kind ?? null },
    })
    return new NextResponse(null, { status: 204 })
  } catch {
    return new NextResponse(null, { status: 204 })
  }
}
