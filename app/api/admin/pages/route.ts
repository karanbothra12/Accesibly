import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { normalizeSlug, type ContentPage } from '@/lib/pages'

async function guard() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
  if (!session.isLoggedIn || !(await isSuperadmin(session.merchantId))) return null
  return session
}

const str = (v: unknown, max = 100000) => (v == null ? null : String(v).slice(0, max))

// GET /api/admin/pages — all content pages.
export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const pages = await query<ContentPage>('SELECT * FROM content_pages ORDER BY slug')
  return NextResponse.json({ pages })
}

// POST /api/admin/pages — create a page.
export async function POST(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))
  const slug = normalizeSlug(b.slug || b.title || '')
  const title = str(b.title, 200)?.trim()
  if (!slug || !title) return NextResponse.json({ error: 'Title (and a resulting slug) are required' }, { status: 400 })

  const existing = await queryOne('SELECT id FROM content_pages WHERE slug = $1', [slug])
  if (existing) return NextResponse.json({ error: 'A page with that slug already exists' }, { status: 409 })

  const row = await queryOne<{ id: number }>(
    `INSERT INTO content_pages (slug, title, seo_title, seo_description, body, is_published)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE)) RETURNING id`,
    [slug, title, str(b.seo_title, 200), str(b.seo_description, 400), str(b.body) ?? '', b.is_published]
  )
  return NextResponse.json({ id: row!.id, slug }, { status: 201 })
}

// PATCH /api/admin/pages — update a page.
export async function PATCH(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const sets: string[] = []
  const vals: unknown[] = []
  const set = (col: string, v: unknown) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v) }
  if (b.slug !== undefined) {
    const slug = normalizeSlug(b.slug)
    if (!slug) return NextResponse.json({ error: 'Invalid slug' }, { status: 400 })
    const clash = await queryOne('SELECT id FROM content_pages WHERE slug = $1 AND id <> $2', [slug, id])
    if (clash) return NextResponse.json({ error: 'Another page already uses that slug' }, { status: 409 })
    set('slug', slug)
  }
  if (b.title !== undefined) set('title', str(b.title, 200))
  if (b.seo_title !== undefined) set('seo_title', str(b.seo_title, 200))
  if (b.seo_description !== undefined) set('seo_description', str(b.seo_description, 400))
  if (b.body !== undefined) set('body', str(b.body) ?? '')
  if (b.is_published !== undefined) set('is_published', !!b.is_published)
  if (!sets.length) return NextResponse.json({ ok: true })

  vals.push(id)
  await query(`UPDATE content_pages SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals)
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/pages — permanently delete a page.
export async function DELETE(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await query('DELETE FROM content_pages WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
