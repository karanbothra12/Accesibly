import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { hasFeature } from '@/lib/entitlements'
import { buildReportCsv, reportBaseName, type ReportJob, type ReportPage } from '@/lib/report'

export const runtime = 'nodejs'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/audits/[id]/csv — download an audit's findings as CSV.
// Gated by the same pdf_reports (exports) feature as the PDF report.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = Number((await params).id)
  if (!jobId) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })

  const superadmin = await isSuperadmin(session.merchantId)
  if (!superadmin && !(await hasFeature(session.merchantId, 'pdf_reports'))) {
    return NextResponse.json({ code: 'FEATURE_DISABLED', message: 'Exports are not included in your plan.' }, { status: 403 })
  }

  const job = await queryOne<ReportJob>(
    `SELECT j.id, s.domain, j.start_url, j.job_type, j.status, j.pages_crawled, j.total_issues,
            j.seo_score, j.ruleset, j.created_at, j.finished_at, j.seo_site
     FROM crawl_jobs j JOIN sites s ON s.id = j.site_id
     WHERE j.id = $1 ${superadmin ? '' : 'AND s.merchant_id = $2'}`,
    superadmin ? [jobId] : [jobId, session.merchantId]
  )
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const pages = await query<ReportPage>(
    `SELECT url, status_code, issue_count, violations, seo, html, css, links, security
     FROM crawl_pages WHERE job_id = $1 ORDER BY issue_count DESC, id ASC`,
    [jobId]
  )

  // Prepend a UTF-8 BOM so Excel opens non-ASCII characters correctly.
  const csv = '﻿' + buildReportCsv(job, pages)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${reportBaseName(job)}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
