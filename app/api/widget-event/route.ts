import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { siteEntitlement } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

const str = (v: unknown, max = 120) => (v == null ? null : String(v).slice(0, max))

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// POST /api/widget-event — records an accessibility-widget interaction.
// Public (sent by the widget via sendBeacon/fetch). Privacy-safe: no PII, no IP.
// Fails soft (always 204) so the widget never surfaces errors on a customer site.
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    if (!raw || raw.length > 2000) return new NextResponse(null, { status: 204, headers: CORS })
    let body: Record<string, unknown>
    try { body = JSON.parse(raw) } catch { return new NextResponse(null, { status: 204, headers: CORS }) }

    const siteKey = str(body.k, 200)
    const action = str(body.a, 20)
    if (!siteKey || !action) return new NextResponse(null, { status: 204, headers: CORS })
    if (action !== 'open' && action !== 'tool' && action !== 'reset') return new NextResponse(null, { status: 204, headers: CORS })

    // Only record for active sites whose plan includes the widget.
    const ent = await siteEntitlement(siteKey)
    if (!ent || !ent.isActive || !ent.hasWidget) return new NextResponse(null, { status: 204, headers: CORS })

    await query(
      'INSERT INTO widget_events (site_id, action, tool, path) VALUES ($1, $2, $3, $4)',
      [ent.siteId, action, str(body.t, 120), str(body.p, 300)]
    ).catch(() => {})

    return new NextResponse(null, { status: 204, headers: CORS })
  } catch {
    return new NextResponse(null, { status: 204, headers: CORS })
  }
}
