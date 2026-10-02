import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { getAllSettings, setSetting } from '@/lib/settings'

async function guard() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
  if (!session.isLoggedIn || !(await isSuperadmin(session.merchantId))) return null
  return session
}

const BILLING_PERIODS = ['monthly', 'yearly']
const str = (v: unknown, max = 500) => (v == null ? null : String(v).slice(0, max))
const int = (v: unknown, def = 0) => (v == null || isNaN(Number(v)) ? def : Math.trunc(Number(v)))

// Upsert the plan's feature toggles and limit values from {key: value} maps.
async function upsertConfig(planId: number, features?: Record<string, unknown>, limits?: Record<string, unknown>) {
  if (features && typeof features === 'object') {
    for (const [key, enabled] of Object.entries(features)) {
      await query(
        `INSERT INTO plan_features (plan_id, feature_key, enabled) VALUES ($1, $2, $3)
         ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
        [planId, key, !!enabled]
      )
    }
  }
  if (limits && typeof limits === 'object') {
    for (const [key, value] of Object.entries(limits)) {
      await query(
        `INSERT INTO plan_limits (plan_id, limit_key, limit_value) VALUES ($1, $2, $3)
         ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value`,
        [planId, key, int(value)]
      )
    }
  }
}

// GET /api/admin/plans — all plans (with features + limits) plus catalogs for the editor.
export async function GET() {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [plans, pf, pl, features, limitDefs, counts, settings] = await Promise.all([
    query('SELECT * FROM plans ORDER BY sort_order, id'),
    query<{ plan_id: number; feature_key: string; enabled: boolean }>('SELECT plan_id, feature_key, enabled FROM plan_features'),
    query<{ plan_id: number; limit_key: string; limit_value: number }>('SELECT plan_id, limit_key, limit_value FROM plan_limits'),
    query('SELECT key, label, description, sort_order FROM features ORDER BY sort_order'),
    query('SELECT key, label, period, unit, sort_order FROM limit_definitions ORDER BY sort_order'),
    query<{ plan_id: number; c: string }>('SELECT plan_id, COUNT(*) c FROM subscriptions GROUP BY plan_id'),
    getAllSettings(),
  ])
  const subCount: Record<number, number> = {}
  for (const c of counts) subCount[c.plan_id] = Number(c.c)

  return NextResponse.json({
    plans: (plans as Record<string, unknown>[]).map(p => ({
      ...p,
      subscribers: subCount[p.id as number] || 0,
      features: Object.fromEntries(pf.filter(x => x.plan_id === p.id).map(x => [x.feature_key, x.enabled])),
      limits: Object.fromEntries(pl.filter(x => x.plan_id === p.id).map(x => [x.limit_key, Number(x.limit_value)])),
    })),
    catalog: { features, limits: limitDefs },
    settings: Object.fromEntries(settings.map(s => [s.key, { value: s.value, label: s.label }])),
  })
}

// POST /api/admin/plans — create a plan.
export async function POST(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))
  const key = str(b.key, 60)?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
  const name = str(b.name, 120)?.trim()
  if (!key || !name) return NextResponse.json({ error: 'key and name are required' }, { status: 400 })
  const billing = BILLING_PERIODS.includes(b.billing_period) ? b.billing_period : 'monthly'

  const existing = await queryOne('SELECT id FROM plans WHERE key = $1', [key])
  if (existing) return NextResponse.json({ error: 'A plan with that key already exists' }, { status: 409 })

  const plan = await queryOne<{ id: number }>(
    `INSERT INTO plans (key, name, description, price_cents, price_yearly_cents, billing_period, page_overage_enabled, extra_page_price_cents, sort_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,TRUE)) RETURNING id`,
    [key, name, str(b.description, 500), int(b.price_cents), int(b.price_yearly_cents), billing, !!b.page_overage_enabled, int(b.extra_page_price_cents), int(b.sort_order), b.is_active]
  )
  await upsertConfig(plan!.id, b.features, b.limits)
  return NextResponse.json({ id: plan!.id }, { status: 201 })
}

// PATCH /api/admin/plans — update plan fields, features, limits, status.
export async function PATCH(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))

  // Settings-only update (platform config like the RUM add-on price).
  if (!b.id && b.settings && typeof b.settings === 'object') {
    const allowed = new Set(['rum_addon_price_cents'])
    for (const [key, value] of Object.entries(b.settings as Record<string, unknown>)) {
      if (!allowed.has(key)) continue
      const n = Math.max(0, Math.trunc(Number(value)))
      if (Number.isFinite(n)) await setSetting(key, String(n))
    }
    return NextResponse.json({ ok: true })
  }

  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const plan = await queryOne<{ id: number }>('SELECT id FROM plans WHERE id = $1', [id])
  if (!plan) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sets: string[] = []
  const vals: unknown[] = []
  const set = (col: string, v: unknown) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v) }
  if (b.name !== undefined) set('name', str(b.name, 120))
  if (b.description !== undefined) set('description', str(b.description, 500))
  if (b.price_cents !== undefined) set('price_cents', int(b.price_cents))
  if (b.price_yearly_cents !== undefined) set('price_yearly_cents', int(b.price_yearly_cents))
  if (b.billing_period !== undefined && BILLING_PERIODS.includes(b.billing_period)) set('billing_period', b.billing_period)
  if (b.page_overage_enabled !== undefined) set('page_overage_enabled', !!b.page_overage_enabled)
  if (b.extra_page_price_cents !== undefined) set('extra_page_price_cents', int(b.extra_page_price_cents))
  if (b.is_active !== undefined) set('is_active', !!b.is_active)
  if (b.is_archived !== undefined) set('is_archived', !!b.is_archived)
  if (b.sort_order !== undefined) set('sort_order', int(b.sort_order))
  if (sets.length) {
    vals.push(id)
    await query(`UPDATE plans SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals)
  }
  await upsertConfig(id, b.features, b.limits)
  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/plans — archive (never hard-delete; subscriptions reference it).
export async function DELETE(request: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await request.json().catch(() => ({}))
  const id = Number(b.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await query('UPDATE plans SET is_archived = TRUE, is_active = FALSE, updated_at = NOW() WHERE id = $1', [id])
  return NextResponse.json({ ok: true })
}
