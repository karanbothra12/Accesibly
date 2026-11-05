import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { enqueueMonitoringJob } from '@/lib/monitoring/queue'

export const runtime = 'nodejs'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

async function ownWebsite(id: number, merchantId: number, superadmin: boolean) {
  return superadmin
    ? queryOne<{ id: number }>('SELECT id FROM monitored_websites WHERE id = $1', [id])
    : queryOne<{ id: number }>('SELECT id FROM monitored_websites WHERE id = $1 AND merchant_id = $2', [id, merchantId])
}

// GET /api/internet-monitoring/diagnostics?website_id=X — recent diagnostics.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const websiteId = Number(new URL(request.url).searchParams.get('website_id'))
  if (!websiteId) return NextResponse.json({ error: 'website_id is required' }, { status: 400 })
  const superadmin = await isSuperadmin(session.merchantId)
  if (!(await ownWebsite(websiteId, session.merchantId, superadmin))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await query(
    `SELECT id, kind, target, success, summary, error, measured_at, agent_id
     FROM network_diagnostics WHERE website_id = $1 ORDER BY measured_at DESC LIMIT 50`,
    [websiteId]
  )
  return NextResponse.json({ diagnostics: rows })
}

// POST — queue a diagnostic. { website_id, kind: 'ping'|'traceroute'|'dns' }
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const websiteId = Number(body.website_id)
  const kind = ['ping', 'traceroute', 'dns'].includes(body.kind) ? body.kind : 'ping'
  if (!websiteId) return NextResponse.json({ error: 'website_id is required' }, { status: 400 })
  const superadmin = await isSuperadmin(session.merchantId)
  if (!(await ownWebsite(websiteId, session.merchantId, superadmin))) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Rate-limit: one queued diagnostic per website at a time.
  const pending = await queryOne<{ one: number }>(
    `SELECT 1 one FROM monitoring_jobs WHERE website_id = $1 AND job_type = 'diagnostic' AND status IN ('queued','running') LIMIT 1`,
    [websiteId]
  )
  if (pending) return NextResponse.json({ code: 'ALREADY_QUEUED', message: 'A diagnostic is already running for this site.' }, { status: 409 })

  const id = await enqueueMonitoringJob(websiteId, null, { kind }, 'diagnostic')
  return NextResponse.json({ ok: true, job_id: id, message: 'Diagnostic queued — results appear once the worker runs it.' }, { status: 201 })
}
