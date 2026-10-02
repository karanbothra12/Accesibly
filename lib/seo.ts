// ── Technical SEO audit ──────────────────────────────────────────
// Pure scoring logic (unit-tested) plus a site-level robots/sitemap probe.
// Raw signals are extracted from the rendered page by the crawler (lib/audit.ts)
// on the same page load as the accessibility pass — no extra fetches per page.

export type SeoStatus = 'pass' | 'warn' | 'fail'

export interface SeoSignals {
  statusCode: number | null
  title: string | null
  metaDescription: string | null
  h1Count: number
  canonical: string | null
  robotsMeta: string | null      // raw content of <meta name="robots">
  noindex: boolean
  htmlLang: string | null
  hasViewport: boolean
  ogTitle: boolean
  ogDescription: boolean
  ogImage: boolean
  twitterCard: boolean
  jsonLdCount: number
  hreflangCount: number
  imgTotal: number
  imgWithAlt: number
  wordCount: number
  headingOrderOk: boolean
  // Optional page-quality signals (added later; default to clean when absent).
  imgMissingDims?: number       // <img> without both width & height (layout-shift/CLS risk)
  genericLinkCount?: number      // links with vague text ("click here", "read more", …)
  internalNofollowCount?: number // same-origin links marked rel="nofollow"
  urlHasUnderscore?: boolean      // page URL path contains underscores (Google prefers hyphens)
}

export interface SeoCheck {
  id: string
  label: string
  status: SeoStatus
  detail: string
  weight: number   // 0 for informational checks (excluded from the score)
}

export interface SeoResult {
  score: number    // 0–100
  checks: SeoCheck[]
  meta: {
    title: string | null
    titleLength: number
    metaDescription: string | null
    metaDescriptionLength: number
    statusCode: number | null
    indexable: boolean
    wordCount: number
  }
}

export interface SeoSiteResult {
  robotsTxt: { found: boolean; referencesSitemap: boolean }
  sitemapXml: { found: boolean; urlCount: number | null }
}

const len = (s: string | null) => (s ? s.trim().length : 0)

// Turn raw page signals into a scored, human-readable technical-SEO report.
export function scoreSeo(s: SeoSignals): SeoResult {
  const checks: SeoCheck[] = []
  const add = (id: string, label: string, status: SeoStatus, detail: string, weight: number) =>
    checks.push({ id, label, status, detail, weight })

  // Title
  const tl = len(s.title)
  if (tl === 0) add('title', 'Title tag', 'fail', 'Missing <title>.', 20)
  else if (tl < 30 || tl > 60) add('title', 'Title tag', 'warn', `${tl} chars (aim 30–60).`, 20)
  else add('title', 'Title tag', 'pass', `${tl} chars.`, 20)

  // Meta description
  const dl = len(s.metaDescription)
  if (dl === 0) add('meta_description', 'Meta description', 'fail', 'Missing meta description.', 15)
  else if (dl < 50 || dl > 160) add('meta_description', 'Meta description', 'warn', `${dl} chars (aim 50–160).`, 15)
  else add('meta_description', 'Meta description', 'pass', `${dl} chars.`, 15)

  // H1
  if (s.h1Count === 0) add('h1', 'H1 heading', 'fail', 'No <h1> on the page.', 15)
  else if (s.h1Count > 1) add('h1', 'H1 heading', 'warn', `${s.h1Count} <h1> tags (prefer one).`, 15)
  else add('h1', 'H1 heading', 'pass', 'Exactly one <h1>.', 15)

  // Canonical
  if (s.canonical) add('canonical', 'Canonical URL', 'pass', 'Canonical link present.', 10)
  else add('canonical', 'Canonical URL', 'warn', 'No rel="canonical" link.', 10)

  // Indexability
  if (s.noindex) add('indexable', 'Indexability', 'fail', 'Page is set to noindex — it will not rank.', 10)
  else add('indexable', 'Indexability', 'pass', 'Page is indexable.', 10)

  // Mobile viewport
  if (s.hasViewport) add('viewport', 'Mobile viewport', 'pass', 'Viewport meta present.', 10)
  else add('viewport', 'Mobile viewport', 'warn', 'No responsive viewport meta.', 10)

  // html lang
  if (s.htmlLang) add('html_lang', 'Language attribute', 'pass', `lang="${s.htmlLang}".`, 5)
  else add('html_lang', 'Language attribute', 'warn', 'No <html lang> attribute.', 5)

  // Open Graph
  const ogMissing = [!s.ogTitle && 'og:title', !s.ogDescription && 'og:description', !s.ogImage && 'og:image'].filter(Boolean)
  if (ogMissing.length === 0) add('open_graph', 'Open Graph tags', 'pass', 'og:title, og:description and og:image present.', 5)
  else add('open_graph', 'Open Graph tags', 'warn', `Missing ${ogMissing.join(', ')}.`, 5)

  // Image alt coverage
  if (s.imgTotal === 0) add('image_alt', 'Image alt text', 'pass', 'No images on the page.', 5)
  else if (s.imgWithAlt === s.imgTotal) add('image_alt', 'Image alt text', 'pass', `All ${s.imgTotal} images have alt text.`, 5)
  else add('image_alt', 'Image alt text', 'warn', `${s.imgTotal - s.imgWithAlt} of ${s.imgTotal} images missing alt.`, 5)

  // Content depth
  if (s.wordCount < 200) add('content', 'Content depth', 'warn', `~${s.wordCount} words (thin content).`, 5)
  else add('content', 'Content depth', 'pass', `~${s.wordCount} words.`, 5)

  // Heading order
  if (s.headingOrderOk) add('heading_order', 'Heading structure', 'pass', 'No skipped heading levels.', 2)
  else add('heading_order', 'Heading structure', 'warn', 'Heading levels are skipped.', 2)

  // Image dimensions (layout shift / CLS — a page-experience ranking signal)
  const imgMissingDims = s.imgMissingDims ?? 0
  if (s.imgTotal === 0) add('image_dimensions', 'Image dimensions', 'pass', 'No images on the page.', 3)
  else if (imgMissingDims > 0) add('image_dimensions', 'Image dimensions', 'warn', `${imgMissingDims} of ${s.imgTotal} images missing width/height (causes layout shift).`, 3)
  else add('image_dimensions', 'Image dimensions', 'pass', `All ${s.imgTotal} images set explicit width/height.`, 3)

  // Descriptive link text (vague anchors hurt SEO and accessibility)
  const genericLinks = s.genericLinkCount ?? 0
  if (genericLinks > 0) add('link_text', 'Descriptive link text', 'warn', `${genericLinks} link${genericLinks === 1 ? ' uses' : 's use'} vague text like “click here” or “read more”.`, 2)
  else add('link_text', 'Descriptive link text', 'pass', 'No vague link text found.', 2)

  // Informational (weight 0 — not scored)
  if ((s.urlHasUnderscore ?? false)) add('url_hygiene', 'URL structure', 'warn', 'URL path uses underscores — Google recommends hyphens.', 0)
  const internalNofollow = s.internalNofollowCount ?? 0
  if (internalNofollow > 0) add('internal_nofollow', 'Internal nofollow', 'warn', `${internalNofollow} internal link${internalNofollow === 1 ? ' uses' : 's use'} rel="nofollow" (dilutes crawl).`, 0)
  add('structured_data', 'Structured data', s.jsonLdCount > 0 ? 'pass' : 'warn',
    s.jsonLdCount > 0 ? `${s.jsonLdCount} JSON-LD block(s).` : 'No JSON-LD structured data.', 0)
  if (s.hreflangCount > 0) add('hreflang', 'hreflang', 'pass', `${s.hreflangCount} hreflang link(s).`, 0)
  add('http_status', 'HTTP status', s.statusCode && s.statusCode >= 400 ? 'fail' : 'pass',
    s.statusCode ? `HTTP ${s.statusCode}.` : 'Unknown status.', 0)

  // Weighted score: pass = full, warn = half, fail = 0.
  let earned = 0, total = 0
  for (const c of checks) {
    if (c.weight <= 0) continue
    total += c.weight
    earned += c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight / 2 : 0
  }
  const score = total > 0 ? Math.round((earned / total) * 100) : 0

  return {
    score,
    checks,
    meta: {
      title: s.title, titleLength: tl,
      metaDescription: s.metaDescription, metaDescriptionLength: dl,
      statusCode: s.statusCode, indexable: !s.noindex, wordCount: s.wordCount,
    },
  }
}

// Site-level probe: robots.txt and sitemap.xml presence (one request each).
// Best-effort — failures resolve to "not found" rather than throwing.
export async function checkSiteSeo(origin: string): Promise<SeoSiteResult> {
  const result: SeoSiteResult = {
    robotsTxt: { found: false, referencesSitemap: false },
    sitemapXml: { found: false, urlCount: null },
  }
  const get = async (path: string): Promise<{ ok: boolean; body: string }> => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 8000)
      const res = await fetch(new URL(path, origin).toString(), { signal: ctrl.signal, redirect: 'follow' })
      clearTimeout(t)
      if (!res.ok) return { ok: false, body: '' }
      return { ok: true, body: (await res.text()).slice(0, 200_000) }
    } catch {
      return { ok: false, body: '' }
    }
  }

  const robots = await get('/robots.txt')
  if (robots.ok) {
    result.robotsTxt.found = true
    result.robotsTxt.referencesSitemap = /sitemap:\s*http/i.test(robots.body)
  }
  const sitemap = await get('/sitemap.xml')
  if (sitemap.ok) {
    result.sitemapXml.found = true
    const m = sitemap.body.match(/<loc>/gi)
    result.sitemapXml.urlCount = m ? m.length : 0
  }
  return result
}
