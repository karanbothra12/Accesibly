import { assertSafeUrl } from '@/lib/ssrf'

// ── Broken-link checker ───────────────────────────────────────────
// For each crawled page we collect its outbound links and check each unique URL
// once (cached across the whole crawl). Same-origin failures are real ERRORS;
// external failures are WARNINGS — many external sites (x.com, trustpilot, …)
// return 403/429 to crawler bots, so treating those as hard errors would be
// noisy and misleading. Classification is pure and unit-tested; the network
// probe (checkLink) is best-effort and never throws.

export type LinkKind = 'internal' | 'external'
export type LinkSeverity = 'error' | 'warning' | 'ok'

export interface BrokenLink {
  url: string
  status: number | null   // null = network error / no response
  kind: LinkKind
  reason: string
}

export interface LinkCheckResult {
  total: number            // distinct http(s) links found on the page
  checked: number          // how many were actually probed (excludes skipped/unsafe)
  brokenInternal: number
  brokenExternal: number
  links: BrokenLink[]      // broken ones only (internal first), capped
}

// Cached per-URL probe outcome, shared across the crawl.
export interface LinkStatus { status: number | null; networkError: boolean }

const MAX_BROKEN_PER_PAGE = 100
// Cap distinct links probed per crawl so a huge site can't run unbounded.
export const MAX_LINKS_PER_CRAWL = 2000

// Pure severity classification — the heart of the "own-page vs external" rule.
export function classifyLink(
  status: number | null,
  sameOrigin: boolean,
  networkError: boolean
): { broken: boolean; severity: LinkSeverity; reason: string } {
  const kind = sameOrigin ? 'internal' : 'external'
  if (networkError) {
    return { broken: true, severity: sameOrigin ? 'error' : 'warning', reason: `${kind === 'internal' ? 'Internal' : 'External'} link could not be reached (no response).` }
  }
  if (status != null && status >= 400) {
    // 403/429 from external hosts are usually bot-blocking, not real breakage.
    const botBlock = !sameOrigin && (status === 403 || status === 429 || status === 999)
    return {
      broken: true,
      severity: sameOrigin ? 'error' : 'warning',
      reason: botBlock ? `External link returned HTTP ${status} (often bot-blocking, may be a false positive).` : `${kind === 'internal' ? 'Internal' : 'External'} link returned HTTP ${status}.`,
    }
  }
  return { broken: false, severity: 'ok', reason: '' }
}

// Probe one URL: HEAD first (cheap), falling back to GET when HEAD is rejected.
// Guards against SSRF; returns networkError=true on any transport failure.
export async function checkLink(url: string, timeoutMs = 10_000): Promise<LinkStatus> {
  try { await assertSafeUrl(url) } catch { return { status: null, networkError: true } }

  const attempt = async (method: 'HEAD' | 'GET'): Promise<LinkStatus> => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'AccesslyLinkBot/1.0' } })
      return { status: res.status, networkError: false }
    } catch {
      return { status: null, networkError: true }
    } finally {
      clearTimeout(t)
    }
  }

  const head = await attempt('HEAD')
  // Many servers disallow HEAD (405) or mishandle it — retry with GET.
  if (head.networkError || head.status === 405 || head.status === 501) {
    const get = await attempt('GET')
    // Prefer a real HTTP response over a network error.
    if (!get.networkError) return get
    return head.networkError ? get : head
  }
  return head
}

// Run probes with bounded concurrency.
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx])
    }
  })
  await Promise.all(workers)
}

// Check all links on one page, using (and filling) a crawl-wide status cache.
export async function checkPageLinks(
  links: string[],
  siteOrigin: string,
  cache: Map<string, LinkStatus>,
  opts: { concurrency?: number } = {}
): Promise<LinkCheckResult> {
  // Keep only http(s) links and de-dupe within the page.
  const seen = new Set<string>()
  const unique: string[] = []
  for (const raw of links) {
    if (!/^https?:\/\//i.test(raw)) continue
    let norm: string
    try { const u = new URL(raw); u.hash = ''; norm = u.toString() } catch { continue }
    if (!seen.has(norm)) { seen.add(norm); unique.push(norm) }
  }

  const sameOrigin = (u: string) => { try { return new URL(u).origin === siteOrigin } catch { return false } }

  // Probe the ones we haven't seen yet in this crawl (respecting the global cap).
  const toProbe = unique.filter(u => !cache.has(u) && cache.size < MAX_LINKS_PER_CRAWL)
  await pool(toProbe, opts.concurrency ?? 6, async u => {
    cache.set(u, await checkLink(u))
  })

  let brokenInternal = 0, brokenExternal = 0, checked = 0
  const broken: BrokenLink[] = []
  for (const u of unique) {
    const st = cache.get(u)
    if (!st) continue // skipped due to global cap
    checked++
    const so = sameOrigin(u)
    const c = classifyLink(st.status, so, st.networkError)
    if (c.broken) {
      if (so) brokenInternal++; else brokenExternal++
      broken.push({ url: u, status: st.status, kind: so ? 'internal' : 'external', reason: c.reason })
    }
  }
  // Internal (real errors) first, then external warnings; cap the stored list.
  broken.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'internal' ? -1 : 1))

  return { total: unique.length, checked, brokenInternal, brokenExternal, links: broken.slice(0, MAX_BROKEN_PER_PAGE) }
}
