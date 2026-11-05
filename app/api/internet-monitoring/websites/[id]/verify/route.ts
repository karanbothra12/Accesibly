import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { queryOne, query } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { verifyOwnership, hostOf, dnsRecordName, dnsRecordValue } from '@/lib/monitoring/verify'

export const runtime = 'nodejs'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

async function load(id: number, merchantId: number, superadmin: boolean) {
  return superadmin
    ? queryOne<{ id: number; url: string; verification_token: string; verified: boolean }>(
        'SELECT id, url, verification_token, verified FROM monitored_websites WHERE id = $1', [id])
    : queryOne<{ id: number; url: string; verification_token: string; verified: boolean }>(
        'SELECT id, url, verification_token, verified FROM monitored_websites WHERE id = $1 AND merchant_id = $2', [id, merchantId])
}

// GET — return the verification instructions (DNS TXT + meta tag) for this website.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number((await params).id)
  const superadmin = await isSuperadmin(session.merchantId)
  const site = await load(id, session.merchantId, superadmin)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const host = hostOf(site.url)
  return NextResponse.json({
    verified: site.verified,
    host,
    dns: { name: host ? dnsRecordName(host) : null, type: 'TXT', value: dnsRecordValue(site.verification_token) },
    meta: { tag: `<meta name="accessly-monitor" content="${site.verification_token}">` },
  })
}

// POST — run verification. { method: 'dns-txt' | 'meta' }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = Number((await params).id)
  const superadmin = await isSuperadmin(session.merchantId)
  const site = await load(id, session.merchantId, superadmin)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (site.verified) return NextResponse.json({ verified: true })

  const body = await request.json().catch(() => ({}))
  const method = body.method === 'meta' ? 'meta' : 'dns-txt'
  const ok = await verifyOwnership(site.url, site.verification_token, method)
  if (!ok) {
    return NextResponse.json({ verified: false, code: 'NOT_FOUND', message: `Verification record not found via ${method}. DNS can take a few minutes to propagate.` }, { status: 409 })
  }
  await query(
    `UPDATE monitored_websites SET verified = TRUE, verification_method = $2, verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [id, method]
  )
  return NextResponse.json({ verified: true })
}
