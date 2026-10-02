import { describe, it, expect } from 'vitest'
import { scoreSeo, type SeoSignals } from '@/lib/seo'

// A fully-optimized page baseline; individual tests override single fields.
function signals(over: Partial<SeoSignals> = {}): SeoSignals {
  return {
    statusCode: 200,
    title: 'A well-written page title about widgets', // 40 chars
    metaDescription: 'A clear, useful meta description that sits comfortably within the recommended fifty to one hundred sixty character window.',
    h1Count: 1,
    canonical: 'https://example.com/page',
    robotsMeta: null,
    noindex: false,
    htmlLang: 'en',
    hasViewport: true,
    ogTitle: true,
    ogDescription: true,
    ogImage: true,
    twitterCard: true,
    jsonLdCount: 1,
    hreflangCount: 0,
    imgTotal: 4,
    imgWithAlt: 4,
    wordCount: 800,
    headingOrderOk: true,
    ...over,
  }
}

const check = (r: ReturnType<typeof scoreSeo>, id: string) => r.checks.find(c => c.id === id)!

describe('scoreSeo', () => {
  it('gives a perfect page a score of 100', () => {
    const r = scoreSeo(signals())
    expect(r.score).toBe(100)
    expect(r.checks.every(c => c.weight === 0 || c.status === 'pass')).toBe(true)
  })

  it('fails a page missing title, meta description and h1', () => {
    const r = scoreSeo(signals({ title: null, metaDescription: null, h1Count: 0 }))
    expect(check(r, 'title').status).toBe('fail')
    expect(check(r, 'meta_description').status).toBe('fail')
    expect(check(r, 'h1').status).toBe('fail')
    expect(r.score).toBeLessThan(60)
  })

  it('warns on a too-short title and too-long meta description', () => {
    const r = scoreSeo(signals({ title: 'Hi', metaDescription: 'x'.repeat(200) }))
    expect(check(r, 'title').status).toBe('warn')
    expect(check(r, 'meta_description').status).toBe('warn')
  })

  it('warns when there are multiple h1 tags', () => {
    expect(check(scoreSeo(signals({ h1Count: 3 })), 'h1').status).toBe('warn')
  })

  it('fails indexability when the page is noindex', () => {
    const r = scoreSeo(signals({ noindex: true, robotsMeta: 'noindex, nofollow' }))
    expect(check(r, 'indexable').status).toBe('fail')
    expect(r.meta.indexable).toBe(false)
  })

  it('warns on missing canonical, viewport, lang and open graph', () => {
    const r = scoreSeo(signals({ canonical: null, hasViewport: false, htmlLang: null, ogImage: false }))
    expect(check(r, 'canonical').status).toBe('warn')
    expect(check(r, 'viewport').status).toBe('warn')
    expect(check(r, 'html_lang').status).toBe('warn')
    expect(check(r, 'open_graph').status).toBe('warn')
    expect(check(r, 'open_graph').detail).toContain('og:image')
  })

  it('flags partial image alt coverage and thin content', () => {
    const r = scoreSeo(signals({ imgTotal: 10, imgWithAlt: 6, wordCount: 50 }))
    expect(check(r, 'image_alt').status).toBe('warn')
    expect(check(r, 'image_alt').detail).toContain('4 of 10')
    expect(check(r, 'content').status).toBe('warn')
  })

  it('treats a page with no images as passing alt coverage', () => {
    expect(check(scoreSeo(signals({ imgTotal: 0, imgWithAlt: 0 })), 'image_alt').status).toBe('pass')
  })

  it('never returns a score outside 0–100', () => {
    const worst = scoreSeo(signals({
      title: null, metaDescription: null, h1Count: 0, canonical: null, noindex: true,
      robotsMeta: 'noindex', htmlLang: null, hasViewport: false, ogTitle: false, ogDescription: false,
      ogImage: false, imgTotal: 5, imgWithAlt: 0, wordCount: 10, headingOrderOk: false,
    }))
    expect(worst.score).toBeGreaterThanOrEqual(0)
    expect(worst.score).toBeLessThanOrEqual(100)
  })
})

describe('scoreSeo — page-quality additions', () => {
  const find = (r: ReturnType<typeof scoreSeo>, id: string) => r.checks.find(c => c.id === id)

  it('passes image dimensions when all images set width/height', () => {
    expect(find(scoreSeo(signals({ imgTotal: 3, imgMissingDims: 0 })), 'image_dimensions')!.status).toBe('pass')
  })
  it('warns on images missing width/height (CLS)', () => {
    const c = find(scoreSeo(signals({ imgTotal: 5, imgMissingDims: 2 })), 'image_dimensions')!
    expect(c.status).toBe('warn')
    expect(c.detail).toContain('2 of 5')
  })
  it('warns on vague link text', () => {
    expect(find(scoreSeo(signals({ genericLinkCount: 3 })), 'link_text')!.status).toBe('warn')
    expect(find(scoreSeo(signals({ genericLinkCount: 0 })), 'link_text')!.status).toBe('pass')
  })
  it('flags underscore URLs and internal nofollow as informational', () => {
    expect(find(scoreSeo(signals({ urlHasUnderscore: true })), 'url_hygiene')!.weight).toBe(0)
    expect(find(scoreSeo(signals({ internalNofollowCount: 4 })), 'internal_nofollow')!.status).toBe('warn')
  })
  it('keeps a clean page at 100 despite the new checks', () => {
    expect(scoreSeo(signals()).score).toBe(100)
  })
})
