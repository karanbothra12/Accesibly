// ── Scheduled monitoring — shared helpers (pure, unit-tested) ──────
// One WCAG/quality engine runs on a cadence; we compare each run to the previous
// baseline and alert only on regressions.

export const MONITOR_INTERVALS = [1, 7, 30] as const
export type MonitorInterval = typeof MONITOR_INTERVALS[number]

export function intervalLabel(days: number): string {
  return days === 1 ? 'Daily' : days === 7 ? 'Weekly' : days === 30 ? 'Monthly' : `Every ${days}d`
}

// Which cadences a plan may pick, given its `min_monitor_interval_days` limit.
// 0 (or negative) means monitoring is not available on that plan.
export function allowedIntervals(minIntervalDays: number): number[] {
  if (!minIntervalDays || minIntervalDays <= 0) return []
  return MONITOR_INTERVALS.filter(d => d >= minIntervalDays)
}

export type RunMetrics = { issues: number; score: number | null }

// Regression = it got worse since the last run: more issues, or a lower score
// (score only applies to SEO/security). First run (prev == null) is never a
// regression — it just sets the baseline.
export function isRegression(prev: RunMetrics | null, next: RunMetrics): boolean {
  if (!prev) return false
  if (next.issues > prev.issues) return true
  if (prev.score != null && next.score != null && next.score < prev.score) return true
  return false
}

// Human summary of what changed, for the alert email.
export function regressionSummary(prev: RunMetrics, next: RunMetrics): string {
  const parts: string[] = []
  if (next.issues > prev.issues) parts.push(`issues rose from ${prev.issues} to ${next.issues}`)
  if (prev.score != null && next.score != null && next.score < prev.score) parts.push(`score fell from ${prev.score} to ${next.score}`)
  return parts.join(' · ') || 'results changed'
}

export const MONITOR_TYPE_LABEL: Record<string, string> = {
  accessibility: 'Accessibility',
  seo: 'SEO',
  html: 'HTML validation',
  css: 'CSS validation',
  links: 'Broken links',
  security: 'Security & headers',
}
