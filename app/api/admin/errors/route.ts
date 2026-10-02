import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'

async function guard() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
  if (!session.isLoggedIn || !(await isSuperadmin(session.merchantId))) return null
  return session
}

// GET /api/admin/errors?filter=unresolved&source=server — recent errors + counts.
export async function GET(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = new URL(request.url).searchParams
  const filter = sp.get('filter') === 'all' ? 'all' : 'unresolved'
  const source = sp.get('source')
  const validSource = ['server', 'api', 'client', 'job'].includes(source || '') ? source : null

  const where: string[] = []
  const params: unknown[] = []
  if (filter === 'unresolved') where.push('resolved = FALSE')
  if (validSource) { params.push(validSource); where.push(`source = $${params.length}`) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const errors = await query(
    `SELECT id, source, level, message, stack, path, method, merchant_id, meta, resolved, created_at
     FROM error_logs ${whereSql} ORDER BY created_at DESC LIMIT 200`,
    params
  )
  const [counts] = await query<{ total: string; unresolved: string; server: string; client: string; api: string; job: string }>(
    `SELECT COUNT(*) total,
            COUNT(*) FILTER (WHERE NOT resolved) unresolved,
            COUNT(*) FILTER (WHERE source='server') server,
            COUNT(*) FILTER (WHERE source='client') client,
            COUNT(*) FILTER (WHERE source='api') api,
            COUNT(*) FILTER (WHERE source='job') job
     FROM error_logs`
  )
  return NextResponse.json({ errors, counts })
}

// PATCH /api/admin/errors — resolve one ({id}) or all ({resolveAll:true}).
export async function PATCH(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))
  if (b.resolveAll === true) {
    await query('UPDATE error_logs SET resolved = TRUE WHERE resolved = FALSE')
    return NextResponse.json({ ok: true })
  }
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await query('UPDATE error_logs SET resolved = $2 WHERE id = $1', [id, b.resolved !== false])
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/errors — delete one ({id}) or clear ({clear:'resolved'|'all'}).
export async function DELETE(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))
  if (b.clear === 'all') { await query('DELETE FROM error_logs'); return NextResponse.json({ ok: true }) }
  if (b.clear === 'resolved') { await query('DELETE FROM error_logs WHERE resolved = TRUE'); return NextResponse.json({ ok: true }) }
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await queryOne('DELETE FROM error_logs WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
