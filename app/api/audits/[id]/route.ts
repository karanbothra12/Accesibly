import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/audits/[id] — job status + per-page results (polled by the UI)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = Number((await params).id)
  if (!jobId) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })

  // Ownership enforced via the join to the merchant's sites (superadmins see all).
  const superadmin = await isSuperadmin(session.merchantId)
  const job = await queryOne(
    `SELECT j.id, j.site_id, j.mode, j.start_url, j.status, j.ruleset, j.max_pages,
            j.pages_crawled, j.total_issues, j.error_message AS error,
            j.job_type, j.seo_enabled, j.seo_score, j.seo_site,
            j.created_at, j.started_at, j.finished_at
     FROM crawl_jobs j
     JOIN sites s ON s.id = j.site_id
     WHERE j.id = $1 ${superadmin ? '' : 'AND s.merchant_id = $2'}`,
    superadmin ? [jobId] : [jobId, session.merchantId]
  )
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // `violations` is the raw axe array; `issue_count` is the rule count.
  // Derive the per-impact breakdown here so the table stays denormalized.
  type Row = {
    id: number
    url: string
    status_code: number
    violations: Array<{ impact: string | null }>
    issue_count: number
    error: string | null
    seo: unknown | null
    html: unknown | null
    css: unknown | null
    security: unknown | null
    links: unknown | null
    crawled_at: string
  }
  const rows = await query<Row>(
    `SELECT id, url, status_code, violations, issue_count, error, seo, html, css, security, links, crawled_at
     FROM crawl_pages WHERE job_id = $1
     ORDER BY issue_count DESC, id ASC`,
    [jobId]
  )

  const pages = rows.map(r => {
    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
    const raw = Array.isArray(r.violations) ? r.violations : []
    for (const v of raw) {
      const impact = (v.impact ?? 'minor') as keyof typeof counts
      if (impact in counts) counts[impact]++
      else counts.minor++
    }
    return {
      id: r.id,
      url: r.url,
      status_code: r.status_code,
      violations: r.issue_count,
      ...counts,
      results: raw,
      seo: r.seo ?? null,
      html: r.html ?? null,
      css: r.css ?? null,
      security: r.security ?? null,
      links: r.links ?? null,
      error: r.error,
      audited_at: r.crawled_at,
    }
  })

  return NextResponse.json({ job, pages })
}

// PATCH /api/audits/[id] — cancel a queued or running audit (owner only).
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session.isLoggedIn) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = Number((await params).id)
  if (!jobId) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })

  // Flip to 'cancelled' only if owned (or superadmin) and still in progress.
  const superadmin = await isSuperadmin(session.merchantId)
  const updated = await queryOne(
    `UPDATE crawl_jobs j
       SET status = 'cancelled', finished_at = NOW()
     FROM sites s
     WHERE j.site_id = s.id
       AND j.id = $1 ${superadmin ? '' : 'AND s.merchant_id = $2'}
       AND j.status IN ('queued', 'running')
     RETURNING j.id, j.status`,
    superadmin ? [jobId] : [jobId, session.merchantId]
  )

  if (!updated) {
    return NextResponse.json({ error: 'Job not found or not cancellable' }, { status: 404 })
  }

  return NextResponse.json({ job: updated })
}
