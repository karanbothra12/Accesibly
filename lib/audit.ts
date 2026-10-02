import type { Page } from 'playwright-core'
import AxeBuilder from '@axe-core/playwright'
import { launchBrowser } from '@/lib/browser'
import { scoreSeo, checkSiteSeo, type SeoSignals, type SeoResult, type SeoSiteResult } from '@/lib/seo'
import { validateHtml, type HtmlResult } from '@/lib/html-validate'
import { validateCss, type CssResult } from '@/lib/css-validate'
import { checkPageLinks, type LinkCheckResult, type LinkStatus } from '@/lib/linkcheck'
import { detectForeignLanguage } from '@/lib/langdetect'
import { hasNewWindowWarning, findDuplicateIds } from '@/lib/failure-techniques'
import { assertSafeUrl } from '@/lib/ssrf'

// ── Accessibility audit engine ────────────────────────────────
// Launches a headless Chromium, crawls same-origin pages (BFS),
// and runs axe-core against each rendered page. Results are handed
// back one page at a time via `onPage` so the caller can persist
// progress live (the dashboard polls while a job runs).

// Identifiable crawler user-agent so site owners can allowlist Accessly in their
// WAF/CDN (the default headless-Chromium UA contains "HeadlessChrome" and is
// blocked by most bot protection). Override via AUDIT_USER_AGENT if needed.
export const AUDIT_USER_AGENT =
  process.env.AUDIT_USER_AGENT || 'AccesslyAuditBot/1.0 (+https://accessly.io/bot)'

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor'

export interface PageAuditResult {
  url: string
  statusCode: number | null
  violations: number // number of failing axe rules on the page
  critical: number
  serious: number
  moderate: number
  minor: number
  results: unknown[] // raw axe violations array (persisted as JSONB)
  seo: SeoResult | null // technical-SEO report (null when SEO not enabled)
  html: HtmlResult | null // W3C HTML validation report (null when not enabled)
  css: CssResult | null // W3C CSS validation report (null when not enabled)
  links: LinkCheckResult | null // broken-link report (null when not enabled)
  error: string | null
}

export type Ruleset = 'default' | 'wcag-strict' | 'wcag-aaa' | 'all'

// Maps a ruleset preset to axe-core tag filters. `null` means no filter — axe's
// own default (WCAG 2.0/2.1/2.2 A & AA plus best-practice, no AAA/experimental).
const RULESET_TAGS: Record<Ruleset, string[] | null> = {
  default: null,
  'wcag-strict': ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  'wcag-aaa': ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
  all: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice', 'experimental'],
}

export interface CrawlOptions {
  startUrl: string
  mode: 'single' | 'full'
  maxPages: number
  ruleset?: Ruleset
  seo?: boolean    // collect a technical-SEO report per page
  a11y?: boolean   // run the axe accessibility pass (default true)
  html?: boolean   // validate each page's markup against the W3C checker
  css?: boolean    // validate each page's CSS against the W3C CSS validator
  linkcheck?: boolean // check outbound links on each page for 4xx/5xx
  onPage: (result: PageAuditResult) => Promise<void>
  // Cooperative cancellation: checked before each page. Returning true stops
  // the crawl before the next page is fetched (the in-flight page still finishes).
  shouldCancel?: () => Promise<boolean>
}

function normalize(url: string): string {
  try {
    const u = new URL(url)
    u.hash = '' // treat #anchors as the same page
    return u.toString()
  } catch {
    return url
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

// Extract raw technical-SEO signals from the already-rendered page.
async function extractSeoSignals(page: Page, statusCode: number | null): Promise<SeoSignals> {
  const raw = await page.evaluate(() => {
    // No named inner functions here — see the note on detectForeignLangParts:
    // under the tsx worker they get an esbuild `__name` wrapper that breaks in
    // the page context. Use document.querySelector inline instead.
    const robotsMeta = document.querySelector('meta[name="robots" i]')?.getAttribute('content') ?? null
    const imgs = Array.from(document.querySelectorAll('img'))
    // For SEO, an explicit alt attribute (even empty/decorative) is acceptable.
    const imgWithAlt = imgs.filter(i => i.getAttribute('alt') !== null).length
    // Layout-shift (CLS) risk: images without BOTH width and height attributes.
    const imgMissingDims = imgs.filter(i => !(i.getAttribute('width') && i.getAttribute('height'))).length
    // Link-quality signals.
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
    const GENERIC = new Set(['click here', 'click', 'here', 'read more', 'learn more', 'more', 'details', 'this', 'link', 'read', 'go'])
    const genericLinkCount = anchors.filter(a => {
      const t = (a.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
      return t.length > 0 && GENERIC.has(t)
    }).length
    const internalNofollowCount = anchors.filter(a => {
      const rel = (a.getAttribute('rel') || '').toLowerCase()
      if (!/\bnofollow\b/.test(rel)) return false
      try { return new URL(a.href, location.href).origin === location.origin } catch { return false }
    }).length
    const urlHasUnderscore = location.pathname.includes('_')
    const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .map(h => Number(h.tagName[1]))
    let headingOrderOk = true, prev = 0
    for (const lvl of heads) { if (prev && lvl > prev + 1) { headingOrderOk = false; break } prev = lvl }
    const bodyText = document.body ? (document.body.innerText || '') : ''
    const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length
    return {
      title: document.title || null,
      metaDescription: document.querySelector('meta[name="description" i]')?.getAttribute('content') ?? null,
      h1Count: document.querySelectorAll('h1').length,
      canonical: document.querySelector('link[rel="canonical" i]')?.getAttribute('href') ?? null,
      robotsMeta,
      noindex: !!(robotsMeta && /noindex/i.test(robotsMeta)),
      htmlLang: document.documentElement.getAttribute('lang') || null,
      hasViewport: !!document.querySelector('meta[name="viewport" i]'),
      ogTitle: !!document.querySelector('meta[property="og:title" i]'),
      ogDescription: !!document.querySelector('meta[property="og:description" i]'),
      ogImage: !!document.querySelector('meta[property="og:image" i]'),
      twitterCard: !!document.querySelector('meta[name="twitter:card" i]'),
      jsonLdCount: document.querySelectorAll('script[type="application/ld+json"]').length,
      hreflangCount: document.querySelectorAll('link[rel="alternate"][hreflang]').length,
      imgTotal: imgs.length,
      imgWithAlt,
      imgMissingDims,
      genericLinkCount,
      internalNofollowCount,
      urlHasUnderscore,
      wordCount,
      headingOrderOk,
    }
  })
  return { statusCode, ...raw }
}

// WCAG 3.1.2 heuristic — find text runs in a non-Latin script on a Latin-script
// page that have no lang attribute (the clearest, lowest-false-positive slice of
// "Language of Parts"; same-script languages need manual review). Runs entirely
// in the page context; returns the offending elements.
export async function detectForeignLangParts(page: Page): Promise<Array<{ html: string; target: string; script: string; text: string }>> {
  // Collect untagged text runs in the page (name-free evaluate body — under the
  // tsx worker, esbuild's keepNames injects a `__name` helper that doesn't exist
  // in the page context and throws). Language classification happens in Node.
  const { pageLang, candidates } = await page.evaluate(() => {
    const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase()
    const code = lang.split('-')[0]
    const PAGE_SCRIPT: Record<string, string> = {
      zh: 'Han', ja: 'Han', ko: 'Hangul', ar: 'Arabic', fa: 'Arabic', ur: 'Arabic',
      he: 'Hebrew', iw: 'Hebrew', ru: 'Cyrillic', uk: 'Cyrillic', be: 'Cyrillic',
      bg: 'Cyrillic', sr: 'Cyrillic', mk: 'Cyrillic', hi: 'Devanagari', mr: 'Devanagari',
      ne: 'Devanagari', el: 'Greek', th: 'Thai',
    }
    const pageScript = PAGE_SCRIPT[code] || 'Latin'
    const SCRIPTS = ['Han', 'Hiragana', 'Katakana', 'Hangul', 'Arabic', 'Hebrew', 'Cyrillic', 'Devanagari', 'Greek', 'Thai']

    const cands: Array<{ html: string; target: string; script: string; text: string }> = []
    const seen = new Set<Element>()
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const parent = (node as Text).parentElement
      if (!parent) continue
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') continue
      const text = (node.nodeValue || '').trim()
      if (text.length < 3) continue
      const letters = (text.match(/\p{L}/gu) || []).length
      if (letters < 2) continue

      let best = '', bestCount = 0
      for (const s of SCRIPTS) {
        const cnt = (text.match(new RegExp('\\p{Script=' + s + '}', 'gu')) || []).length
        if (cnt > bestCount) { bestCount = cnt; best = s }
      }
      const latinCount = (text.match(/\p{Script=Latin}/gu) || []).length
      const wordCount = (text.match(/[\p{L}][\p{L}À-ɏ'’-]*/gu) || []).length

      // Decide whether this run is worth checking:
      //  - a dominant non-Latin script different from the page's script, OR
      //  - (Latin-script page) a Latin PHRASE (≥6 words) → language-detect in Node.
      //    Short labels/brands ("Emerald Necklaces") are skipped — franc can't
      //    judge them and would emit false positives.
      let scriptLabel = ''
      if (bestCount >= 2 && bestCount / letters >= 0.6 && best !== pageScript) scriptLabel = best
      else if (pageScript === 'Latin' && latinCount / letters >= 0.6 && wordCount >= 6 && /[À-ɏḀ-ỿ]/.test(text)) scriptLabel = 'Latin'
      else continue

      // Tagged only if the element (or an intermediate ancestor) carries its own
      // lang — the <html> lang is the page baseline and does NOT count.
      let tagged = false
      for (let n: Element | null = parent; n && n !== document.documentElement; n = n.parentElement) {
        if (n.hasAttribute && n.hasAttribute('lang')) { tagged = true; break }
      }
      if (tagged || seen.has(parent)) continue
      seen.add(parent)

      let target: string
      if (parent.id) target = '#' + parent.id
      else {
        const cls = (parent.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        target = parent.tagName.toLowerCase() + (cls ? '.' + cls : '')
      }
      cands.push({ html: (parent.outerHTML || '').slice(0, 200), target, script: scriptLabel, text: text.slice(0, 120) })
      if (cands.length >= 80) break
    }
    return { pageLang: lang, candidates: cands }
  })

  const out: Array<{ html: string; target: string; script: string; text: string }> = []
  for (const c of candidates) {
    if (c.script !== 'Latin') {
      out.push({ ...c, text: c.text.slice(0, 60) })
    } else {
      const language = detectForeignLanguage(c.text, pageLang)
      if (language) out.push({ ...c, script: language, text: c.text.slice(0, 60) })
    }
    if (out.length >= 25) break
  }
  return out
}

// Supplementary W3C failure-technique checks that axe-core does not implement:
//   F22 — links with target="_blank" that give no "opens in a new window" warning
//   F77 — plain duplicate id attributes (axe only catches ARIA-referenced ones)
// Name-free page.evaluate body (the tsx worker's esbuild keepNames injects a
// `__name` helper that is absent in the page context and throws). The DOM pass
// gathers raw strings/ids; the pass/fail decision happens in Node via the pure,
// unit-tested helpers in lib/failure-techniques.
export async function detectFailureTechniques(page: Page): Promise<{
  blankLinks: Array<{ html: string; target: string }>
  dupIds: Array<{ html: string; target: string; id: string; count: number }>
}> {
  const raw = await page.evaluate(() => {
    // F22 candidates: every link opening a new window, with its accessible text.
    const blank: Array<{ html: string; target: string; accessibleText: string }> = []
    const anchors = document.querySelectorAll('a[target="_blank"], a[target="blank"]')
    for (const a of Array.from(anchors)) {
      if (a.getAttribute('aria-hidden') === 'true') continue
      let extra = ''
      const db = a.getAttribute('aria-describedby')
      if (db) for (const id of db.split(/\s+/)) {
        if (!id) continue
        const el = document.getElementById(id)
        if (el) extra += ' ' + (el.textContent || '')
      }
      const accessibleText = (a.textContent || '') + ' ' + (a.getAttribute('aria-label') || '') +
        ' ' + (a.getAttribute('title') || '') + ' ' + extra
      let target: string
      if (a.id) target = '#' + a.id
      else {
        const cls = (a.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        target = 'a' + (cls ? '.' + cls : '') + (a.getAttribute('href') ? '[href="' + a.getAttribute('href') + '"]' : '')
      }
      blank.push({ html: (a.outerHTML || '').slice(0, 200), target, accessibleText })
      if (blank.length >= 60) break
    }

    // F77 candidates: every id in the document (grouped/decided in Node).
    const ids: Array<{ id: string; html: string; target: string }> = []
    const withId = document.querySelectorAll('[id]')
    for (const el of Array.from(withId)) {
      const id = el.id
      if (!id) continue
      ids.push({ id, html: (el.outerHTML || '').slice(0, 160), target: el.tagName.toLowerCase() + '#' + id })
      if (ids.length >= 4000) break
    }

    return { blank, ids }
  })

  const blankLinks: Array<{ html: string; target: string }> = []
  for (const c of raw.blank) {
    if (!hasNewWindowWarning(c.accessibleText)) blankLinks.push({ html: c.html, target: c.target })
    if (blankLinks.length >= 25) break
  }

  const dupInfo = findDuplicateIds(raw.ids.map(i => i.id))
  const dupIds: Array<{ html: string; target: string; id: string; count: number }> = []
  for (const d of dupInfo) {
    const first = raw.ids.find(i => i.id === d.id)
    dupIds.push({ id: d.id, count: d.count, html: first ? first.html : '', target: first ? first.target : '#' + d.id })
    if (dupIds.length >= 25) break
  }

  return { blankLinks, dupIds }
}

async function auditPage(page: Page, url: string, tags: string[] | null, collectSeo: boolean, collectA11y: boolean, collectHtml: boolean, collectCss: boolean, collectLinks: boolean, siteOrigin: string, linkCache: Map<string, LinkStatus>): Promise<PageAuditResult> {
  const result: PageAuditResult = {
    url,
    statusCode: null,
    violations: 0,
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    results: [],
    seo: null,
    html: null,
    css: null,
    links: null,
    error: null,
  }

  try {
    let resp
    try {
      resp = await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
    } catch (navErr) {
      // Many local/dev servers are HTTP-only: retry https→http on SSL/connection errors.
      const msg = navErr instanceof Error ? navErr.message : String(navErr)
      if (url.startsWith('https://') && /ERR_SSL|SSL_PROTOCOL|ERR_CONNECTION|ECONNREFUSED|ERR_EMPTY_RESPONSE/i.test(msg)) {
        const httpUrl = 'http://' + url.slice('https://'.length)
        resp = await page.goto(httpUrl, { waitUntil: 'load', timeout: 30_000 })
        result.url = httpUrl
      } else {
        throw navErr
      }
    }
    result.statusCode = resp ? resp.status() : null

    if (collectA11y) {
      const builder = new AxeBuilder({ page })
      if (tags) builder.withTags(tags)
      const axe = await builder.analyze()
      const violations: unknown[] = [...axe.violations]

      // Supplementary WCAG 3.1.2 (Language of Parts): axe can't detect untagged
      // foreign-language text. High-confidence heuristic — a run in a different
      // Unicode script than a Latin-script page, with no lang attribute.
      try {
        const langParts = await detectForeignLangParts(page)
        if (langParts.length > 0) {
          violations.push({
            id: 'language-of-parts',
            impact: 'serious',
            description: 'Text in a language different from the page must be marked with a lang attribute so assistive technology pronounces it correctly (WCAG 3.1.2 Language of Parts).',
            help: 'Mark foreign-language text with a lang attribute',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-parts.html',
            tags: ['cat.language', 'wcag2aa', 'wcag312'],
            nodes: langParts.map(p => ({
              html: p.html,
              target: [p.target],
              failureSummary: `${p.script} text without a lang attribute: “${p.text}”`,
            })),
          })
        }
      } catch {
        // Heuristic is best-effort; never fail the axe pass over it.
      }

      // Supplementary W3C failure techniques axe-core does not implement (F22, F77).
      try {
        const ft = await detectFailureTechniques(page)
        if (ft.blankLinks.length > 0) {
          violations.push({
            id: 'link-target-blank-no-warning',
            impact: 'moderate',
            description: 'Links that open a new window or tab should warn the user, so screen-reader and mobile users are not disoriented (WCAG 3.2.5 Change on Request, technique F22).',
            help: 'Warn users when a link opens a new window',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/failures/F22',
            tags: ['cat.sensory-and-visual-cues', 'wcag2aaa', 'wcag325'],
            nodes: ft.blankLinks.map(l => ({
              html: l.html,
              target: [l.target],
              failureSummary: 'Link opens a new window (target="_blank") with no "opens in a new window" warning in its text, title, or aria-describedby.',
            })),
          })
        }
        if (ft.dupIds.length > 0) {
          violations.push({
            id: 'duplicate-id-plain',
            impact: 'minor',
            description: 'id attribute values must be unique within the page; duplicates break in-page anchors, label associations, and scripting (technique F77).',
            help: 'id attribute values must be unique',
            helpUrl: 'https://www.w3.org/WAI/WCAG21/Techniques/failures/F77',
            tags: ['cat.parsing', 'wcag412'],
            nodes: ft.dupIds.map(d => ({
              html: d.html,
              target: [d.target],
              failureSummary: `The id "${d.id}" is used ${d.count} times on this page; ids must be unique.`,
            })),
          })
        }
      } catch {
        // Best-effort; never fail the axe pass over it.
      }

      result.results = violations
      result.violations = violations.length

      for (const v of violations) {
        const impact = ((v as { impact?: string }).impact ?? 'minor') as Impact
        if (impact === 'critical') result.critical++
        else if (impact === 'serious') result.serious++
        else if (impact === 'moderate') result.moderate++
        else result.minor++
      }
    }

    if (collectSeo) {
      try {
        const signals = await extractSeoSignals(page, result.statusCode)
        result.seo = scoreSeo(signals)
      } catch {
        // SEO extraction is best-effort; never fail the a11y audit over it.
        result.seo = null
      }
    }

    if (collectHtml) {
      // Prefer the raw served markup (what the W3C checker validates), falling
      // back to the serialized DOM if the response body isn't available.
      let markup = ''
      try { markup = resp ? await resp.text() : '' } catch { markup = '' }
      if (!markup || !/</.test(markup)) {
        try { markup = await page.content() } catch { markup = markup || '' }
      }
      result.html = await validateHtml(markup)
      // Headline "issues" for an HTML audit are spec errors (warnings shown
      // separately). Reusing `violations` lets the live counter + per-page
      // issue_count work without special-casing the runner.
      if (!collectA11y) result.violations = result.html.errors
    }

    if (collectCss) {
      // Validate all CSS the page references (validator fetches linked sheets).
      result.css = await validateCss(result.url)
      if (!collectA11y) result.violations = result.css.errors
    }

    if (collectLinks) {
      let hrefs: string[] = []
      try { hrefs = await page.$$eval('a[href]', els => els.map(el => (el as HTMLAnchorElement).href)) } catch { hrefs = [] }
      result.links = await checkPageLinks(hrefs, siteOrigin, linkCache)
      // Headline "issues" for a link audit are broken SAME-ORIGIN links.
      if (!collectA11y) result.violations = result.links.brokenInternal
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
  }

  return result
}

export async function runCrawl(
  opts: CrawlOptions
): Promise<{ pagesCrawled: number; totalIssues: number; cancelled: boolean; seoScore: number | null; seoIssues: number; seoSite: SeoSiteResult | null; htmlErrors: number; htmlWarnings: number; cssErrors: number; cssWarnings: number; brokenInternal: number; brokenExternal: number }> {
  const { startUrl, mode, maxPages, onPage, shouldCancel } = opts
  const collectSeo = !!opts.seo
  const collectA11y = opts.a11y !== false   // default true
  const collectHtml = !!opts.html
  const collectCss = !!opts.css
  const collectLinks = !!opts.linkcheck
  const tags = RULESET_TAGS[opts.ruleset ?? 'default']
  // Shared across pages so each distinct URL is probed only once per crawl.
  const linkCache = new Map<string, LinkStatus>()
  const siteOrigin = (() => { try { return new URL(normalize(startUrl)).origin } catch { return '' } })()
  const limit = mode === 'single' ? 1 : Math.max(1, maxPages)

  const browser = await launchBrowser()
  let pagesCrawled = 0
  let totalIssues = 0
  let cancelled = false
  let seoScoreSum = 0
  let seoScoreCount = 0
  let seoIssues = 0
  let htmlErrors = 0
  let htmlWarnings = 0
  let cssErrors = 0
  let cssWarnings = 0
  let brokenInternal = 0
  let brokenExternal = 0

  // Site-level SEO probe (robots.txt / sitemap.xml) — once per crawl.
  let seoSite: SeoSiteResult | null = null
  if (collectSeo) {
    try { seoSite = await checkSiteSeo(new URL(normalize(startUrl)).origin) } catch { seoSite = null }
  }

  try {
    const context = await browser.newContext({ userAgent: AUDIT_USER_AGENT })

    // SSRF defense-in-depth: block navigations (incl. redirects) to private/
    // internal addresses. Only document requests are DNS-checked to stay fast.
    await context.route('**/*', async route => {
      if (route.request().resourceType() === 'document') {
        try { await assertSafeUrl(route.request().url()) }
        catch { return route.abort('blockedbyclient') }
      }
      return route.continue()
    })

    const page = await context.newPage()

    const start = normalize(startUrl)
    const queue: string[] = [start]
    const seen = new Set<string>([start])

    while (queue.length > 0 && pagesCrawled < limit) {
      if (shouldCancel && (await shouldCancel())) {
        cancelled = true
        break
      }
      const url = queue.shift()!
      const result = await auditPage(page, url, tags, collectSeo, collectA11y, collectHtml, collectCss, collectLinks, siteOrigin, linkCache)
      pagesCrawled++
      totalIssues += result.violations
      if (result.seo) {
        seoScoreSum += result.seo.score
        seoScoreCount++
        // Count failing + warning SEO checks as "issues" for the SEO audit summary.
        seoIssues += result.seo.checks.filter(c => c.weight > 0 && c.status !== 'pass').length
      }
      if (result.html) {
        htmlErrors += result.html.errors
        htmlWarnings += result.html.warnings
      }
      if (result.css) {
        cssErrors += result.css.errors
        cssWarnings += result.css.warnings
      }
      if (result.links) {
        brokenInternal += result.links.brokenInternal
        brokenExternal += result.links.brokenExternal
      }
      await onPage(result)

      // Discover more same-origin links only in full-crawl mode.
      if (mode === 'full' && !result.error && seen.size < limit) {
        let hrefs: string[] = []
        try {
          hrefs = await page.$$eval('a[href]', els =>
            els.map(el => (el as HTMLAnchorElement).href)
          )
        } catch {
          // ignore link-extraction failures; page still counts
        }

        for (const raw of hrefs) {
          if (seen.size >= limit) break
          const next = normalize(raw)
          if (
            !seen.has(next) &&
            /^https?:/.test(next) &&
            sameOrigin(next, start)
          ) {
            seen.add(next)
            queue.push(next)
          }
        }
      }
    }

    await context.close()
  } finally {
    await browser.close()
  }

  const seoScore = seoScoreCount > 0 ? Math.round(seoScoreSum / seoScoreCount) : null
  return { pagesCrawled, totalIssues, cancelled, seoScore, seoIssues, seoSite, htmlErrors, htmlWarnings, cssErrors, cssWarnings, brokenInternal, brokenExternal }
}
