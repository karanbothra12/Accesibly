import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { getEntitlements, getLimit } from '@/lib/entitlements'
import { allowedIntervals, MONITOR_INTERVALS } from '@/lib/monitors'

export const runtime = 'nodejs'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

type Schedule = {
  job_type: string; interval_days: number; enabled: boolean
  next_run_at: string | null; last_run_at: string | null; last_issues: number | null; last_score: number | null
}

// Resolve the merchant's monitoring entitlement (superadmins get everything).
async function entitlement(merchantId: number, superadmin: boolean) {
  if (superadmin) return { available: true, minInterval: 1, intervals: [...MONITOR_INTERVALS], monitoredLimit: -1 }
  const ent = await getEntitlements(merchantId)
  const available = !!ent?.features['scheduled_monitoring']
  const minInterval = ent ? getLimit(ent, 'min_monitor_interval_days') : 0
  return {
    available,
    minInterval,
    intervals: available ? allowedIntervals(minInterval) : [],
    monitoredLimit: ent ? getLimit(ent, 'monitored_sites') : 0,
  }
}

async function ownSite(siteId: number, merchantId: number, superadmin: boolean) {
  return superadmin
    ? queryOne<{ id: number; merchant_id: number }>('SELECT id, merchant_id FROM sites WHERE id = $1', [siteId])
    : queryOne<{ id: number; merchant_id: number }>('SELECT id, merchant_id FROM sites WHERE id = $1 AND merchant_id = $2', [siteId, merchantId])
}

// GET /api/monitors?site_id=X — entitlement + this site's schedules.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const siteId = Number(new URL(request.url).searchParams.get('site_id'))
  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })

  const superadmin = await isSuperadmin(session.merchantId)
  const site = await ownSite(siteId, session.merchantId, superadmin)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ent = await entitlement(session.merchantId, superadmin)
  const schedules = await query<Schedule>(
    `SELECT job_type, interval_days, enabled, next_run_at, last_run_at, last_issues, last_score
     FROM monitor_schedules WHERE site_id = $1`,
    [siteId]
  )
  const [{ c: monitoredSites }] = await query<{ c: string }>(
    `SELECT COUNT(DISTINCT ms.site_id) c FROM monitor_schedules ms JOIN sites s ON s.id = ms.site_id
     WHERE s.merchant_id = $1 AND ms.enabled = TRUE`,
    [site.merchant_id]
  )

  return NextResponse.json({ ...ent, monitoredSites: Number(monitoredSites || 0), schedules })
}

// PUT /api/monitors — create/update a schedule { site_id, job_type, interval_days, enabled }
export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const siteId = Number(body.site_id)
  const jobType = String(body.job_type || '')
  const intervalDays = Number(body.interval_days)
  const enabled = body.enabled !== false
  const TYPES = ['accessibility', 'seo', 'html', 'css', 'links', 'security']
  if (!siteId || !TYPES.includes(jobType)) return NextResponse.json({ error: 'Invalid site_id or job_type' }, { status: 400 })

  const superadmin = await isSuperadmin(session.merchantId)
  const site = await ownSite(siteId, session.merchantId, superadmin)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ent = await entitlement(session.merchantId, superadmin)

  if (enabled) {
    if (!ent.available) return NextResponse.json({ code: 'FEATURE_DISABLED', message: 'Scheduled Monitoring is not included in your plan.', upgradeRequired: true }, { status: 403 })
    if (!ent.intervals.includes(intervalDays)) {
      return NextResponse.json({ code: 'CADENCE_NOT_ALLOWED', message: `Your plan allows cadences: ${ent.intervals.join(', ')} day(s).`, allowed: ent.intervals }, { status: 403 })
    }
    // Enforce the monitored-sites limit (only when adding a NEW site).
    if (ent.monitoredLimit !== -1) {
      const already = await queryOne<{ n: string }>(
        `SELECT COUNT(*) n FROM monitor_schedules WHERE site_id = $1 AND enabled = TRUE`, [siteId]
      )
      const siteAlreadyMonitored = Number(already?.n || 0) > 0
      if (!siteAlreadyMonitored) {
        const [{ c }] = await query<{ c: string }>(
          `SELECT COUNT(DISTINCT ms.site_id) c FROM monitor_schedules ms JOIN sites s ON s.id = ms.site_id
           WHERE s.merchant_id = $1 AND ms.enabled = TRUE`, [site.merchant_id]
        )
        if (Number(c || 0) >= ent.monitoredLimit) {
          return NextResponse.json({ code: 'MONITOR_LIMIT_REACHED', message: `Your plan allows monitoring ${ent.monitoredLimit} site(s).`, limit: ent.monitoredLimit, upgradeRequired: true }, { status: 403 })
        }
      }
    }
  }

  const row = await queryOne<Schedule>(
    `INSERT INTO monitor_schedules (site_id, job_type, interval_days, enabled, next_run_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NOW() ELSE NOW() + make_interval(days => $3) END)
     ON CONFLICT (site_id, job_type) DO UPDATE
       SET interval_days = EXCLUDED.interval_days,
           enabled = EXCLUDED.enabled,
           next_run_at = CASE WHEN EXCLUDED.enabled AND monitor_schedules.enabled = FALSE THEN NOW() ELSE monitor_schedules.next_run_at END,
           updated_at = NOW()
     RETURNING job_type, interval_days, enabled, next_run_at, last_run_at, last_issues, last_score`,
    [siteId, jobType, intervalDays || 7, enabled]
  )
  return NextResponse.json({ schedule: row })
}

// DELETE /api/monitors?site_id=X&job_type=Y — remove a schedule
export async function DELETE(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const params = new URL(request.url).searchParams
  const siteId = Number(params.get('site_id'))
  const jobType = String(params.get('job_type') || '')
  if (!siteId || !jobType) return NextResponse.json({ error: 'site_id and job_type required' }, { status: 400 })

  const superadmin = await isSuperadmin(session.merchantId)
  const site = await ownSite(siteId, session.merchantId, superadmin)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await query('DELETE FROM monitor_schedules WHERE site_id = $1 AND job_type = $2', [siteId, jobType])
  return NextResponse.json({ ok: true })
}
