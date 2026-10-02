import dns from 'node:dns/promises'
import net from 'node:net'

// ── SSRF protection ──────────────────────────────────────────────
// The audit / SEO / competitor features load user-supplied URLs in a headless
// browser (and fetch robots.txt/sitemap.xml). Without this guard a user could
// point them at internal services, loopback, link-local or cloud-metadata
// addresses. We resolve the host and reject any private/reserved target.
//
// In development (or with ALLOW_PRIVATE_TARGETS=1) private hosts are allowed so
// you can audit local dev servers like http://localhost:8104.

const allowPrivate = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_PRIVATE_TARGETS === '1'

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true          // this-network, private, loopback
    if (a === 169 && b === 254) return true                    // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true           // private
    if (a === 192 && b === 168) return true                    // private
    if (a === 100 && b >= 64 && b <= 127) return true          // CGNAT
    if (a >= 224) return true                                   // multicast / reserved
    return false
  }
  const ip6 = ip.toLowerCase()
  if (ip6 === '::1' || ip6 === '::') return true               // loopback / unspecified
  if (ip6.startsWith('::ffff:')) return isPrivateIp(ip6.slice(7)) // IPv4-mapped
  if (ip6.startsWith('fc') || ip6.startsWith('fd')) return true   // unique-local
  if (ip6.startsWith('fe80')) return true                        // link-local
  return false
}

export class UnsafeUrlError extends Error {}

// Throws UnsafeUrlError if the URL is not a safe, public http(s) target.
export async function assertSafeUrl(raw: string): Promise<void> {
  let u: URL
  try { u = new URL(raw) } catch { throw new UnsafeUrlError('Invalid URL') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError('Only http and https URLs are allowed')

  const host = u.hostname.replace(/^\[|\]$/g, '') // strip IPv6 brackets
  const permissive = allowPrivate()

  // Obvious internal hostnames.
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    if (permissive) return
    throw new UnsafeUrlError('That host is not allowed')
  }

  // Literal IP — check directly.
  if (net.isIP(host)) {
    if (isPrivateIp(host) && !permissive) throw new UnsafeUrlError('That address is not allowed')
    return
  }

  // Hostname — resolve and check EVERY address it maps to.
  let addrs: { address: string }[]
  try { addrs = await dns.lookup(host, { all: true }) } catch { throw new UnsafeUrlError('Could not resolve that host') }
  if (addrs.length === 0) throw new UnsafeUrlError('Could not resolve that host')
  for (const a of addrs) {
    if (isPrivateIp(a.address) && !permissive) throw new UnsafeUrlError('That host resolves to a private address')
  }
}
