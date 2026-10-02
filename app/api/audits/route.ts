import { NextRequest, NextResponse, after } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { processCrawlJob } from '@/lib/audit-runner'
import { isSuperadmin } from '@/lib/access'
import { getEntitlements, getLimit, getUsage, checkPages, consumeAuditSlot, releaseAuditSlot } from '@/lib/entitlements'
import { assertSafeUrl } from '@/lib/ssrf'

const HARD_PAGE_CEILING = 5000  // abuse guard; the real limit is plan-driven

// The crawl runs in-process via after(), which needs the Node runtime and
// a generous time budget (headless Chromium + axe across multiple pages).
export const runtime = 'nodejs'
export const maxDuration = 300

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/audits?site_id=X — list audit jobs for one of the merchant's sites
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(request.url).searchParams
  const siteId = Number(params.get('site_id'))
  if (!siteId) return NextResponse.json({ error: 'site_id is required' }, { status: 400 })
  // Filter by audit type; default to accessibility so existing callers are unaffected.
  const typeParam = params.get('type')
  const type = ['seo', 'html', 'css', 'security', 'links'].includes(typeParam ?? '') ? typeParam! : 'accessibility'

  const superadmin = await isSuperadmin(session.merchantId)
  const site = superadmin
    ? await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1', [siteId])
    : await queryOne<{ id: number }>('SELECT id FROM sites WHERE id = $1 AND merchant_id = $2', [siteId, session.merchantId])
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const jobs = await query(
    `SELECT id, mode, start_url, status, ruleset, max_pages, pages_crawled, total_issues,
            error_message AS error, job_type, seo_enabled, seo_score, created_at, started_at, finished_at
     FROM crawl_jobs WHERE site_id = $1 AND job_type = $2 ORDER BY created_at DESC LIMIT 50`,
    [siteId, type]
  )

  return NextResponse.json({ jobs })
}

// POST /api/audits — create a queued audit job and kick off the runner
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const siteId = Number(body.site_id)
  const TYPES = ['accessibility', 'seo', 'html', 'css', 'security', 'links'] as const
  type AuditType = typeof TYPES[number]
  const type: AuditType = (TYPES as readonly string[]).includes(body.type) ? body.type : 'accessibility'
  const isSeo = type === 'seo'
  const isHtml = type === 'html'
  const isCss = type === 'css'
  const isSecurity = type === 'security'
  const isLinks = type === 'links'
  // Security audits are site-level (single origin) — never a multi-page crawl.
  const mode: 'single' | 'full' = isSecurity ? 'single' : body.mode === 'full' ? 'full' : 'single'
  // Requested pages come from the client but the *limit* is enforced server-side.
  const requestedPages = Math.min(Math.max(Number(body.max_pages) || 20, 1), HARD_PAGE_CEILING)
  const confirmOverage = body.confirm_overage === true
  const RULESETS = ['default', 'wcag-strict', 'wcag-aaa', 'all']
  const ruleset = RULESETS.includes(body.ruleset) ? body.ruleset : 'default'

  // Per-type entitlement wiring — each audit type has its own feature, limits and usage counter.
  // pageLimitKey is null for site-level audits (security) that have no page dimension.
  const cfg: { feature: string; featureLabel: string; pageLimitKey: string | null; dailyKey: string; monthlyKey: string; usageType: string } = isSeo
    ? { feature: 'technical_seo_audit', featureLabel: 'Technical SEO Audit', pageLimitKey: 'seo_pages_per_audit', dailyKey: 'daily_seo_audits', monthlyKey: 'monthly_seo_audits', usageType: 'seo_audit' }
    : isHtml
    ? { feature: 'html_audit', featureLabel: 'HTML Validation', pageLimitKey: 'html_pages_per_audit', dailyKey: 'daily_html_audits', monthlyKey: 'monthly_html_audits', usageType: 'html_audit' }
    : isCss
    ? { feature: 'css_validation', featureLabel: 'CSS Validation', pageLimitKey: 'css_pages_per_audit', dailyKey: 'daily_css_audits', monthlyKey: 'monthly_css_audits', usageType: 'css_audit' }
    : isSecurity
    ? { feature: 'security_audit', featureLabel: 'Security & Headers Audit', pageLimitKey: null, dailyKey: 'daily_security_audits', monthlyKey: 'monthly_security_audits', usageType: 'security_audit' }
    : isLinks
    ? { feature: 'broken_links', featureLabel: 'Broken Link Checker', pageLimitKey: 'links_pages_per_audit', dailyKey: 'daily_links_audits', monthlyKey: 'monthly_links_audits', usageType: 'links_audit' }
    : { feature: 'website_audit', featureLabel: 'Website Audit', pageLimitKey: 'pages_per_audit', dailyKey: 'daily_audits', monthlyKey: 'monthly_audits', usageType: 'audit' }

  const superadmin = await isSuperadmin(session.merchantId)
  const site = superadmin
    ? await queryOne<{ id: number; domain: string }>('SELECT id, domain FROM sites WHERE id = $1', [siteId])
    : await queryOne<{ id: number; domain: string }>('SELECT id, domain FROM sites WHERE id = $1 AND merchant_id = $2', [siteId, session.merchantId])
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Resolve the starting URL: explicit input, else the site's domain root.
  // Local hosts (localhost / 127.0.0.1 / *.local) default to http, not https.
  const withScheme = (u: string): string => {
    if (/^https?:\/\//i.test(u)) return u
    const host = u.split('/')[0].toLowerCase()
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|.+\.local(host)?)(:\d+)?$/.test(host)
    return (isLocal ? 'http://' : 'https://') + u
  }
  let startUrl = String(body.start_url ?? '').trim()
  startUrl = withScheme(startUrl || site.domain)
  try {
    new URL(startUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid start_url' }, { status: 400 })
  }
  // SSRF guard: reject private/loopback/link-local/metadata targets in production.
  try {
    await assertSafeUrl(startUrl)
  } catch {
    return NextResponse.json({ code: 'UNSAFE_URL', error: 'That URL cannot be audited.' }, { status: 400 })
  }

  // ── Entitlement enforcement (server-side source of truth) ──────
  // Superadmins bypass plan limits (platform operators auditing any site).
  let planId: number | null = null
  let includedPages = requestedPages
  let extraPages = 0
  let extraCostCents = 0
  let consumed: number | null = null
  // An SEO job crawls for the SEO report; an accessibility job runs axe only.
  const seoEnabled = isSeo

  if (!superadmin) {
    const ent = await getEntitlements(session.merchantId!)
    if (!ent) return NextResponse.json({ code: 'NO_PLAN', message: 'No active plan.' }, { status: 402 })
    if (!ent.features[cfg.feature]) {
      return NextResponse.json({ code: 'FEATURE_DISABLED', message: `${cfg.featureLabel} is not included in your plan.`, upgradeRequired: true }, { status: 403 })
    }

    // Page limit / overage (does not consume a slot). Uses this type's page-limit key.
    // Site-level audits (security) have no page dimension — skip the check.
    const pageCheck = cfg.pageLimitKey
      ? checkPages(ent, requestedPages, confirmOverage, cfg.pageLimitKey)
      : ({ ok: true, includedPages: 1, extraPages: 0, extraCostCents: 0 } as const)
    if (!pageCheck.ok) return NextResponse.json(pageCheck.body, { status: pageCheck.status })

    // Daily + monthly limits for THIS audit type, consumed atomically (race-safe).
    const slot = await consumeAuditSlot(session.merchantId!, getLimit(ent, cfg.dailyKey), getLimit(ent, cfg.monthlyKey), cfg.usageType)
    if (!slot.ok) {
      const usage = await getUsage(session.merchantId!, cfg.usageType)
      return NextResponse.json({
        code: 'AUDIT_LIMIT_REACHED',
        message: `${slot.scope === 'day' ? 'Daily' : 'Monthly'} ${isSeo ? 'SEO ' : ''}audit limit reached.`,
        scope: slot.scope, limit: slot.limit,
        used: slot.scope === 'day' ? usage.day : usage.month,
        remaining: 0, upgradeRequired: true,
      }, { status: 429 })
    }

    planId = ent.plan.id
    includedPages = pageCheck.includedPages
    extraPages = pageCheck.extraPages
    extraCostCents = pageCheck.extraCostCents
    consumed = session.merchantId!
  }

  let job: { id: number } | null = null
  try {
    job = await queryOne<{ id: number }>(
      `INSERT INTO crawl_jobs (site_id, mode, start_url, max_pages, status, ruleset,
         plan_id, included_pages, extra_pages, extra_page_cost_cents, billing_status, seo_enabled, job_type)
       VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, mode, start_url, status, ruleset, max_pages, pages_crawled, total_issues, created_at`,
      [siteId, mode, startUrl, requestedPages, ruleset, planId, includedPages, extraPages, extraCostCents,
        extraPages > 0 ? 'overage' : 'included', seoEnabled, type]
    )
  } catch (e) {
    // Roll back the consumed slot so a failed insert doesn't burn the user's quota.
    if (consumed) await releaseAuditSlot(consumed, cfg.usageType)
    throw e
  }

  // Record the confirmed overage for this audit only — the plan limit is unchanged.
  if (extraPages > 0 && job) {
    await query(
      `INSERT INTO overage_records (merchant_id, job_id, kind, quantity, unit_price_cents, amount_cents, status)
       VALUES ($1, $2, 'extra_pages', $3, $4, $5, 'confirmed')`,
      [session.merchantId, job.id, extraPages, extraCostCents / Math.max(extraPages, 1), extraCostCents]
    )
  }

  // Process the crawl. With a dedicated background worker deployed
  // (CRAWL_WORKER_ENABLED=1) the job is left 'queued' for the worker to drain —
  // this decouples long full-site crawls from the serverless maxDuration limit.
  // Otherwise it runs in-process via after() once the response is sent.
  const jobId = job!.id
  if (process.env.CRAWL_WORKER_ENABLED !== '1') {
    after(async () => { await processCrawlJob(jobId) })
  }

  return NextResponse.json({ job }, { status: 201 })
}
