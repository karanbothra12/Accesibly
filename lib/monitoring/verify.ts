import dns from 'node:dns/promises'
import { resolveSafeTarget } from '@/lib/monitoring/ssrf-exec'

// ── Domain-ownership verification ─────────────────────────────────────────────
// A merchant can register any URL, so before the agent fleet will probe it we
// require proof of control. Two low-friction methods:
//   • dns-txt: a TXT record  _accessly-monitor.<host> = accessly-monitor=<token>
//   • meta:    <meta name="accessly-monitor" content="<token>"> on the homepage
// Verification fetches are SSRF-guarded like every other outbound request.

export function hostOf(rawUrl: string): string | null {
  try { return new URL(rawUrl).hostname.replace(/^www\./, '') } catch { return null }
}

export function dnsRecordName(host: string): string {
  return `_accessly-monitor.${host}`
}

export function dnsRecordValue(token: string): string {
  return `accessly-monitor=${token}`
}

async function verifyDnsTxt(host: string, token: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(dnsRecordName(host))
    const flat = records.map(parts => parts.join('').trim())
    return flat.includes(dnsRecordValue(token)) || flat.includes(token)
  } catch {
    return false
  }
}

// Fetch the homepage (SSRF-safe, bounded) and look for the verification meta tag.
async function verifyMetaTag(rawUrl: string, token: string): Promise<boolean> {
  let target
  try { target = await resolveSafeTarget(rawUrl) } catch { return false }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    // Connect by hostname (public, already validated) — fetch can't pin an IP, but
    // the host was just validated and this is a read-only GET of a public page.
    const res = await fetch(target.url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': process.env.AUDIT_USER_AGENT || 'AccesslyMonitorBot/1.0' },
    })
    if (!res.ok) return false
    const reader = res.body?.getReader()
    if (!reader) return false
    let html = ''
    const decoder = new TextDecoder()
    while (html.length < 512 * 1024) {
      const { done, value } = await reader.read()
      if (done) break
      html += decoder.decode(value, { stream: true })
    }
    const re = new RegExp(`<meta[^>]+name=["']accessly-monitor["'][^>]+content=["']${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i')
    return re.test(html)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function verifyOwnership(rawUrl: string, token: string, method: 'dns-txt' | 'meta'): Promise<boolean> {
  const host = hostOf(rawUrl)
  if (!host) return false
  return method === 'dns-txt' ? verifyDnsTxt(host, token) : verifyMetaTag(rawUrl, token)
}
