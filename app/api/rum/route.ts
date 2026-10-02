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

// Bulk multi-row insert. `table`/`cols` are internal constants (never user input).
async function bulkInsert(table: string, cols: string[], rows: unknown[][]) {
  if (!rows.length) return
  const values: unknown[] = []
  const tuples = rows.map((row, r) => {
    const ph = cols.map((_, c) => `$${r * cols.length + c + 1}`)
    values.push(...row)
    return `(${ph.join(',')})`
  })
  await query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, values)
}

const num = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v))
const str = (v: unknown, max = 2000) => (v == null ? null : String(v).slice(0, max))

// POST /api/rum — telemetry ingestion (public, sendBeacon/fetch). Fails soft:
// always returns 204 so the agent never retries or surfaces errors on the site.
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text()
    if (!raw) return new NextResponse(null, { status: 204, headers: CORS })

    let body: Record<string, unknown>
    try { body = JSON.parse(raw) } catch { return new NextResponse(null, { status: 204, headers: CORS }) }

    const siteKey = str(body.k, 200)
    if (!siteKey) return new NextResponse(null, { status: 204, headers: CORS })

    // Only ingest when the plan includes RUM monitoring AND the per-site toggle
    // is on — enforced server-side so it can't be bypassed by loading the agent.
    const ent = await siteEntitlement(siteKey)
    if (!ent || !ent.isActive || !ent.rumEnabled || !ent.hasRum) {
      return new NextResponse(null, { status: 204, headers: CORS })
    }

    const siteId = ent.siteId
    const sid = str(body.s, 128)
    const pvid = str(body.v, 128)

    // Geolocation from CDN edge headers (Vercel / Cloudflare) — derived from the
    // visitor's request IP by the platform; we store only these fields, never the IP.
    const h = request.headers
    const dec = (v: string | null) => { try { return v ? decodeURIComponent(v) : null } catch { return v } }
    const country = str(h.get('x-vercel-ip-country') || h.get('cf-ipcountry') || h.get('x-country') || '', 8) || null
    const city = str(dec(h.get('x-vercel-ip-city')) || h.get('cf-ipcity') || '', 120) || null
    const region = str(dec(h.get('x-vercel-ip-country-region')) || h.get('cf-region-code') || '', 120) || null
    const latitude = num(h.get('x-vercel-ip-latitude') || h.get('cf-iplatitude'))
    const longitude = num(h.get('x-vercel-ip-longitude') || h.get('cf-iplongitude'))

    // Page view (with metrics) — one row.
    const p = body.p as Record<string, unknown> | undefined
    if (p && typeof p === 'object') {
      await query(
        `INSERT INTO rum_page_views
           (site_id, session_id, page_view_id, path, referrer, browser, browser_version, os, device_type,
            connection, country, city, region, latitude, longitude,
            viewport_w, viewport_h, duration_ms, ttfb, fcp, lcp, inp, cls,
            dom_interactive, dom_content_loaded, load_time, nav_type, spa_fcp, spa_lcp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)`,
        [
          siteId, sid, str(p.id, 128) ?? pvid, str(p.path, 1024) ?? '/', str(p.ref, 2048),
          str(p.br, 40), str(p.bv, 40), str(p.os, 40), str(p.dv, 20), str(p.cn, 20),
          country, city, region, latitude, longitude,
          num(p.vw), num(p.vh), num(p.dur),
          num(p.ttfb), num(p.fcp), num(p.lcp), num(p.inp), num(p.cls),
          num(p.di), num(p.dcl), num(p.lt),
          p.nt === 'spa' ? 'spa' : 'initial', num(p.sfcp), num(p.slcp),
        ]
      )
    }

    // AJAX (multi-row, capped).
    const a = Array.isArray(body.a) ? (body.a as Record<string, unknown>[]).slice(0, 100) : []
    if (a.length) {
      await bulkInsert(
        'rum_ajax',
        ['site_id', 'session_id', 'page_view_id', 'url', 'method', 'status_code', 'duration_ms', 'success', 'response_size'],
        a.map(x => [siteId, sid, pvid, str(x.u, 2048) ?? '', str(x.mt, 10), num(x.sc), num(x.d), typeof x.ok === 'boolean' ? x.ok : null, num(x.sz)])
      )
    }

    // JS errors (multi-row, capped).
    const e = Array.isArray(body.e) ? (body.e as Record<string, unknown>[]).slice(0, 50) : []
    if (e.length) {
      await bulkInsert(
        'rum_errors',
        ['site_id', 'session_id', 'page_view_id', 'message', 'error_type', 'stack', 'source_url', 'lineno', 'colno', 'page_url'],
        e.map(x => [siteId, sid, pvid, str(x.m, 1000), str(x.t, 100), str(x.st, 4000), str(x.u, 2048), num(x.ln), num(x.cn), str(x.p, 1024)])
      )
    }

    // Resources (multi-row, capped).
    const r = Array.isArray(body.r) ? (body.r as Record<string, unknown>[]).slice(0, 100) : []
    if (r.length) {
      await bulkInsert(
        'rum_resources',
        ['site_id', 'page_view_id', 'url', 'resource_type', 'duration_ms', 'transfer_size', 'start_time_ms'],
        r.map(x => [siteId, pvid, str(x.u, 2048) ?? '', str(x.rt, 40), num(x.d), num(x.ts), num(x.st)])
      )
    }

    return new NextResponse(null, { status: 204, headers: CORS })
  } catch {
    // Never surface ingestion failures to the monitored site.
    return new NextResponse(null, { status: 204, headers: CORS })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
