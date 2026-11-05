import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { registerAgent } from '@/lib/monitoring/agents'

export const runtime = 'nodejs'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET — list agents (for the fleet view + website agent-selection). Any logged-in user.
export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const agents = await query(
    `SELECT id, agent_key, name, kind, country_code, city, region, status,
            last_heartbeat_at, last_success_at, jobs_succeeded, jobs_failed, isp, asn, version,
            (last_heartbeat_at IS NOT NULL AND last_heartbeat_at > NOW() - INTERVAL '2 minutes') AS online
     FROM monitoring_agents ORDER BY kind, name`
  )
  return NextResponse.json({ agents })
}

// POST — register a new agent (SuperAdmin only). Returns the plaintext token ONCE.
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isSuperadmin(session.merchantId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const name = String(body.name || '').trim().slice(0, 80)
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const { agentId, agentKey, token } = await registerAgent({
    name,
    kind: 'remote',
    countryCode: body.country_code ? String(body.country_code).slice(0, 2).toUpperCase() : null,
    city: body.city ? String(body.city).slice(0, 80) : null,
    region: body.region ? String(body.region).slice(0, 80) : null,
  })
  // Token is shown exactly once — the client must copy it now.
  return NextResponse.json({ agentId, agentKey, token }, { status: 201 })
}

// DELETE /api/internet-monitoring/agents?id=X (SuperAdmin only).
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await isSuperadmin(session.merchantId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  await query("DELETE FROM monitoring_agents WHERE id = $1 AND kind = 'remote'", [id])
  return NextResponse.json({ ok: true })
}
