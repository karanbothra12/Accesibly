import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { isSuperadmin } from '@/lib/access'
import { dimensionBreakdown, type Dimension } from '@/lib/monitoring/analytics'

export const runtime = 'nodejs'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

// GET /api/internet-monitoring/analytics?dimension=isp|country|asn&period=7d&website_id=&min_samples=
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session.isLoggedIn || !session.merchantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const p = new URL(request.url).searchParams
  const dimension = (['isp', 'country', 'asn'].includes(p.get('dimension') || '') ? p.get('dimension') : 'isp') as Dimension
  const superadmin = await isSuperadmin(session.merchantId)

  const rows = await dimensionBreakdown({
    merchantId: session.merchantId,
    dimension,
    period: p.get('period') || '7d',
    websiteId: p.get('website_id') ? Number(p.get('website_id')) : null,
    minSamples: p.get('min_samples') ? Number(p.get('min_samples')) : 5,
    allMerchants: superadmin,
  })
  return NextResponse.json({ dimension, rows })
}
