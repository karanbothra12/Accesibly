import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCrawl } from '@/lib/audit'
import type { PageAuditResult } from '@/lib/audit'

// Real headless-Chromium run proving SEO extraction+scoring works end to end.
// Opt-in (browser required): RUN_SEO_E2E=1 npx vitest run tests/seo-e2e.manual.test.ts
describe.skipIf(process.env.RUN_SEO_E2E !== '1')('SEO extraction (real browser)', () => {
  it('extracts and scores a real rendered page', async () => {
    const html = `<!doctype html><html lang="en"><head>
      <meta charset="utf-8">
      <title>Best Widgets for Modern Teams — Buyer's Guide</title>
      <meta name="description" content="An in-depth, genuinely useful guide to choosing widgets, comfortably within the fifty to one hundred sixty character sweet spot for search snippets.">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="canonical" href="https://example.com/widgets">
      <meta property="og:title" content="Best Widgets">
      <meta property="og:description" content="Guide">
      <meta property="og:image" content="https://example.com/og.png">
      <meta name="twitter:card" content="summary">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>
    </head><body>
      <h1>Best Widgets for Modern Teams</h1>
      <h2>Why widgets matter</h2>
      <p>${'Widgets are wonderful and useful. '.repeat(60)}</p>
      <img src="a.png" alt="a labelled widget">
      <img src="b.png" alt="another labelled widget">
    </body></html>`
    const file = join(tmpdir(), `seo-e2e-${Date.now()}.html`)
    writeFileSync(file, html)

    const pages: PageAuditResult[] = []
    const res = await runCrawl({
      startUrl: `file://${file}`,
      mode: 'single',
      maxPages: 1,
      seo: true,
      onPage: async p => { pages.push(p) },
    })

    expect(pages).toHaveLength(1)
    const seo = pages[0].seo
    expect(seo).not.toBeNull()
    // A well-formed page should score high.
    expect(seo!.score).toBeGreaterThanOrEqual(90)
    expect(seo!.meta.title).toContain('Widgets')
    expect(seo!.meta.indexable).toBe(true)
    expect(seo!.checks.find(c => c.id === 'title')!.status).toBe('pass')
    expect(seo!.checks.find(c => c.id === 'h1')!.status).toBe('pass')
    expect(res.seoScore).toBeGreaterThanOrEqual(90)
  }, 60000)
})
