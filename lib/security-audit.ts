import tls from 'node:tls'
import { assertSafeUrl } from '@/lib/ssrf'

// ── Security & headers audit (IETF: HTTP, TLS) ────────────────────
// A site-level check of transport security and HTTP response headers against
// current IETF/OWASP guidance: TLS certificate health, HTTPS enforcement, and
// the standard security headers (HSTS, CSP, X-Content-Type-Options, framing,
// Referrer-Policy, Permissions-Policy) plus version disclosure and cookie flags.
//
// scoreSecurity is pure (unit-tested); auditSecurity does the network I/O.

export type SecStatus = 'pass' | 'warn' | 'fail'

export interface SecCheck {
  id: string
  label: string
  status: SecStatus
  detail: string
  weight: number   // 0 = informational (excluded from the score)
}

export interface TlsInfo {
  protocol: string | null      // e.g. "TLSv1.3"
  issuer: string | null        // certificate issuer org
  validTo: string | null       // ISO expiry
  daysToExpiry: number | null
}

export interface SecuritySignals {
  reachable: boolean
  finalUrl: string | null
  statusCode: number | null
  isHttps: boolean
  redirectsToHttps: boolean | null  // null = not tested (input already https / http unreachable)
  headers: Record<string, string | null>
  tls: TlsInfo | null
  cookies: { total: number; insecure: number }
}

export interface SecurityResult {
  score: number
  checks: SecCheck[]
  meta: {
    finalUrl: string | null
    statusCode: number | null
    https: boolean
    server: string | null
    poweredBy: string | null
    tls: TlsInfo | null
  }
}

const HEADER_KEYS = [
  'strict-transport-security',
  'content-security-policy',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'server',
  'x-powered-by',
] as const

// Build the scored, human-readable report from raw signals.
export function scoreSecurity(s: SecuritySignals): SecurityResult {
  const h = s.headers
  const checks: SecCheck[] = []
  const add = (id: string, label: string, status: SecStatus, detail: string, weight: number) =>
    checks.push({ id, label, status, detail, weight })

  // HTTPS reachable.
  add('https', 'HTTPS', s.isHttps ? 'pass' : 'fail',
    s.isHttps ? 'Served over HTTPS.' : 'The site was not reachable over HTTPS.', 3)

  // HTTP → HTTPS redirect.
  if (s.redirectsToHttps === null) {
    add('https_redirect', 'HTTP → HTTPS redirect', 'pass', 'No plain-HTTP endpoint to upgrade.', 0)
  } else {
    add('https_redirect', 'HTTP → HTTPS redirect', s.redirectsToHttps ? 'pass' : 'fail',
      s.redirectsToHttps ? 'Plain HTTP redirects to HTTPS.' : 'Plain HTTP is served without redirecting to HTTPS.', 2)
  }

  // HSTS.
  const hsts = h['strict-transport-security']
  if (hsts) {
    const maxAge = Number((hsts.match(/max-age\s*=\s*(\d+)/i) || [])[1] || 0)
    const strong = maxAge >= 15552000 // 180 days
    add('hsts', 'HSTS', strong ? 'pass' : 'warn',
      strong ? `Enforced (max-age ${maxAge}${/includeSubDomains/i.test(hsts) ? ', includeSubDomains' : ''}).`
             : `Present but weak (max-age ${maxAge}; recommend ≥ 15552000).`, 2)
  } else {
    add('hsts', 'HSTS', 'warn', 'Strict-Transport-Security header is missing.', 2)
  }

  // CSP.
  const csp = h['content-security-policy']
  add('csp', 'Content-Security-Policy', csp ? 'pass' : 'warn',
    csp ? 'A Content-Security-Policy is set.' : 'No Content-Security-Policy header (mitigates XSS/injection).', 2)

  // X-Content-Type-Options.
  const xcto = h['x-content-type-options']
  add('x_content_type', 'X-Content-Type-Options', xcto && /nosniff/i.test(xcto) ? 'pass' : 'warn',
    xcto && /nosniff/i.test(xcto) ? 'nosniff is set.' : 'Missing "nosniff" (prevents MIME sniffing).', 1)

  // Clickjacking protection: X-Frame-Options or CSP frame-ancestors.
  const xfo = h['x-frame-options']
  const frameAncestors = csp ? /frame-ancestors/i.test(csp) : false
  add('framing', 'Clickjacking protection', xfo || frameAncestors ? 'pass' : 'warn',
    xfo ? `X-Frame-Options: ${xfo}.` : frameAncestors ? 'CSP frame-ancestors is set.' : 'No X-Frame-Options or CSP frame-ancestors.', 1)

  // Referrer-Policy.
  const ref = h['referrer-policy']
  add('referrer_policy', 'Referrer-Policy', ref ? 'pass' : 'warn',
    ref ? `Referrer-Policy: ${ref}.` : 'No Referrer-Policy header.', 1)

  // Permissions-Policy.
  const pp = h['permissions-policy']
  add('permissions_policy', 'Permissions-Policy', pp ? 'pass' : 'warn',
    pp ? 'A Permissions-Policy is set.' : 'No Permissions-Policy header (limits powerful browser features).', 1)

  // TLS certificate health.
  if (s.isHttps) {
    if (s.tls && s.tls.daysToExpiry != null) {
      const d = s.tls.daysToExpiry
      const status: SecStatus = d < 0 ? 'fail' : d < 14 ? 'warn' : 'pass'
      add('tls_cert', 'TLS certificate', status,
        d < 0 ? 'The certificate has expired.' : `Valid — expires in ${d} day${d === 1 ? '' : 's'}${s.tls.issuer ? ` (issuer: ${s.tls.issuer})` : ''}.`, 2)
      add('tls_protocol', 'TLS protocol', s.tls.protocol && /TLSv1\.[23]/.test(s.tls.protocol) ? 'pass' : 'warn',
        s.tls.protocol ? `Negotiated ${s.tls.protocol}.` : 'Could not determine the negotiated TLS version.', 1)
    } else {
      add('tls_cert', 'TLS certificate', 'warn', 'Could not read the TLS certificate.', 2)
    }
  }

  // Version disclosure.
  const server = h['server']
  const powered = h['x-powered-by']
  const discloses = (v: string | null) => !!v && /\d/.test(v)
  if (discloses(server) || discloses(powered)) {
    add('disclosure', 'Version disclosure', 'warn',
      `Server software/version is exposed${server ? ` (Server: ${server})` : ''}${powered ? ` (X-Powered-By: ${powered})` : ''}.`, 1)
  } else {
    add('disclosure', 'Version disclosure', 'pass', 'No obvious software versions exposed in headers.', 1)
  }

  // Cookie flags.
  if (s.cookies.total > 0) {
    add('cookie_secure', 'Cookie security', s.cookies.insecure === 0 ? 'pass' : 'warn',
      s.cookies.insecure === 0 ? 'All Set-Cookie responses use the Secure flag.'
        : `${s.cookies.insecure} of ${s.cookies.total} cookies are missing the Secure flag.`, 1)
  } else {
    add('cookie_secure', 'Cookie security', 'pass', 'No cookies set on the response.', 0)
  }

  // Weighted score: pass = full weight, warn = half, fail = 0.
  let earned = 0, total = 0
  for (const c of checks) {
    if (c.weight <= 0) continue
    total += c.weight
    earned += c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight * 0.5 : 0
  }
  const score = total > 0 ? Math.round((earned / total) * 100) : 100

  return {
    score,
    checks,
    meta: {
      finalUrl: s.finalUrl,
      statusCode: s.statusCode,
      https: s.isHttps,
      server: h['server'] ?? null,
      poweredBy: h['x-powered-by'] ?? null,
      tls: s.tls,
    },
  }
}

function withScheme(u: string, scheme: 'http' | 'https'): string {
  const bare = u.replace(/^https?:\/\//i, '')
  return `${scheme}://${bare}`
}

// Read the peer certificate + negotiated protocol via a raw TLS handshake.
async function probeTls(hostname: string, port = 443, timeoutMs = 8000): Promise<TlsInfo | null> {
  return new Promise(resolve => {
    let settled = false
    const done = (v: TlsInfo | null) => { if (!settled) { settled = true; try { socket.destroy() } catch {} resolve(v) } }
    const socket = tls.connect({ host: hostname, port, servername: hostname, timeout: timeoutMs }, () => {
      try {
        const cert = socket.getPeerCertificate()
        const protocol = socket.getProtocol()
        const validTo = cert && cert.valid_to ? new Date(cert.valid_to) : null
        const daysToExpiry = validTo ? Math.round((validTo.getTime() - Date.now()) / 86400000) : null
        const rawIssuer = cert && cert.issuer ? (cert.issuer.O ?? cert.issuer.CN ?? null) : null
        const issuer = Array.isArray(rawIssuer) ? (rawIssuer[0] ?? null) : rawIssuer
        done({ protocol, issuer, validTo: validTo ? validTo.toISOString() : null, daysToExpiry })
      } catch { done(null) }
    })
    socket.on('error', () => done(null))
    socket.on('timeout', () => done(null))
  })
}

// Gather signals and score them. Guards against SSRF; never throws.
export async function auditSecurity(rawUrl: string): Promise<SecurityResult> {
  const httpsUrl = withScheme(rawUrl, 'https')
  const httpUrl = withScheme(rawUrl, 'http')
  const host = (() => { try { return new URL(httpsUrl).hostname } catch { return '' } })()

  // SSRF guard (mirrors the crawler); throws on private/unsafe targets.
  await assertSafeUrl(httpsUrl)

  const signals: SecuritySignals = {
    reachable: false, finalUrl: null, statusCode: null, isHttps: false,
    redirectsToHttps: null, headers: {}, tls: null, cookies: { total: 0, insecure: 0 },
  }

  const ua = { 'User-Agent': 'AccesslySecurityBot/1.0' }
  const fetchWith = async (url: string, redirect: RequestRedirect) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    try { return await fetch(url, { headers: ua, redirect, signal: ctrl.signal }) }
    finally { clearTimeout(t) }
  }

  // Does plain HTTP upgrade to HTTPS?
  try {
    const r = await fetchWith(httpUrl, 'manual')
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location') || ''
      signals.redirectsToHttps = /^https:/i.test(loc) || (loc.startsWith('/') /* same host, assume scheme kept — treat as not an upgrade */ && false)
    } else if (r.status >= 200 && r.status < 300) {
      signals.redirectsToHttps = false
    }
  } catch { signals.redirectsToHttps = null }

  // Main request over HTTPS (fall back to HTTP for headers if HTTPS fails).
  let res: Response | null = null
  try { res = await fetchWith(httpsUrl, 'follow'); signals.isHttps = true }
  catch {
    try { res = await fetchWith(httpUrl, 'follow'); signals.isHttps = false } catch { res = null }
  }

  if (res) {
    signals.reachable = true
    signals.finalUrl = res.url || httpsUrl
    signals.statusCode = res.status
    signals.isHttps = /^https:/i.test(signals.finalUrl)
    for (const k of HEADER_KEYS) signals.headers[k] = res.headers.get(k)
    // Cookie flags.
    let cookies: string[] = []
    const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] }
    if (typeof anyHeaders.getSetCookie === 'function') cookies = anyHeaders.getSetCookie()
    else { const sc = res.headers.get('set-cookie'); if (sc) cookies = [sc] }
    signals.cookies.total = cookies.length
    signals.cookies.insecure = cookies.filter(c => !/;\s*secure/i.test(c)).length
  }

  // TLS handshake (only meaningful for HTTPS).
  if (host && signals.isHttps) {
    signals.tls = await probeTls(host)
  }

  return scoreSecurity(signals)
}
