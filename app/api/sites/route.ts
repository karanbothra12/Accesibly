import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/sites — list merchant's sites
export async function GET() {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sites = await query(
    `SELECT id, domain, site_key, is_active, rum_enabled, created_at
     FROM sites WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [session.merchantId]
  )

  return NextResponse.json({ sites })
}

// POST /api/sites — add a new site
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain } = await request.json()
  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'Domain is required' }, { status: 400 })
  }

  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')

  const rows = await query(
    `INSERT INTO sites (merchant_id, domain)
     VALUES ($1, $2)
     RETURNING id, domain, site_key, is_active, rum_enabled, created_at`,
    [session.merchantId, clean]
  )

  return NextResponse.json({ site: rows[0] }, { status: 201 })
}

// PATCH /api/sites — toggle active or rename
export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, is_active, domain, rum_enabled, widget_position, widget_hidden } = await request.json()

  // Ownership check
  const site = await queryOne<{ id: number }>(
    'SELECT id FROM sites WHERE id = $1 AND merchant_id = $2',
    [id, session.merchantId]
  )
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (typeof is_active === 'boolean') {
    await query('UPDATE sites SET is_active = $1 WHERE id = $2', [is_active, id])
  }
  if (typeof rum_enabled === 'boolean') {
    await query('UPDATE sites SET rum_enabled = $1 WHERE id = $2', [rum_enabled, id])
  }
  if (domain) {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
    await query('UPDATE sites SET domain = $1 WHERE id = $2', [clean, id])
  }
  // Widget placement config.
  const POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left']
  if (typeof widget_position === 'string' && POSITIONS.includes(widget_position)) {
    await query('UPDATE sites SET widget_position = $1 WHERE id = $2', [widget_position, id])
  }
  if (typeof widget_hidden === 'boolean') {
    await query('UPDATE sites SET widget_hidden = $1 WHERE id = $2', [widget_hidden, id])
  }

  const updated = await queryOne('SELECT id, domain, site_key, is_active, rum_enabled, widget_position, widget_hidden FROM sites WHERE id = $1', [id])
  return NextResponse.json({ site: updated })
}

// DELETE /api/sites
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await request.json()

  const site = await queryOne<{ id: number }>(
    'SELECT id FROM sites WHERE id = $1 AND merchant_id = $2',
    [id, session.merchantId]
  )
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await query('DELETE FROM sites WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
