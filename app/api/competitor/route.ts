import { NextRequest, NextResponse, after } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { hasFeature, getEntitlements, getLimit, getUsage, consumeAuditSlot, releaseAuditSlot } from '@/lib/entitlements'
import { normalizeUrl } from '@/lib/competitor'
import { processCompetitorReport } from '@/lib/competitor-runner'
import { assertSafeUrl } from '@/lib/ssrf'

export const runtime = 'nodejs'
export const maxDuration = 120

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/competitor?site_id=X — recent comparison reports.
// Superadmins can view any site's reports (by site_id); merchants see only their own.
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const siteId = Number(new URL(request.url).searchParams.get('site_id')) || null
  const superadmin = await isSuperadmin(session.merchantId)

  let reports
  if (superadmin && siteId) {
    // Any merchant's reports for this specific site.
    reports = await query(
      `SELECT id, site_id, your_url, competitor_url, status, error, result, created_at
       FROM competitor_reports WHERE site_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [siteId]
    )
  } else {
    reports = await query(
      `SELECT id, site_id, your_url, competitor_url, status, error, result, created_at
       FROM competitor_reports
       WHERE merchant_id = $1 ${siteId ? 'AND site_id = $2' : ''}
       ORDER BY created_at DESC LIMIT 20`,
      siteId ? [session.merchantId, siteId] : [session.merchantId]
    )
  }
  return NextResponse.json({ reports })
}

// POST /api/competitor — run a scorecard for your site vs a competitor URL. Gated.
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const superadmin = await isSuperadmin(session.merchantId)
  if (!superadmin && !(await hasFeature(session.merchantId, 'competitor_analysis'))) {
    return NextResponse.json({ code: 'FEATURE_DISABLED', message: 'Competitor Analysis is not included in your plan.' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const siteId = Number(body.site_id)
  const site = superadmin
    ? await queryOne<{ id: number; domain: string }>('SELECT id, domain FROM sites WHERE id = $1', [siteId])
    : await queryOne<{ id: number; domain: string }>('SELECT id, domain FROM sites WHERE id = $1 AND merchant_id = $2', [siteId, session.merchantId])
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const yourUrl = normalizeUrl(String(body.your_url || '') || site.domain)
  const competitorUrl = normalizeUrl(String(body.competitor_url || ''))
  if (!yourUrl) return NextResponse.json({ error: 'Invalid site URL' }, { status: 400 })
  if (!competitorUrl) return NextResponse.json({ error: 'Enter a valid competitor URL' }, { status: 400 })
  // SSRF guard on both targets.
  try {
    await assertSafeUrl(yourUrl)
    await assertSafeUrl(competitorUrl)
  } catch {
    return NextResponse.json({ code: 'UNSAFE_URL', error: 'One of those URLs cannot be analyzed.' }, { status: 400 })
  }

  // Usage quota (race-safe) — competitor checks launch two headless browsers,
  // so they're rate-limited per plan just like audits. Superadmins bypass.
  let consumed = false
  if (!superadmin) {
    const ent = await getEntitlements(session.merchantId)
    if (!ent) return NextResponse.json({ code: 'NO_PLAN', message: 'No active plan.' }, { status: 402 })
    const slot = await consumeAuditSlot(
      session.merchantId,
      getLimit(ent, 'daily_competitor_reports'),
      getLimit(ent, 'monthly_competitor_reports'),
      'competitor',
    )
    if (!slot.ok) {
      const usage = await getUsage(session.merchantId, 'competitor')
      return NextResponse.json({
        code: 'AUDIT_LIMIT_REACHED',
        message: `${slot.scope === 'day' ? 'Daily' : 'Monthly'} competitor-check limit reached.`,
        scope: slot.scope, limit: slot.limit,
        used: slot.scope === 'day' ? usage.day : usage.month, remaining: 0, upgradeRequired: true,
      }, { status: 429 })
    }
    consumed = true
  }

  // Create a pending row and run the comparison in the background, so switching
  // tabs or navigating away doesn't lose the result.
  let saved: { id: number; created_at: string } | null = null
  try {
    saved = await queryOne<{ id: number; created_at: string }>(
      `INSERT INTO competitor_reports (merchant_id, site_id, your_url, competitor_url, status)
       VALUES ($1,$2,$3,$4,'pending') RETURNING id, created_at`,
      [session.merchantId, site.id, yourUrl, competitorUrl]
    )
  } catch (e) {
    if (consumed) await releaseAuditSlot(session.merchantId, 'competitor')
    throw e
  }
  const reportId = saved!.id
  after(async () => { await processCompetitorReport(reportId) })

  return NextResponse.json({ id: reportId, created_at: saved!.created_at, your_url: yourUrl, competitor_url: competitorUrl, status: 'pending' }, { status: 201 })
}
