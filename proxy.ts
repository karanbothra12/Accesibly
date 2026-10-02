import { NextRequest, NextResponse } from 'next/server'
import { unsealData } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'

const PUBLIC_PATHS = ['/login', '/register', '/p/', '/api/auth/login', '/api/auth/register', '/api/ping', '/widget.min.js', '/rum.min.js', '/api/rum', '/api/widget-event']
const ADMIN_PATHS = ['/admin']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public marketing landing page (exact match — '/' must not match everything)
  if (pathname === '/') {
    return NextResponse.next()
  }

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow the token-guarded audit runner reclaim endpoint (/api/audits/<id>/run)
  if (/^\/api\/audits\/\d+\/run$/.test(pathname)) {
    return NextResponse.next()
  }

  // Read session by unsealing the cookie (read-only, no DB call)
  const cookieValue = request.cookies.get(SESSION_OPTIONS.cookieName as string)?.value

  if (!cookieValue) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  let session: Partial<SessionData>
  try {
    const password = SESSION_OPTIONS.password as string
    session = await unsealData<SessionData>(cookieValue, { password })
  } catch {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (!session.isLoggedIn) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Superadmin-only paths
  if (ADMIN_PATHS.some(p => pathname.startsWith(p)) && !session.isSuperadmin) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
