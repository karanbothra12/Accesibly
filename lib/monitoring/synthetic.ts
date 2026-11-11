import http from 'node:http'
import https from 'node:https'
import net, { type Socket } from 'node:net'
import type { TLSSocket } from 'node:tls'
import { resolveSafeTarget, type SafeTarget } from '@/lib/monitoring/ssrf-exec'
import { UnsafeUrlError } from '@/lib/ssrf'
import { analyzeCdn, type CacheStatus } from '@/lib/monitoring/cdn'

// ── Synthetic HTTP check with per-phase timing ────────────────────────────────
// Pure Node (no browser) active measurement: DNS → TCP → TLS → TTFB → download.
// Connects to a PINNED IP (SSRF-safe) while keeping the real hostname for the Host
// header and TLS SNI, follows redirects (re-validating each hop), and records SSL
// expiry. This is what the audit crawler does NOT do (it captures only a status).

export type SyntheticErrorType = 'dns' | 'tcp' | 'tls' | 'ssl' | 'http' | 'timeout' | 'ssrf' | null

export type SyntheticResult = {
  available: boolean
  statusCode: number | null
  errorType: SyntheticErrorType
  errorDetail: string | null
  dnsMs: number | null
  tcpMs: number | null
  tlsMs: number | null
  ttfbMs: number | null
  downloadMs: number | null
  totalMs: number | null
  redirectMs: number | null
  responseSize: number | null
  resolvedIp: string | null
  sslExpiry: string | null // ISO timestamp of certificate notAfter
  // Phase 6 — CDN & edge (derived from the final response's headers)
  cdnVendor: string | null
  cacheStatus: CacheStatus
  edgePop: string | null
  responseHeaders: Record<string, string> | null
}

export type CheckOptions = {
  timeoutMs?: number
  maxRedirects?: number
  expectedStatus?: number
  userAgent?: string
}

const MAX_BODY = 5 * 1024 * 1024 // 5 MB download cap
const DEFAULT_UA = process.env.AUDIT_USER_AGENT || 'AccesslyMonitorBot/1.0 (+https://accessly.io/bot)'

type HopResult = {
  statusCode: number
  tcpMs: number
  tlsMs: number | null
  ttfbMs: number
  downloadMs: number
  hopTotalMs: number
  responseSize: number
  redirectLocation: string | null
  sslExpiry: string | null
  headers: Record<string, string>
}

// One request to an already-resolved+validated target, connecting to the pinned IP.
function requestOnce(target: SafeTarget, timeoutMs: number, userAgent: string): Promise<HopResult> {
  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === 'https:'
    const lib = isHttps ? https : http
    const path = target.url.pathname + target.url.search
    const hostHeader = (target.port === 80 || target.port === 443) ? target.hostname : `${target.hostname}:${target.port}`

    const tStart = performance.now()
    let tcpAt = 0, tlsAt = 0, ttfbAt = 0
    let sslExpiry: string | null = null
    let size = 0
    let settled = false

    const req = lib.request({
      host: target.ip,
      port: target.port,
      servername: isHttps && !net.isIP(target.hostname) ? target.hostname : undefined, // TLS SNI (skip for literal IPs per RFC 6066)
      path,
      method: 'GET',
      family: target.family,
      timeout: timeoutMs,
      headers: {
        Host: hostHeader,
        'User-Agent': userAgent,
        'Accept-Encoding': 'identity',
        Connection: 'close',
      },
    })

    const fail = (type: SyntheticErrorType, msg: string) => {
      if (settled) return
      settled = true
      req.destroy()
      const err = new Error(msg) as Error & { errorType: SyntheticErrorType }
      err.errorType = type
      reject(err)
    }

    req.on('socket', (socket: Socket) => {
      socket.on('connect', () => { tcpAt = performance.now() })
      socket.on('secureConnect', () => {
        tlsAt = performance.now()
        const cert = (socket as TLSSocket).getPeerCertificate?.()
        if (cert && cert.valid_to) {
          const exp = new Date(cert.valid_to)
          if (!isNaN(exp.getTime())) sslExpiry = exp.toISOString()
        }
      })
    })

    req.on('timeout', () => fail('timeout', `Timed out after ${timeoutMs}ms`))
    req.on('error', (e: NodeJS.ErrnoException) => {
      // Classify by phase reached + error code.
      if (/CERT|SSL|certificate|altnames|self.signed/i.test(e.message) || e.code?.startsWith('ERR_TLS')) return fail('ssl', e.message)
      if (tcpAt === 0) return fail('tcp', e.message) // never connected
      fail('http', e.message)
    })

    req.on('response', res => {
      ttfbAt = performance.now()
      const status = res.statusCode || 0
      const location = res.headers.location || null
      // Flatten headers for CDN/cache analysis (array values joined).
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) {
        if (v != null) headers[k] = Array.isArray(v) ? v.join(', ') : String(v)
      }
      res.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY) { res.destroy() }
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        const endAt = performance.now()
        resolve({
          statusCode: status,
          tcpMs: Math.max(0, tcpAt - tStart),
          tlsMs: isHttps && tlsAt ? Math.max(0, tlsAt - tcpAt) : null,
          ttfbMs: Math.max(0, ttfbAt - (tlsAt || tcpAt || tStart)),
          downloadMs: Math.max(0, endAt - ttfbAt),
          hopTotalMs: Math.max(0, endAt - tStart),
          responseSize: size,
          redirectLocation: status >= 300 && status < 400 ? (typeof location === 'string' ? location : null) : null,
          sslExpiry,
          headers,
        })
      })
      res.on('close', () => {
        // If the body was capped we may not get 'end'; resolve with what we have.
        if (settled) return
        settled = true
        const endAt = performance.now()
        resolve({
          statusCode: status, tcpMs: Math.max(0, tcpAt - tStart),
          tlsMs: isHttps && tlsAt ? Math.max(0, tlsAt - tcpAt) : null,
          ttfbMs: Math.max(0, ttfbAt - (tlsAt || tcpAt || tStart)),
          downloadMs: Math.max(0, endAt - ttfbAt), hopTotalMs: Math.max(0, endAt - tStart),
          responseSize: size, redirectLocation: null, sslExpiry, headers,
        })
      })
    })

    req.end()
  })
}

// Full check: resolve + validate (SSRF), follow redirects, aggregate timings.
export async function runHttpCheck(rawUrl: string, opts: CheckOptions = {}): Promise<SyntheticResult> {
  const timeoutMs = opts.timeoutMs ?? 30000
  const maxRedirects = opts.maxRedirects ?? 5
  const userAgent = opts.userAgent ?? DEFAULT_UA
  const wallStart = performance.now()

  const empty: SyntheticResult = {
    available: false, statusCode: null, errorType: null, errorDetail: null,
    dnsMs: null, tcpMs: null, tlsMs: null, ttfbMs: null, downloadMs: null,
    totalMs: null, redirectMs: null, responseSize: null, resolvedIp: null, sslExpiry: null,
    cdnVendor: null, cacheStatus: null, edgePop: null, responseHeaders: null,
  }

  let current = rawUrl
  let redirectMs = 0

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let target: SafeTarget
    try {
      target = await resolveSafeTarget(current)
    } catch (e) {
      const isSsrf = e instanceof UnsafeUrlError
      return { ...empty, totalMs: performance.now() - wallStart, redirectMs,
        errorType: isSsrf ? 'ssrf' : 'dns', errorDetail: e instanceof Error ? e.message : String(e) }
    }

    let hopRes: HopResult
    try {
      hopRes = await requestOnce(target, timeoutMs, userAgent)
    } catch (e) {
      const errorType = (e as { errorType?: SyntheticErrorType }).errorType ?? 'http'
      return { ...empty, resolvedIp: target.ip, dnsMs: target.dnsMs,
        totalMs: performance.now() - wallStart, redirectMs,
        errorType, errorDetail: e instanceof Error ? e.message : String(e) }
    }

    if (hopRes.redirectLocation && hop < maxRedirects) {
      redirectMs += hopRes.hopTotalMs + target.dnsMs
      try { current = new URL(hopRes.redirectLocation, target.url).toString() } catch { break }
      continue
    }

    // Final hop — build the result from this response.
    const expected = opts.expectedStatus
    const statusOk = expected ? hopRes.statusCode === expected : hopRes.statusCode < 400
    const cdn = analyzeCdn(hopRes.headers)
    return {
      available: statusOk,
      statusCode: hopRes.statusCode,
      errorType: statusOk ? null : 'http',
      errorDetail: statusOk ? null : `Expected ${expected ?? '<400'}, got ${hopRes.statusCode}`,
      dnsMs: target.dnsMs,
      tcpMs: hopRes.tcpMs,
      tlsMs: hopRes.tlsMs,
      ttfbMs: hopRes.ttfbMs,
      downloadMs: hopRes.downloadMs,
      totalMs: performance.now() - wallStart,
      redirectMs: redirectMs || null,
      responseSize: hopRes.responseSize,
      resolvedIp: target.ip,
      sslExpiry: hopRes.sslExpiry,
      cdnVendor: cdn.vendor,
      cacheStatus: cdn.cacheStatus,
      edgePop: cdn.pop ? (cdn.popCity ? `${cdn.pop} (${cdn.popCity})` : cdn.pop) : null,
      responseHeaders: hopRes.headers,
    }
  }

  return { ...empty, totalMs: performance.now() - wallStart, redirectMs,
    errorType: 'http', errorDetail: `Too many redirects (>${maxRedirects})` }
}
