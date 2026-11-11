import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { getEntitlements, getLimit } from '@/lib/entitlements'
import { normalizeUrl } from '@/lib/competitor'
import { assertSafeUrl, UnsafeUrlError } from '@/lib/ssrf'

export const runtime = 'nodejs'

const FREQUENCIES = [1, 5, 10, 15, 30]

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// Resolve the merchant's Internet-Monitoring entitlement (superadmins get all).
async function entitlement(merchantId: number, superadmin: boolean) {
  if (superadmin) return { available: true, websiteLimit: -1, minFrequency: 1, frequencies: [...FREQUENCIES] }
  const ent = await getEntitlements(merchantId)
  const available = !!ent?.features['internet_monitoring']
  const minFrequency = ent ? getLimit(ent, 'min_monitor_frequency_minutes') : 0
  return {
    available,
    websiteLimit: ent ? getLimit(ent, 'monitored_websites') : 0,
    minFrequency,
    frequencies: available && minFrequency > 0 ? FREQUENCIES.filter(f => f >= minFrequency) : [],
  }
}

type Website = {
  id: number; name: string; url: string; description: string | null
  frequency_minutes: number; expected_status: number; timeout_ms: number
  enabled: boolean; verified: boolean; verification_token: string; verification_method: string | null
  agent_ids: number[]; last_checked_at: string | null; created_at: string
}

// GET /api/internet-monitoring/websites — entitlement + this merchant's websites.
export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const superadmin = await isSuperadmin(session.merchantId)
  const ent = await entitlement(session.merchantId, superadmin)

  const websites = await query<Website>(
    `SELECT id, name, url, description, frequency_minutes, expected_status, timeout_ms,
            enabled, verified, verification_token, verification_method, agent_ids, last_checked_at, created_at
     FROM monitored_websites
     ${superadmin ? '' : 'WHERE merchant_id = $1'}
     ORDER BY created_at DESC`,
    superadmin ? [] : [session.merchantId]
  )
  return NextResponse.json({ ...ent, websites })
}

// POST — create a website. { name, url, frequency_minutes, expected_status?, timeout_ms?, agent_ids? }
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const superadmin = await isSuperadmin(session.merchantId)
  const ent = await entitlement(session.merchantId, superadmin)
  if (!ent.available) return NextResponse.json({ code: 'FEATURE_DISABLED', message: 'Internet Performance Monitoring is not included in your plan.', upgradeRequired: true }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim().slice(0, 120)
  const url = normalizeUrl(String(body.url || ''))
  const frequency = Number(body.frequency_minutes) || ent.frequencies[0] || 5
  if (!name || !url) return NextResponse.json({ error: 'name and a valid url are required' }, { status: 400 })
  if (!ent.frequencies.includes(frequency)) {
    return NextResponse.json({ code: 'FREQUENCY_NOT_ALLOWED', message: `Your plan allows frequencies: ${ent.frequencies.join(', ')} min.`, allowed: ent.frequencies }, { status: 403 })
  }
  try { await assertSafeUrl(url) } catch (e) {
    if (e instanceof UnsafeUrlError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // Enforce the websites limit.
  if (ent.websiteLimit !== -1) {
    const [{ c }] = await query<{ c: string }>('SELECT COUNT(*) c FROM monitored_websites WHERE merchant_id = $1', [session.merchantId])
    if (Number(c || 0) >= ent.websiteLimit) {
      return NextResponse.json({ code: 'LIMIT_REACHED', message: `Your plan allows ${ent.websiteLimit} monitored website(s).`, limit: ent.websiteLimit, upgradeRequired: true }, { status: 403 })
    }
  }

  const agentIds: number[] = Array.isArray(body.agent_ids) ? body.agent_ids.map(Number).filter(Boolean) : []
  const row = await queryOne<Website>(
    `INSERT INTO monitored_websites (merchant_id, name, url, description, frequency_minutes, expected_status, timeout_ms, agent_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, name, url, description, frequency_minutes, expected_status, timeout_ms,
               enabled, verified, verification_token, verification_method, agent_ids, last_checked_at, created_at`,
    [session.merchantId, name, url, String(body.description || '').slice(0, 500) || null,
     frequency, Number(body.expected_status) || 200, Number(body.timeout_ms) || 30000, agentIds]
  )
  return NextResponse.json({ website: row }, { status: 201 })
}

async function ownWebsite(id: number, merchantId: number, superadmin: boolean) {
  return superadmin
    ? queryOne<{ id: number; verified: boolean }>('SELECT id, verified FROM monitored_websites WHERE id = $1', [id])
    : queryOne<{ id: number; verified: boolean }>('SELECT id, verified FROM monitored_websites WHERE id = $1 AND merchant_id = $2', [id, merchantId])
}

// PATCH — update { id, enabled?, frequency_minutes?, name?, description?, expected_status?, timeout_ms?, agent_ids? }
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const superadmin = await isSuperadmin(session.merchantId)
  const body = await request.json().catch(() => ({}))
  const id = Number(body.id)
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const site = await ownWebsite(id, session.merchantId, superadmin)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Enabling requires a verified domain — EXCEPT for SuperAdmin, who owns the
  // platform/domains and can enable directly (auto-marking it verified).
  if (body.enabled === true && !site.verified) {
    if (!superadmin) {
      return NextResponse.json({ code: 'NOT_VERIFIED', message: 'Verify domain ownership before enabling monitoring.' }, { status: 403 })
    }
    await query(`UPDATE monitored_websites SET verified = TRUE, verification_method = 'admin', verified_at = NOW() WHERE id = $1`, [id])
  }

  const sets: string[] = []
  const vals: unknown[] = []
  const set = (col: string, val: unknown) => { vals.push(val); sets.push(`${col} = $${vals.length}`) }
  if (typeof body.enabled === 'boolean') set('enabled', body.enabled)
  if (typeof body.name === 'string') set('name', body.name.slice(0, 120))
  if (typeof body.description === 'string') set('description', body.description.slice(0, 500))
  if (body.frequency_minutes && FREQUENCIES.includes(Number(body.frequency_minutes))) set('frequency_minutes', Number(body.frequency_minutes))
  if (body.expected_status) set('expected_status', Number(body.expected_status))
  if (body.timeout_ms) set('timeout_ms', Number(body.timeout_ms))
  if (Array.isArray(body.agent_ids)) set('agent_ids', body.agent_ids.map(Number).filter(Boolean))
  if (sets.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  vals.push(id)
  await query(`UPDATE monitored_websites SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals)
  return NextResponse.json({ ok: true })
}

// DELETE /api/internet-monitoring/websites?id=X
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const superadmin = await isSuperadmin(session.merchantId)
  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const site = await ownWebsite(id, session.merchantId, superadmin)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await query('DELETE FROM monitored_websites WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
