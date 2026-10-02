import { runCrawl, type PageAuditResult } from '@/lib/audit'

// ── Competitor analysis: audit-based scorecard ───────────────────
// Runs a single-page accessibility + technical-SEO audit against a URL and
// returns headline scores. Used to compare your site vs. a competitor's.

export type Scorecard = {
  url: string
  ok: boolean
  statusCode: number | null
  error: string | null
  a11yIssues: number
  critical: number
  serious: number
  moderate: number
  minor: number
  seoScore: number | null
  seoIssues: number | null
}

export function normalizeUrl(input: string): string | null {
  let u = input.trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  try { return new URL(u).toString() } catch { return null }
}

export async function runScorecard(url: string): Promise<Scorecard> {
  let result: PageAuditResult | null = null
  await runCrawl({
    startUrl: url,
    mode: 'single',
    maxPages: 1,
    a11y: true,
    seo: true,
    onPage: async r => { result = r },
  })

  const r = result as PageAuditResult | null
  if (!r) {
    return { url, ok: false, statusCode: null, error: 'Could not load page', a11yIssues: 0, critical: 0, serious: 0, moderate: 0, minor: 0, seoScore: null, seoIssues: null }
  }
  const seoIssues = r.seo ? r.seo.checks.filter(c => c.weight > 0 && c.status !== 'pass').length : null
  return {
    url, ok: !r.error, statusCode: r.statusCode, error: r.error,
    a11yIssues: r.violations, critical: r.critical, serious: r.serious, moderate: r.moderate, minor: r.minor,
    seoScore: r.seo ? r.seo.score : null,
    seoIssues,
  }
}

export type CompetitorResult = { you: Scorecard; competitor: Scorecard }

export async function compare(yourUrl: string, competitorUrl: string): Promise<CompetitorResult> {
  // Sequential to keep memory/CPU bounded (each launches a headless browser).
  const you = await runScorecard(yourUrl)
  const competitor = await runScorecard(competitorUrl)
  return { you, competitor }
}
