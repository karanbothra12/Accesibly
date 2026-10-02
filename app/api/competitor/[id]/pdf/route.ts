import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { queryOne } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { hasFeature } from '@/lib/entitlements'
import { buildCompetitorHtml, type CompetitorReport } from '@/lib/report'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 60

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/competitor/[id]/pdf — download a competitor comparison as PDF. Gated by pdf_reports.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number((await params).id)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const superadmin = await isSuperadmin(session.merchantId)
  if (!superadmin && !(await hasFeature(session.merchantId, 'pdf_reports'))) {
    return NextResponse.json({ code: 'FEATURE_DISABLED', message: 'PDF Reports are not included in your plan.' }, { status: 403 })
  }

  const rep = await queryOne<CompetitorReport & { status: string }>(
    `SELECT your_url, competitor_url, created_at, status, result
     FROM competitor_reports
     WHERE id = $1 ${superadmin ? '' : 'AND merchant_id = $2'}`,
    superadmin ? [id] : [id, session.merchantId]
  )
  if (!rep) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (rep.status !== 'done' || !rep.result) return NextResponse.json({ error: 'Comparison not finished yet' }, { status: 409 })

  const html = buildCompetitorHtml(rep)
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
      'Content-Disposition': `attachment; filename="competitor-${id}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
