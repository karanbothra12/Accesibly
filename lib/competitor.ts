import { runCrawl, type PageAuditResult } from '@/lib/audit'

// ── Competitor analysis: audit-based scorecard ───────────────────
// Runs a single-page accessibility + technical-SEO audit against a URL and
// returns headline scores. Used to compare your site vs. a competitor's.

// A single accessibility rule that failed, with enough detail to act on it.
export type IssueDetail = {
  id: string            // axe rule id, e.g. "color-contrast"
  impact: string        // critical | serious | moderate | minor
  description: string
  help: string
  helpUrl: string | null
  count: number         // how many elements failed this rule
  sample: string[]      // up to 3 example CSS selectors
}

// A single technical-SEO check that failed or warned.
export type SeoFailure = {
  id: string
  label: string
  status: 'warn' | 'fail'
  detail: string
  weight: number
}

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
  // Full detail of WHAT failed (not just counts) — for the side-by-side view.
  issues: IssueDetail[]
  seoFailures: SeoFailure[]
}

const IMPACT_ORDER: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 }

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
    return { url, ok: false, statusCode: null, error: 'Could not load page', a11yIssues: 0, critical: 0, serious: 0, moderate: 0, minor: 0, seoScore: null, seoIssues: null, issues: [], seoFailures: [] }
  }

  // Extract the actual accessibility violations (axe + our custom checks),
  // sorted most-severe first, with a few sample selectors each.
  const rawViolations = Array.isArray(r.results) ? r.results : []
  const issues: IssueDetail[] = rawViolations.map(v => {
    const vv = v as { id?: string; impact?: string; description?: string; help?: string; helpUrl?: string; nodes?: Array<{ target?: string[] }> }
    const nodes = Array.isArray(vv.nodes) ? vv.nodes : []
    return {
      id: vv.id || 'unknown',
      impact: vv.impact || 'minor',
      description: vv.description || '',
      help: vv.help || '',
      helpUrl: vv.helpUrl || null,
      count: nodes.length,
      sample: nodes.slice(0, 3).map(n => (n.target && n.target[0]) || '').filter(Boolean),
    }
  })
  issues.sort((a, b) => (IMPACT_ORDER[a.impact] ?? 4) - (IMPACT_ORDER[b.impact] ?? 4))

  // The SEO checks that failed or warned (scored checks only).
  const seoFailures: SeoFailure[] = r.seo
    ? r.seo.checks
        .filter(c => c.weight > 0 && c.status !== 'pass')
        .map(c => ({ id: c.id, label: c.label, status: c.status as 'warn' | 'fail', detail: c.detail, weight: c.weight }))
    : []

  return {
    url, ok: !r.error, statusCode: r.statusCode, error: r.error,
    a11yIssues: r.violations, critical: r.critical, serious: r.serious, moderate: r.moderate, minor: r.minor,
    seoScore: r.seo ? r.seo.score : null,
    seoIssues: seoFailures.length,
    issues,
    seoFailures,
  }
}

export type CompetitorResult = { you: Scorecard; competitor: Scorecard }

export async function compare(yourUrl: string, competitorUrl: string): Promise<CompetitorResult> {
  // Sequential to keep memory/CPU bounded (each launches a headless browser).
  const you = await runScorecard(yourUrl)
  const competitor = await runScorecard(competitorUrl)
  return { you, competitor }
}
