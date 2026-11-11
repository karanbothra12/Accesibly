// ── CDN & edge detection (Phase 6) ────────────────────────────────────────────
// Pure, side-effect-free header inspection: given the response headers (and the
// resolved IP) of a synthetic check, work out which CDN served it, whether the
// response came from cache, and which edge PoP answered. Everything here is
// derived from signals the origin/CDN actually sent — nothing is fabricated.
//
// These are unit-testable in isolation (no I/O). The synthetic engine calls them
// once per check and stores the result on synthetic_results.

export type CacheStatus = 'hit' | 'miss' | 'dynamic' | 'bypass' | 'stale' | 'expired' | null

export type CdnInfo = {
  vendor: string | null      // 'Cloudflare' | 'Fastly' | 'CloudFront' | 'Akamai' | 'Incapsula' | …
  cacheStatus: CacheStatus   // normalized across vendors
  pop: string | null         // edge location token, e.g. 'BOM', 'LHR51-C1'
  popCity: string | null     // best-effort city for the PoP (IATA map)
}

// Node lower-cases header names; values may be string | string[].
type Headers = Record<string, string | string[] | undefined>

function h(headers: Headers, name: string): string | null {
  const v = headers[name.toLowerCase()]
  if (v == null) return null
  return Array.isArray(v) ? v.join(', ') : v
}

function has(headers: Headers, name: string): boolean {
  return headers[name.toLowerCase()] != null
}

// ── CDN vendor ────────────────────────────────────────────────────────────────
// Ordered most-specific first. Each rule is a unique fingerprint header/value.
export function detectCdn(headers: Headers): string | null {
  const server = (h(headers, 'server') || '').toLowerCase()
  const via = (h(headers, 'via') || '').toLowerCase()
  const xcache = (h(headers, 'x-cache') || '').toLowerCase()
  const xcdn = (h(headers, 'x-cdn') || '').toLowerCase()
  const powered = (h(headers, 'x-powered-by') || '').toLowerCase()

  if (has(headers, 'cf-ray') || server === 'cloudflare') return 'Cloudflare'
  if (has(headers, 'x-amz-cf-id') || has(headers, 'x-amz-cf-pop') || via.includes('cloudfront')) return 'CloudFront'
  if (has(headers, 'x-served-by') || has(headers, 'x-timer') || (via.includes('varnish') && has(headers, 'x-cache'))) return 'Fastly'
  if (has(headers, 'x-iinfo') || xcdn.includes('incapsula') || xcdn.includes('imperva')) return 'Incapsula'
  if (has(headers, 'x-akamai-transformed') || has(headers, 'akamai-grn') || server.includes('akamai') || xcache.includes('akamai')) return 'Akamai'
  if (has(headers, 'x-sucuri-id') || server.includes('sucuri')) return 'Sucuri'
  if (has(headers, 'x-vercel-id') || has(headers, 'x-vercel-cache') || server === 'vercel') return 'Vercel'
  if (has(headers, 'x-nf-request-id') || server === 'netlify') return 'Netlify'
  if (has(headers, 'x-azure-ref') || has(headers, 'x-msedge-ref')) return 'Azure Front Door'
  if (server.includes('bunnycdn')) return 'BunnyCDN'
  if (server.includes('keycdn')) return 'KeyCDN'
  if (server.includes('cdn77')) return 'CDN77'
  if (via.includes('google') || powered.includes('google frontend') || server === 'gws' || server === 'sffe') return 'Google'
  if (has(headers, 'x-cache') && !xcdn) return 'Generic CDN' // cached by *something* (proxy/varnish)
  if (xcdn) return xcdn // honor an explicit X-CDN we didn't special-case
  return null
}

// ── Cache status (normalized) ─────────────────────────────────────────────────
// Each CDN spells HIT/MISS differently. We fold them into one vocabulary and also
// fall back to the `Age`/`Cache-Control` heuristic for plain proxies.
export function parseCacheStatus(headers: Headers): CacheStatus {
  const cf = (h(headers, 'cf-cache-status') || '').toLowerCase()      // Cloudflare
  const vercel = (h(headers, 'x-vercel-cache') || '').toLowerCase()   // Vercel
  const xcache = (h(headers, 'x-cache') || '').toLowerCase()          // Fastly / CloudFront / Akamai / proxies
  const raw = cf || vercel || xcache

  if (raw) {
    // Check specific states first, then fall through to hit/miss as substrings
    // (so Akamai's underscored "TCP_HIT"/"TCP_MEM_HIT" and "Hit from cloudfront"
    // all normalize, which a \b word boundary would miss because "_" is a word char).
    if (/dynamic/.test(raw)) return 'dynamic'
    if (/bypass/.test(raw)) return 'bypass'
    if (/stale/.test(raw)) return 'stale'
    if (/expired/.test(raw)) return 'expired'
    if (/hit|revalidated|prerender/.test(raw)) return 'hit'
    if (/miss/.test(raw)) return 'miss'
  }

  // Heuristic fallback for proxies that don't announce a status.
  const cc = (h(headers, 'cache-control') || '').toLowerCase()
  if (/no-store|private/.test(cc)) return 'dynamic'
  const age = Number(h(headers, 'age'))
  if (Number.isFinite(age) && age > 0) return 'hit'
  return null
}

// ── Edge PoP ──────────────────────────────────────────────────────────────────
// Extract the serving edge location token from vendor-specific headers.
export function parsePop(headers: Headers): string | null {
  // CloudFront: X-Amz-Cf-Pop: BOM51-C1
  const cf = h(headers, 'x-amz-cf-pop')
  if (cf) return cf.trim()
  // Cloudflare: CF-Ray: 7d8e1f2a3b4c5d6e-BOM  (suffix = colo IATA)
  const ray = h(headers, 'cf-ray')
  if (ray && ray.includes('-')) return ray.split('-').pop()!.trim()
  // Fastly: X-Served-By: cache-bom4726-BOM   (last segment = PoP)
  const served = h(headers, 'x-served-by')
  if (served) {
    const last = served.split(',').pop()!.trim()      // take the edge-most node
    const seg = last.split('-')
    const tail = seg[seg.length - 1]
    if (tail && /^[a-z]{3}$/i.test(tail)) return tail.toUpperCase()
    return last
  }
  // Akamai: no standard PoP header.
  return null
}

// A small IATA→city map for the PoPs we're most likely to see. Best-effort; an
// unknown code just shows the raw token. (Not exhaustive — expanded as needed.)
const IATA_CITY: Record<string, string> = {
  BOM: 'Mumbai', DEL: 'Delhi', MAA: 'Chennai', HYD: 'Hyderabad', CCU: 'Kolkata',
  SIN: 'Singapore', HKG: 'Hong Kong', NRT: 'Tokyo', KIX: 'Osaka', ICN: 'Seoul',
  SYD: 'Sydney', MEL: 'Melbourne', LHR: 'London', LON: 'London', CDG: 'Paris',
  FRA: 'Frankfurt', AMS: 'Amsterdam', MAD: 'Madrid', MXP: 'Milan', ARN: 'Stockholm',
  DUB: 'Dublin', WAW: 'Warsaw', JFK: 'New York', EWR: 'Newark', IAD: 'Washington',
  ATL: 'Atlanta', ORD: 'Chicago', DFW: 'Dallas', LAX: 'Los Angeles', SFO: 'San Francisco',
  SEA: 'Seattle', MIA: 'Miami', DEN: 'Denver', YYZ: 'Toronto', YUL: 'Montreal',
  GRU: 'São Paulo', GIG: 'Rio de Janeiro', EZE: 'Buenos Aires', SCL: 'Santiago',
  DXB: 'Dubai', JNB: 'Johannesburg', CPT: 'Cape Town', TLV: 'Tel Aviv', BAH: 'Bahrain',
}

export function popCity(pop: string | null): string | null {
  if (!pop) return null
  // Most PoP tokens start with a 3-letter IATA code (BOM, BOM51-C1, cache-bom…).
  const code = pop.replace(/^cache-/i, '').slice(0, 3).toUpperCase()
  return IATA_CITY[code] ?? null
}

// One call to produce the full CdnInfo from a response's headers.
export function analyzeCdn(headers: Headers): CdnInfo {
  const pop = parsePop(headers)
  return {
    vendor: detectCdn(headers),
    cacheStatus: parseCacheStatus(headers),
    pop,
    popCity: popCity(pop),
  }
}
