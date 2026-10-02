import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { hasFeature } from '@/lib/entitlements'
import { buildReportHtml, reportBaseName, type ReportJob, type ReportPage } from '@/lib/report'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 60

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/audits/[id]/pdf — download an audit as a PDF. Gated by the pdf_reports feature.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const jobId = Number((await params).id)
  if (!jobId) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })

  const superadmin = await isSuperadmin(session.merchantId)
  if (!superadmin && !(await hasFeature(session.merchantId, 'pdf_reports'))) {
    return NextResponse.json({ code: 'FEATURE_DISABLED', message: 'PDF Reports are not included in your plan.' }, { status: 403 })
  }

  // Ownership enforced via the join to the merchant's sites (superadmins see all).
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

  const html = buildReportHtml(job, pages)

  const browser = await launchBrowser()
  let pdf: Buffer
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
  } finally {
    await browser.close()
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${reportBaseName(job)}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
