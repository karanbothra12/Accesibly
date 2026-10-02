import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { siteEntitlement } from '@/lib/entitlements'

// /api/ping?site_key=xxx — widget health check + pageview log (public, CORS open).
// Accepts GET (widget fetch) and POST (navigator.sendBeacon) — both carry the
// params in the query string, so they share one handler.
async function handlePing(request: NextRequest) {
  const start = Date.now()
  const { searchParams } = new URL(request.url)
  const siteKey = searchParams.get('site_key')

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  }

  if (!siteKey) {
    return NextResponse.json({ ok: false, error: 'Missing site_key' }, { status: 400, headers: corsHeaders })
  }

  // Resolve the site + its plan-feature flags (widget, RUM) — entitlements
  // enforced server-side so a plan without the widget can't render it.
  const site = await siteEntitlement(siteKey)

  const success = !!(site && site.isActive)
  const responseMs = Date.now() - start

  if (site) {
    // Log the ping asynchronously — don't await so we can respond fast
    query(
      'INSERT INTO ping_log (site_id, success, response_ms) VALUES ($1, $2, $3)',
      [site.siteId, success, responseMs]
    ).catch(() => {/* best-effort */})

    // Log pageview event (no PII — no IP, no user ID)
    const path = searchParams.get('path') || '/'
    const widgetOpened = searchParams.get('widget_opened') === '1'
    query(
      'INSERT INTO pageview_events (site_id, path, widget_opened) VALUES ($1, $2, $3)',
      [site.siteId, path, widgetOpened]
    ).catch(() => {/* best-effort */})
  }

  if (!success) {
    return NextResponse.json({ ok: false, error: 'Site not found or inactive' }, { status: 404, headers: corsHeaders })
  }

  // `widget` gates rendering; `rum` tells the loader whether to load the RUM agent.
  // RUM requires both the plan feature and the per-site toggle.
  return NextResponse.json({
    ok: true,
    widget: site.hasWidget,
    rum: site.rumEnabled && site.hasRum,
    pos: site.widgetPosition,
    hidden: site.widgetHidden,
  }, { headers: corsHeaders })
}

export const GET = handlePing
export const POST = handlePing

// OPTIONS /api/ping — CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
