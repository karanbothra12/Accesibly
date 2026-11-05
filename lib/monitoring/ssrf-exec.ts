import dns from 'node:dns/promises'
import net from 'node:net'
import { isPrivateIp, UnsafeUrlError } from '@/lib/ssrf'

// ── Execution-time SSRF guard for synthetic monitoring ────────────────────────
// lib/ssrf.ts validates a URL at submit time, but an agent that later RESOLVES the
// host again and connects is open to DNS-rebinding (TOCTOU): the name can resolve
// to a public IP at check time and a private one at connect time. Here we resolve
// once, validate every address, and hand back a PINNED IP so the caller connects
// to exactly that address (with the original hostname kept for Host/SNI). We also
// restrict the destination port and re-validate on every redirect hop.

const allowPrivate = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_PRIVATE_TARGETS === '1'

// Ports a monitoring agent may dial. Keeps the fleet from probing arbitrary
// internal services on odd ports even if the host itself is public.
const ALLOWED_PORTS = new Set([80, 443])

export type SafeTarget = {
  url: URL
  hostname: string
  port: number
  ip: string
  family: 4 | 6
  dnsMs: number
}

// Resolve + validate a URL and pin the IP to connect to. Throws UnsafeUrlError.
export async function resolveSafeTarget(raw: string): Promise<SafeTarget> {
  let url: URL
  try { url = new URL(raw) } catch { throw new UnsafeUrlError('Invalid URL') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError('Only http and https URLs are allowed')

  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80)
  const permissive = allowPrivate()
  if (!ALLOWED_PORTS.has(port) && !permissive) throw new UnsafeUrlError(`Port ${port} is not allowed (only 80/443)`)

  // Reject obvious internal names outright (mirrors assertSafeUrl).
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(hostname) && !permissive) {
    throw new UnsafeUrlError('That host is not allowed')
  }

  // Literal IP — no DNS needed.
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname) && !permissive) throw new UnsafeUrlError('That address is not allowed')
    return { url, hostname, port, ip: hostname, family: net.isIPv6(hostname) ? 6 : 4, dnsMs: 0 }
  }

  const t0 = performance.now()
  let addrs: { address: string; family: number }[]
  try { addrs = await dns.lookup(hostname, { all: true }) } catch { throw new UnsafeUrlError('Could not resolve that host') }
  const dnsMs = performance.now() - t0
  if (addrs.length === 0) throw new UnsafeUrlError('Could not resolve that host')

  // Every resolved address must be public — defeats split/rebinding answers.
  for (const a of addrs) {
    if (isPrivateIp(a.address) && !permissive) throw new UnsafeUrlError('That host resolves to a private address')
  }
  const chosen = addrs[0]
  return { url, hostname, port, ip: chosen.address, family: chosen.family === 6 ? 6 : 4, dnsMs }
}
