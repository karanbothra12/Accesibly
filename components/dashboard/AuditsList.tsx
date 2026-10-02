'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STANDARDS, summarizeStandards, violationInScope, getStandard, type StandardSummary } from '@/lib/standards'
import { intervalLabel } from '@/lib/monitors'

type Site = { id: number; domain: string }

type Mode = 'single' | 'full'

type Ruleset = 'default' | 'wcag-strict' | 'wcag-aaa' | 'all'

type SeoCheck = { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string; weight: number }
type SeoResult = {
  score: number
  checks: SeoCheck[]
  meta: { title: string | null; titleLength: number; metaDescription: string | null; metaDescriptionLength: number; statusCode: number | null; indexable: boolean; wordCount: number }
}
type SeoSite = {
  robotsTxt: { found: boolean; referencesSitemap: boolean }
  sitemapXml: { found: boolean; urlCount: number | null }
}

type HtmlSeverity = 'error' | 'warning' | 'info'
type HtmlMessage = {
  severity: HtmlSeverity
  message: string
  line: number | null
  column: number | null
  extract: string | null
  fatal: boolean
}
type HtmlResult = {
  errors: number
  warnings: number
  info: number
  ok: boolean
  messages: HtmlMessage[]
  validatorError: string | null
}

type CssSeverity = 'error' | 'warning'
type CssMessage = { severity: CssSeverity; message: string; line: number | null; source: string | null; context: string | null }
type CssResult = { errors: number; warnings: number; ok: boolean; messages: CssMessage[]; validatorError: string | null }

type SecStatus = 'pass' | 'warn' | 'fail'
type SecCheck = { id: string; label: string; status: SecStatus; detail: string; weight: number }
type TlsInfo = { protocol: string | null; issuer: string | null; validTo: string | null; daysToExpiry: number | null }
type SecurityResult = {
  score: number
  checks: SecCheck[]
  meta: { finalUrl: string | null; statusCode: number | null; https: boolean; server: string | null; poweredBy: string | null; tls: TlsInfo | null }
}

type LinkKind = 'internal' | 'external'
type BrokenLink = { url: string; status: number | null; kind: LinkKind; reason: string }
type LinkCheckResult = { total: number; checked: number; brokenInternal: number; brokenExternal: number; links: BrokenLink[] }

type AuditType = 'accessibility' | 'seo' | 'html' | 'css' | 'security' | 'links'

type Job = {
  id: number
  mode: Mode
  start_url: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  ruleset: Ruleset
  max_pages: number
  pages_crawled: number
  total_issues: number
  error: string | null
  seo_enabled?: boolean
  seo_score?: number | null
  seo_site?: SeoSite | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

const RULESET_OPTIONS: { value: Ruleset; label: string }[] = [
  { value: 'default', label: 'WCAG A/AA + best practice' },
  { value: 'wcag-strict', label: 'WCAG A/AA only (strict)' },
  { value: 'wcag-aaa', label: 'WCAG A/AA/AAA' },
  { value: 'all', label: 'Everything (incl. experimental)' },
]

const RULESET_LABEL: Record<Ruleset, string> = {
  default: 'A/AA + BP',
  'wcag-strict': 'A/AA strict',
  'wcag-aaa': 'A/AA/AAA',
  all: 'All + experimental',
}

// Parse axe violation tags into a WCAG conformance level and success-criteria list.
function parseWcag(tags: string[] = []): { level: string | null; criteria: string[] } {
  let level: string | null = null
  if (tags.includes('wcag2aaa') || tags.includes('wcag21aaa')) level = 'AAA'
  else if (tags.includes('wcag2aa') || tags.includes('wcag21aa') || tags.includes('wcag22aa')) level = 'AA'
  else if (tags.includes('wcag2a') || tags.includes('wcag21a')) level = 'A'
  else if (tags.includes('best-practice')) level = 'Best practice'
  else if (tags.includes('experimental')) level = 'Experimental'

  const criteria: string[] = []
  for (const t of tags) {
    const m = t.match(/^wcag(\d)(\d)(\d+)$/)
    if (m) criteria.push(`${m[1]}.${m[2]}.${m[3]}`)
  }
  return { level, criteria }
}

type ViolationNode = {
  html: string
  target?: string[]
  failureSummary?: string
}

type Violation = {
  id: string
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null
  description: string
  help: string
  helpUrl: string
  tags: string[]
  nodes: ViolationNode[]
}

type PageRow = {
  id: number
  url: string
  status_code: number | null
  violations: number
  critical: number
  serious: number
  moderate: number
  minor: number
  results: Violation[] | null
  seo: SeoResult | null
  html: HtmlResult | null
  css: CssResult | null
  security: SecurityResult | null
  links: LinkCheckResult | null
  error: string | null
  audited_at: string
}

const IMPACT_STYLES: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  serious: 'bg-orange-50 text-orange-700 border-orange-200',
  moderate: 'bg-amber-50 text-amber-700 border-amber-200',
  minor: 'bg-slate-100 text-slate-600 border-slate-200',
}

function duration(job: Job): string {
  if (!job.started_at || !job.finished_at) return '—'
  const ms = new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export default function AuditsList({ sites, type = 'accessibility', canPdf = false }: { sites: Site[]; type?: AuditType; canPdf?: boolean }) {
  const isSeo = type === 'seo'
  const isHtml = type === 'html'
  const isCss = type === 'css'
  const isSecurity = type === 'security'
  const isLinks = type === 'links'
  const isA11y = type === 'accessibility'
  const [siteId, setSiteId] = useState<number | null>(sites[0]?.id ?? null)
  const [mode, setMode] = useState<Mode>('full')
  const [ruleset, setRuleset] = useState<Ruleset>('default')
  const [startUrl, setStartUrl] = useState('')
  const [maxPages, setMaxPages] = useState(20)
  const [launching, setLaunching] = useState(false)
  const [launchError, setLaunchError] = useState('')
  // Overage confirmation prompt (set when the server asks us to authorize extra pages).
  const [overage, setOverage] = useState<null | {
    requestedPages: number; includedPages: number; extraPages: number; pricePerPage: number; extraCost: number
  }>(null)

  const [jobs, setJobs] = useState<Job[]>([])
  const [activeJobId, setActiveJobId] = useState<number | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [pages, setPages] = useState<PageRow[]>([])

  const [openPage, setOpenPage] = useState<number | null>(null)
  const [openViolation, setOpenViolation] = useState<string | null>(null)
  const [stdKey, setStdKey] = useState('all')

  // Scheduled-monitoring state for the selected site (feature + this site's schedules).
  type MonitorInfo = {
    available: boolean; intervals: number[]; minInterval: number; monitoredSites: number; monitoredLimit: number
    schedules: { job_type: string; interval_days: number; enabled: boolean; next_run_at: string | null; last_run_at: string | null; last_issues: number | null }[]
  }
  const [monitor, setMonitor] = useState<MonitorInfo | null>(null)

  // Map the accessibility findings to each legislation/standard (client-side,
  // from axe tags — no extra request). Rules are de-duped across pages.
  const { standards, totalRules } = useMemo<{ standards: StandardSummary[]; totalRules: number }>(() => {
    if (!isA11y) return { standards: [], totalRules: 0 }
    const vios = pages.flatMap(p => p.results || [])
    const ids = new Set(vios.map(v => v.id || JSON.stringify(v.tags)))
    return { standards: summarizeStandards(vios), totalRules: ids.size }
  }, [isA11y, pages])

  // The standard currently used to filter the findings list ('all' = no filter).
  const activeStd = stdKey === 'all' ? null : getStandard(stdKey) ?? null

  // Load monitoring config/schedules whenever the selected site changes.
  useEffect(() => {
    if (!siteId) return
    let alive = true
    ;(async () => {
      const r = await fetch(`/api/monitors?site_id=${siteId}`)
      if (!r.ok || !alive) return
      const d = await r.json()
      if (alive) setMonitor(d as MonitorInfo)
    })()
    return () => { alive = false }
  }, [siteId])

  async function saveMonitor(nextEnabled: boolean, days: number) {
    if (!siteId) return
    await fetch('/api/monitors', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, job_type: type, interval_days: days, enabled: nextEnabled }),
    })
    const g = await fetch(`/api/monitors?site_id=${siteId}`)
    if (g.ok) setMonitor(await g.json() as MonitorInfo)
  }

  const monitorSchedule = monitor?.schedules.find(s => s.job_type === type) ?? null
  const monitorOn = !!monitorSchedule?.enabled
  const monitorDays = monitorSchedule?.interval_days ?? monitor?.intervals?.[0] ?? 7

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load audit history for the selected site ────────────────
  const loadJobs = useCallback(async (id: number) => {
    const res = await fetch(`/api/audits?site_id=${id}&type=${type}`)
    if (res.ok) {
      const data = await res.json()
      setJobs(data.jobs as Job[])
    }
  }, [type])

  useEffect(() => {
    if (!siteId) return
    let cancelled = false
    ;(async () => {
      const res = await fetch(`/api/audits?site_id=${siteId}&type=${type}`)
      if (!res.ok || cancelled) return
      const data = await res.json()
      const list = data.jobs as Job[]
      if (cancelled) return
      setJobs(list)
      // Show the most recent run's results immediately — no need to click "View".
      // (null when the site has no audits yet, which also clears a stale report.)
      setActiveJobId(list.length > 0 ? list[0].id : null)
      setJob(null)
      setPages([])
    })()
    return () => {
      cancelled = true
    }
  }, [siteId, type])

  // ── Poll the active job while it runs ───────────────────────
  useEffect(() => {
    if (!activeJobId) return

    let cancelled = false
    async function tick() {
      const res = await fetch(`/api/audits/${activeJobId}`)
      if (!res.ok || cancelled) return
      const data = await res.json()
      setJob(data.job as Job)
      setPages(data.pages as PageRow[])
      const status = (data.job as Job).status
      if (status === 'done' || status === 'failed' || status === 'cancelled') {
        if (pollRef.current) clearInterval(pollRef.current)
        pollRef.current = null
        if (siteId) loadJobs(siteId)
      }
    }

    tick()
    pollRef.current = setInterval(tick, 5000)
    return () => {
      cancelled = true
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [activeJobId, siteId, loadJobs])

  async function launch(confirmOverage = false) {
    if (!siteId) return
    setLaunchError('')
    if (!confirmOverage) setOverage(null)
    setLaunching(true)
    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: siteId,
          type,
          mode,
          ruleset,
          start_url: startUrl.trim() || undefined,
          max_pages: mode === 'full' ? maxPages : 1,
          confirm_overage: confirmOverage,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Structured entitlement errors — surface the right UI for each.
        if (data.code === 'PAGE_LIMIT_EXCEEDED' && data.confirmationRequired) {
          setOverage({
            requestedPages: data.requestedPages,
            includedPages: data.includedPages,
            extraPages: data.extraPages,
            pricePerPage: data.pricePerPage,
            extraCost: data.extraCost,
          })
          return
        }
        setLaunchError(data.message || data.error || 'Failed to start audit')
        return
      }
      setOverage(null)
      setPages([])
      setOpenPage(null)
      setJob(data.job as Job)
      setActiveJobId((data.job as Job).id)
    } catch {
      setLaunchError('Network error')
    } finally {
      setLaunching(false)
    }
  }

  const [cancelling, setCancelling] = useState(false)
  async function cancelJob(id: number) {
    setCancelling(true)
    try {
      const res = await fetch(`/api/audits/${id}`, { method: 'PATCH' })
      if (res.ok) {
        const data = await res.json()
        setJob(j => (j && j.id === id ? { ...j, status: data.job.status } : j))
      }
    } finally {
      setCancelling(false)
    }
  }

  async function openJob(id: number) {
    setActiveJobId(id)
    setOpenPage(null)
    const res = await fetch(`/api/audits/${id}`)
    if (res.ok) {
      const data = await res.json()
      setJob(data.job as Job)
      setPages(data.pages as PageRow[])
    }
  }

  if (sites.length === 0) {
    return (
      <div className="ui-card px-6 py-12 text-center text-slate-400 text-sm">
        Add a site first, then run {isSeo ? 'an SEO audit' : isHtml ? 'an HTML validation' : isCss ? 'a CSS validation' : isSecurity ? 'a security audit' : isLinks ? 'a link check' : 'an accessibility audit'} against it.
      </div>
    )
  }

  const isRunning = job?.status === 'queued' || job?.status === 'running'
  // Security audits produce a single origin-level report; surface its score.
  const securityReport = isSecurity ? (pages[0]?.security ?? null) : null

  return (
    <div className="space-y-6">
      {/* Launcher */}
      <div className="ui-card p-5">
        <div className="flex flex-col gap-4">
          {/* Site + mode row */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={siteId ?? ''}
              onChange={e => setSiteId(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            >
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.domain}</option>
              ))}
            </select>

            {!isSecurity && (
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                {(['full', 'single'] as Mode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors
                      ${mode === m ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {m === 'full' ? 'Full site' : 'Single page'}
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={() => launch()}
              disabled={launching || isRunning}
              className="ml-auto px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50
                         text-white text-sm font-medium rounded-lg transition-colors"
            >
              {isRunning ? 'Audit running…' : launching ? 'Starting…' : isSeo ? 'Run SEO audit' : isHtml ? 'Run HTML check' : isCss ? 'Run CSS check' : isSecurity ? 'Run security audit' : isLinks ? 'Run link check' : 'Run audit'}
            </button>
          </div>

          {/* URL input */}
          <div>
            <input
              type="text"
              value={startUrl}
              onChange={e => setStartUrl(e.target.value)}
              placeholder={
                mode === 'single'
                  ? 'https://example.com/page-to-audit'
                  : `https://${sites.find(s => s.id === siteId)?.domain ?? 'example.com'} (defaults to site root)`
              }
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-slate-400"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              {isSecurity
                ? 'Checks the origin of this URL (TLS + response headers).'
                : mode === 'full'
                ? `Crawls up to ${maxPages} same-origin page${maxPages === 1 ? '' : 's'} starting from this URL.`
                : 'Audits exactly this one URL.'}
            </p>
          </div>

          {/* Page budget (full-site only) */}
          {mode === 'full' && !isSecurity && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="maxPages" className="text-sm text-slate-600">Max pages:</label>
              <input
                id="maxPages"
                type="number"
                min={1}
                max={5000}
                value={maxPages}
                onChange={e => setMaxPages(Math.min(Math.max(Number(e.target.value) || 1, 1), 5000))}
                className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-sm
                           focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
              <span className="text-xs text-slate-400">
                Capped by your plan; extra pages may require overage authorization.
              </span>
            </div>
          )}

          {/* Ruleset selector — accessibility only */}
          {type === 'accessibility' && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="ruleset" className="text-sm text-slate-600">Standard:</label>
              <select
                id="ruleset"
                value={ruleset}
                onChange={e => setRuleset(e.target.value as Ruleset)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white
                           focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              >
                {RULESET_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="text-xs text-slate-400">
                {ruleset === 'wcag-strict' && 'Only WCAG 2.x Level A & AA rules.'}
                {ruleset === 'default' && 'WCAG A/AA plus axe best-practice rules.'}
                {ruleset === 'wcag-aaa' && 'Adds the stricter Level AAA criteria.'}
                {ruleset === 'all' && 'All rules including experimental (may be noisy).'}
              </span>
            </div>
          )}

          {isSeo && (
            <p className="text-xs text-slate-400">
              Scores each page on titles, meta, canonicals, indexability, structured data and more, plus site-level robots.txt &amp; sitemap.xml.
            </p>
          )}

          {isHtml && (
            <p className="text-xs text-slate-400">
              Validates each page&apos;s markup against the official W3C HTML standard (Nu Html Checker) — surfaces spec errors and warnings with the exact line, column and offending snippet.
            </p>
          )}

          {isCss && (
            <p className="text-xs text-slate-400">
              Validates every stylesheet each page references against the official W3C CSS standard (CSS Validator) — reports parse errors and warnings with the source file and line.
            </p>
          )}

          {isSecurity && (
            <p className="text-xs text-slate-400">
              Site-level check of transport security and HTTP response headers (IETF/OWASP): TLS certificate &amp; protocol, HTTPS enforcement, HSTS, CSP, X-Content-Type-Options, framing, Referrer-Policy, Permissions-Policy and version disclosure.
            </p>
          )}

          {isLinks && (
            <p className="text-xs text-slate-400">
              Checks every outbound link on each page for broken URLs and bad HTTP statuses. Same-origin failures are flagged as errors; external failures as warnings (some sites block bots, so those can be false positives).
            </p>
          )}

          {launchError && <p className="text-red-600 text-xs">{launchError}</p>}

          {/* Overage confirmation — authorize extra pages for this audit only */}
          {overage && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-2.5">
                <span className="text-amber-500 text-lg leading-none mt-0.5" aria-hidden>⚠</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">This audit exceeds your plan&apos;s page limit</p>
                  <p className="text-sm text-amber-800 mt-1">
                    You requested <strong>{overage.requestedPages}</strong> pages; your plan includes{' '}
                    <strong>{overage.includedPages}</strong>. Authorize <strong>{overage.extraPages}</strong> extra
                    page{overage.extraPages === 1 ? '' : 's'} at ${overage.pricePerPage.toFixed(2)}/page ={' '}
                    <strong>${overage.extraCost.toFixed(2)}</strong> for this audit only. Your plan limit will not change.
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      onClick={() => launch(true)}
                      disabled={launching}
                      className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50
                                 text-white text-sm font-medium transition-colors"
                    >
                      {launching ? 'Starting…' : `Authorize & run · $${overage.extraCost.toFixed(2)}`}
                    </button>
                    <button
                      onClick={() => setOverage(null)}
                      disabled={launching}
                      className="px-3.5 py-1.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium
                                 hover:bg-white transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {monitor?.available && monitor.intervals.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-slate-700">⏱ Scheduled monitoring</span>
              <select
                value={monitorDays}
                onChange={e => saveMonitor(true, Number(e.target.value))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {monitor.intervals.map(d => <option key={d} value={d}>{intervalLabel(d)}</option>)}
              </select>
              <button
                onClick={() => saveMonitor(!monitorOn, monitorDays)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${monitorOn ? 'bg-primary text-white hover:bg-primary-dark' : 'border border-slate-200 text-slate-600 hover:bg-white'}`}
              >
                {monitorOn ? 'On' : 'Turn on'}
              </button>
              <span className="text-xs text-slate-500 ml-auto">
                {monitorOn
                  ? `Auto-runs ${intervalLabel(monitorDays).toLowerCase()}${monitorSchedule?.next_run_at ? ` · next ${new Date(monitorSchedule.next_run_at).toLocaleDateString()}` : ''} · alerts on regressions`
                  : 'Re-audit automatically and get emailed only when results regress.'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Active job report */}
      {job && (
        <div className="ui-card">
          <div className="p-5 border-b border-slate-100 flex flex-wrap items-center gap-3">
            <StatusBadge status={job.status} />
            {type === 'accessibility' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
                {RULESET_LABEL[job.ruleset]}
              </span>
            )}
            <span className="text-sm text-slate-600 truncate max-w-xs">{job.start_url}</span>
            <div className="ml-auto flex items-center gap-4 text-sm">
              {isSeo && job.seo_score != null && (
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">Score</span>
                  <SeoScorePill score={job.seo_score} />
                </span>
              )}
              {isSecurity && securityReport && (
                <span className="flex items-center gap-1.5">
                  <span className="text-xs text-slate-400">Score</span>
                  <SeoScorePill score={securityReport.score} />
                </span>
              )}
              {!isSecurity && (
                <span className="text-slate-500">
                  {job.pages_crawled} page{job.pages_crawled === 1 ? '' : 's'}
                  {job.mode === 'full' ? ` / ${job.max_pages} max` : ''}
                </span>
              )}
              <span className="font-semibold text-slate-900">
                {job.total_issues} {isSeo ? 'SEO issue' : isHtml || isCss ? 'error' : isSecurity ? 'failing check' : isLinks ? 'broken link' : 'issue'}{job.total_issues === 1 ? '' : 's'}
              </span>
              {canPdf && job.status === 'done' && (
                <>
                  <a
                    href={`/api/audits/${job.id}/pdf`}
                    className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors"
                  >
                    ⬇ PDF
                  </a>
                  <a
                    href={`/api/audits/${job.id}/csv`}
                    className="px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 transition-colors"
                  >
                    ⬇ CSV
                  </a>
                </>
              )}
              {isRunning && (
                <button
                  onClick={() => cancelJob(job.id)}
                  disabled={cancelling}
                  className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 text-xs font-medium
                             hover:bg-red-50 disabled:opacity-50 transition-colors"
                >
                  {cancelling ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
            </div>
          </div>

          {job.error && (
            <div className="px-5 py-3 bg-red-50 text-red-700 text-sm border-b border-red-100">
              {job.error}
            </div>
          )}

          {isSeo && job.seo_site && (
            <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
              <span className="font-medium text-slate-500 uppercase tracking-wide">Site SEO</span>
              <span className="flex items-center gap-1.5">
                {job.seo_site.robotsTxt.found ? '✅' : '⚠️'} robots.txt
                {job.seo_site.robotsTxt.found && (job.seo_site.robotsTxt.referencesSitemap
                  ? <span className="text-slate-400">(links sitemap)</span>
                  : <span className="text-slate-400">(no sitemap link)</span>)}
              </span>
              <span className="flex items-center gap-1.5">
                {job.seo_site.sitemapXml.found ? '✅' : '⚠️'} sitemap.xml
                {job.seo_site.sitemapXml.found && job.seo_site.sitemapXml.urlCount != null && (
                  <span className="text-slate-400">({job.seo_site.sitemapXml.urlCount} URLs)</span>
                )}
              </span>
            </div>
          )}

          {isA11y && pages.length > 0 && standards.length > 0 && (
            <StandardsPanel standards={standards} totalRules={totalRules} selected={stdKey} onSelect={setStdKey} />
          )}

          {pages.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-400 text-sm">
              {isRunning ? 'Scanning pages…' : 'No pages were audited.'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pages.map(page => (
                <li key={page.id}>
                  <button
                    onClick={() => setOpenPage(openPage === page.id ? null : page.id)}
                    className="w-full px-5 py-3.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-slate-400 text-xs w-4">{openPage === page.id ? '▾' : '▸'}</span>
                    <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{page.url}</span>
                    {isSeo && page.seo && <SeoScorePill score={page.seo.score} small />}
                    {page.error ? (
                      <span className="text-xs text-red-500">Failed</span>
                    ) : isSeo ? (
                      page.seo && <span className="text-xs text-slate-400 shrink-0">{page.seo.checks.filter(c => c.weight > 0 && c.status !== 'pass').length} issues</span>
                    ) : isHtml ? (
                      page.html && <HtmlCounts html={page.html} />
                    ) : isCss ? (
                      page.css && <CssCounts css={page.css} />
                    ) : isSecurity ? (
                      page.security && <SecurityCounts security={page.security} />
                    ) : isLinks ? (
                      page.links && <LinksCounts links={page.links} />
                    ) : (
                      <ImpactCounts page={page} />
                    )}
                  </button>

                  {openPage === page.id && (
                    <div className="px-5 pb-4 pl-12 space-y-4">
                      {isSeo ? (
                        page.error ? (
                          <p className="text-sm text-red-600">{page.error}</p>
                        ) : page.seo ? (
                          <SeoPanel seo={page.seo} />
                        ) : (
                          <p className="text-sm text-slate-400">No SEO data for this page.</p>
                        )
                      ) : isHtml ? (
                        page.error ? (
                          <p className="text-sm text-red-600">{page.error}</p>
                        ) : page.html ? (
                          <HtmlPanel html={page.html} />
                        ) : (
                          <p className="text-sm text-slate-400">No HTML validation data for this page.</p>
                        )
                      ) : isCss ? (
                        page.error ? (
                          <p className="text-sm text-red-600">{page.error}</p>
                        ) : page.css ? (
                          <CssPanel css={page.css} />
                        ) : (
                          <p className="text-sm text-slate-400">No CSS validation data for this page.</p>
                        )
                      ) : isSecurity ? (
                        page.error ? (
                          <p className="text-sm text-red-600">{page.error}</p>
                        ) : page.security ? (
                          <SecurityPanel security={page.security} />
                        ) : (
                          <p className="text-sm text-slate-400">No security data.</p>
                        )
                      ) : isLinks ? (
                        page.error ? (
                          <p className="text-sm text-red-600">{page.error}</p>
                        ) : page.links ? (
                          <LinksPanel links={page.links} />
                        ) : (
                          <p className="text-sm text-slate-400">No link data for this page.</p>
                        )
                      ) : page.error ? (
                        <p className="text-sm text-red-600">{page.error}</p>
                      ) : !page.results || page.results.length === 0 || (activeStd != null && page.results.filter(v => violationInScope(v.tags, activeStd)).length === 0) ? (
                        <p className="text-sm text-green-600">{activeStd && page.results && page.results.length > 0 ? `No ${activeStd.short} issues on this page. 🎉` : 'No accessibility violations found on this page. 🎉'}</p>
                      ) : (
                        <ul className="space-y-2">
                          {(activeStd ? page.results.filter(v => violationInScope(v.tags, activeStd)) : page.results).map(v => {
                            const key = `${page.id}:${v.id}`
                            const wcag = parseWcag(v.tags)
                            return (
                              <li key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                                <button
                                  onClick={() => setOpenViolation(openViolation === key ? null : key)}
                                  className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-slate-50"
                                >
                                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium capitalize
                                    ${IMPACT_STYLES[v.impact ?? 'minor']}`}>
                                    {v.impact ?? 'minor'}
                                  </span>
                                  <span className="text-sm text-slate-700 flex-1 min-w-0 truncate">{v.help}</span>
                                  {wcag.level && (
                                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium flex-shrink-0">
                                      {wcag.level}
                                    </span>
                                  )}
                                  <code className="text-[11px] text-slate-400 flex-shrink-0">{v.id}</code>
                                </button>

                                {openViolation === key && (
                                  <div className="px-3 pb-3 space-y-2 border-t border-slate-100 pt-2">
                                    <p className="text-xs text-slate-600">{v.description}</p>
                                    {(wcag.level || wcag.criteria.length > 0) && (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {wcag.level && (
                                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-900 text-white font-medium">
                                            Level {wcag.level}
                                          </span>
                                        )}
                                        {wcag.criteria.map(c => (
                                          <span key={c} className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                                            WCAG {c}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    <a
                                      href={v.helpUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary hover:underline inline-block"
                                    >
                                      Learn how to fix this ↗
                                    </a>
                                    <div className="space-y-1.5">
                                      {v.nodes.slice(0, 5).map((n, i) => (
                                        <pre
                                          key={i}
                                          className="bg-slate-900 text-slate-100 text-[11px] rounded-md p-2.5 overflow-x-auto"
                                        >
                                          {n.html}
                                        </pre>
                                      ))}
                                      {v.nodes.length > 5 && (
                                        <p className="text-xs text-slate-400">
                                          + {v.nodes.length - 5} more element{v.nodes.length - 5 === 1 ? '' : 's'}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* History */}
      <div className="ui-card">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Audit history</h2>
        </div>
        {jobs.length === 0 ? (
          <div className="px-6 py-8 text-center text-slate-400 text-sm">No audits yet.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-5 py-2.5 font-medium">When</th>
                <th className="px-5 py-2.5 font-medium">Mode</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5 font-medium">Pages</th>
                {(isSeo || isSecurity) && <th className="px-5 py-2.5 font-medium">Score</th>}
                <th className="px-5 py-2.5 font-medium">Issues</th>
                <th className="px-5 py-2.5 font-medium">Duration</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.map(j => (
                <tr
                  key={j.id}
                  onClick={() => openJob(j.id)}
                  aria-selected={j.id === activeJobId}
                  className={`text-slate-700 cursor-pointer transition-colors ${j.id === activeJobId ? 'bg-primary/5' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-5 py-2.5 whitespace-nowrap text-slate-500">
                    {new Date(j.created_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">
                      {j.mode === 'full' ? 'Full site' : 'Single'}
                    </span>
                    {type === 'accessibility' && <span className="block text-[11px] text-slate-400 mt-0.5">{RULESET_LABEL[j.ruleset]}</span>}
                  </td>
                  <td className="px-5 py-2.5"><StatusBadge status={j.status} /></td>
                  <td className="px-5 py-2.5">{j.pages_crawled}</td>
                  {(isSeo || isSecurity) && <td className="px-5 py-2.5">{j.seo_score != null ? <SeoScorePill score={j.seo_score} small /> : '—'}</td>}
                  <td className="px-5 py-2.5 font-medium">{j.total_issues}</td>
                  <td className="px-5 py-2.5 text-slate-500">{duration(j)}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    {canPdf && j.status === 'done' && (
                      <>
                        <a href={`/api/audits/${j.id}/pdf`} onClick={e => e.stopPropagation()} className="text-xs text-slate-500 hover:underline mr-3">PDF</a>
                        <a href={`/api/audits/${j.id}/csv`} onClick={e => e.stopPropagation()} className="text-xs text-slate-500 hover:underline mr-3">CSV</a>
                      </>
                    )}
                    <span className="text-xs text-primary hover:underline">
                      {j.id === activeJobId ? 'Viewing' : 'View'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: Job['status'] }) {
  const styles: Record<Job['status'], string> = {
    queued: 'bg-slate-100 text-slate-600',
    running: 'bg-blue-50 text-blue-700',
    done: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-700',
    cancelled: 'bg-amber-50 text-amber-700',
  }
  const labels: Record<Job['status'], string> = {
    queued: 'Queued',
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
      {status === 'running' && <span className="inline-block animate-pulse mr-1">●</span>}
      {labels[status]}
    </span>
  )
}

function scoreTone(score: number) {
  return score >= 90 ? 'bg-green-50 text-green-700 border-green-200'
    : score >= 70 ? 'bg-amber-50 text-amber-700 border-amber-200'
      : 'bg-red-50 text-red-700 border-red-200'
}

function SeoScorePill({ score, small }: { score: number; small?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-full border font-semibold ${scoreTone(score)} ${small ? 'text-[11px] px-2 py-0.5' : 'text-sm px-2.5 py-0.5'}`}>
      {score}
    </span>
  )
}

const SEO_STATUS_STYLE: Record<'pass' | 'warn' | 'fail', string> = {
  pass: 'text-green-600',
  warn: 'text-amber-600',
  fail: 'text-red-600',
}
const SEO_STATUS_ICON: Record<'pass' | 'warn' | 'fail', string> = { pass: '✅', warn: '⚠️', fail: '❌' }

function SeoPanel({ seo }: { seo: SeoResult }) {
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
        <SeoScorePill score={seo.score} small />
        <span className="text-sm font-semibold text-slate-800">Technical SEO</span>
        <span className="text-xs text-slate-400 ml-auto">
          {seo.meta.indexable ? 'Indexable' : 'Noindex'} · ~{seo.meta.wordCount} words
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {seo.checks.map(c => (
          <li key={c.id} className="flex items-start gap-2.5 px-3 py-2">
            <span className="text-sm leading-5" aria-hidden>{SEO_STATUS_ICON[c.status]}</span>
            <span className="text-sm text-slate-700 w-40 shrink-0">{c.label}</span>
            <span className={`text-sm ${SEO_STATUS_STYLE[c.status]}`}>{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function HtmlCounts({ html }: { html: HtmlResult }) {
  if (html.validatorError) {
    return <span className="text-xs text-red-500 shrink-0">Checker error</span>
  }
  if (html.errors === 0 && html.warnings === 0) {
    return <span className="text-xs text-green-600 font-medium shrink-0">Valid</span>
  }
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      {html.errors > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-red-50 text-red-700 border-red-200">
          {html.errors} error{html.errors === 1 ? '' : 's'}
        </span>
      )}
      {html.warnings > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-amber-50 text-amber-700 border-amber-200">
          {html.warnings} warning{html.warnings === 1 ? '' : 's'}
        </span>
      )}
    </span>
  )
}

const HTML_SEV_STYLE: Record<HtmlSeverity, string> = {
  error: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  info: 'bg-slate-100 text-slate-600 border-slate-200',
}
const HTML_SEV_LABEL: Record<HtmlSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Info' }

function HtmlPanel({ html }: { html: HtmlResult }) {
  if (html.validatorError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
        {html.validatorError}
      </div>
    )
  }
  if (html.messages.length === 0) {
    return <p className="text-sm text-green-600">Valid HTML — no errors or warnings from the W3C checker. 🎉</p>
  }
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-800">W3C HTML validation</span>
        <span className="text-red-600 font-medium">{html.errors} error{html.errors === 1 ? '' : 's'}</span>
        <span className="text-amber-600 font-medium">{html.warnings} warning{html.warnings === 1 ? '' : 's'}</span>
        {html.info > 0 && <span className="text-slate-500">{html.info} info</span>}
      </div>
      <ul className="divide-y divide-slate-100">
        {html.messages.map((m, i) => (
          <li key={i} className="px-3 py-2.5 space-y-1.5">
            <div className="flex items-start gap-2.5">
              <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${HTML_SEV_STYLE[m.severity]}`}>
                {m.fatal ? 'Fatal' : HTML_SEV_LABEL[m.severity]}
              </span>
              <span className="text-sm text-slate-700 flex-1 min-w-0">{m.message}</span>
              {m.line != null && (
                <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">
                  L{m.line}{m.column != null ? `:${m.column}` : ''}
                </span>
              )}
            </div>
            {m.extract && (
              <pre className="bg-slate-900 text-slate-100 text-[11px] rounded-md p-2.5 overflow-x-auto">{m.extract}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CssCounts({ css }: { css: CssResult }) {
  if (css.validatorError) return <span className="text-xs text-red-500 shrink-0">Validator error</span>
  if (css.errors === 0 && css.warnings === 0) return <span className="text-xs text-green-600 font-medium shrink-0">Valid</span>
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      {css.errors > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-red-50 text-red-700 border-red-200">
          {css.errors} error{css.errors === 1 ? '' : 's'}
        </span>
      )}
      {css.warnings > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-amber-50 text-amber-700 border-amber-200">
          {css.warnings} warning{css.warnings === 1 ? '' : 's'}
        </span>
      )}
    </span>
  )
}

function CssPanel({ css }: { css: CssResult }) {
  if (css.validatorError) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{css.validatorError}</div>
  }
  if (css.messages.length === 0) {
    return <p className="text-sm text-green-600">Valid CSS — no errors or warnings from the W3C validator. 🎉</p>
  }
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-800">W3C CSS validation</span>
        <span className="text-red-600 font-medium">{css.errors} error{css.errors === 1 ? '' : 's'}</span>
        <span className="text-amber-600 font-medium">{css.warnings} warning{css.warnings === 1 ? '' : 's'}</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {css.messages.map((m, i) => (
          <li key={i} className="px-3 py-2.5 space-y-1">
            <div className="flex items-start gap-2.5">
              <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${m.severity === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                {m.severity === 'error' ? 'Error' : 'Warning'}
              </span>
              <span className="text-sm text-slate-700 flex-1 min-w-0">{m.message}</span>
              {m.line != null && <span className="text-[11px] text-slate-400 shrink-0 whitespace-nowrap">L{m.line}</span>}
            </div>
            {(m.context || m.source) && (
              <p className="text-[11px] text-slate-400 truncate">{m.context || m.source}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SecurityCounts({ security }: { security: SecurityResult }) {
  const fails = security.checks.filter(c => c.weight > 0 && c.status === 'fail').length
  const warns = security.checks.filter(c => c.weight > 0 && c.status === 'warn').length
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      <SeoScorePill score={security.score} small />
      {fails > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-red-50 text-red-700 border-red-200">{fails} fail</span>}
      {warns > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-amber-50 text-amber-700 border-amber-200">{warns} warn</span>}
      {fails === 0 && warns === 0 && <span className="text-xs text-green-600 font-medium">Hardened</span>}
    </span>
  )
}

function SecurityPanel({ security }: { security: SecurityResult }) {
  const tls = security.meta.tls
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2">
        <SeoScorePill score={security.score} small />
        <span className="text-sm font-semibold text-slate-800">Security &amp; headers</span>
        <span className="text-xs text-slate-400 ml-auto">
          {security.meta.https ? 'HTTPS' : 'HTTP'}
          {tls?.protocol ? ` · ${tls.protocol}` : ''}
          {tls?.daysToExpiry != null ? ` · cert ${tls.daysToExpiry}d` : ''}
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {security.checks.map(c => (
          <li key={c.id} className="flex items-start gap-2.5 px-3 py-2">
            <span className="text-sm leading-5" aria-hidden>{SEO_STATUS_ICON[c.status === 'fail' ? 'fail' : c.status === 'warn' ? 'warn' : 'pass']}</span>
            <span className="text-sm text-slate-700 w-44 shrink-0">{c.label}</span>
            <span className={`text-sm ${SEO_STATUS_STYLE[c.status === 'fail' ? 'fail' : c.status === 'warn' ? 'warn' : 'pass']}`}>{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StandardsPanel({ standards, totalRules, selected, onSelect }: { standards: StandardSummary[]; totalRules: number; selected: string; onSelect: (k: string) => void }) {
  const isAll = selected === 'all'
  const sel = isAll ? null : (standards.find(s => s.key === selected) ?? null)
  // Group options by region for the selector.
  const regions = Array.from(new Set(STANDARDS.map(s => s.region)))

  return (
    <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Compliance by standard</span>
        <select
          value={selected}
          onChange={e => onSelect(e.target.value)}
          className="ml-auto px-3 py-1.5 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="all">All standards (no filter)</option>
          {regions.map(r => (
            <optgroup key={r} label={r}>
              {STANDARDS.filter(s => s.region === r).map(s => (
                <option key={s.key} value={s.key}>{s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {isAll ? (
        <div className={`rounded-xl border p-4 mb-3 ${totalRules === 0 ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl leading-none" aria-hidden>{totalRules === 0 ? '✅' : '📋'}</span>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${totalRules === 0 ? 'text-green-800' : 'text-amber-900'}`}>
                {totalRules === 0 ? 'No accessibility issues found' : `Showing all findings · ${totalRules} rule${totalRules === 1 ? '' : 's'} failing`}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">Pick a standard below to filter the findings to that law&apos;s requirements.</p>
            </div>
          </div>
        </div>
      ) : sel && (
        <div className={`rounded-xl border p-4 mb-3 ${sel.compliant ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl leading-none" aria-hidden>{sel.compliant ? '✅' : '⚠️'}</span>
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${sel.compliant ? 'text-green-800' : 'text-red-800'}`}>
                {sel.compliant
                  ? `No automated ${sel.name} failures found`
                  : `${sel.failingRules} rule${sel.failingRules === 1 ? '' : 's'} failing ${sel.name} — findings filtered below`}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">{sel.note} · {sel.region} · WCAG {sel.version} AA</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        <button
          onClick={() => onSelect('all')}
          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors
            ${isAll ? 'border-primary ring-1 ring-primary/30 bg-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
        >
          <span className="text-xs font-medium text-slate-700 truncate">All</span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${totalRules === 0 ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-700'}`}>
            {totalRules === 0 ? '✓' : totalRules}
          </span>
        </button>
        {standards.map(s => (
          <button
            key={s.key}
            onClick={() => onSelect(s.key)}
            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left transition-colors
              ${s.key === sel?.key ? 'border-primary ring-1 ring-primary/30 bg-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
          >
            <span className="text-xs font-medium text-slate-700 truncate">{s.short}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${s.compliant ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {s.compliant ? '✓' : s.failingRules}
            </span>
          </button>
        ))}
      </div>

      <p className="text-[11px] text-slate-400 mt-3">
        Based on automated WCAG checks (the machine-testable subset). A clean result is not a legal conformance guarantee — some criteria require manual review.
      </p>
    </div>
  )
}

function LinksCounts({ links }: { links: LinkCheckResult }) {
  if (links.brokenInternal === 0 && links.brokenExternal === 0) {
    return <span className="text-xs text-green-600 font-medium shrink-0">{links.checked} links OK</span>
  }
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      {links.brokenInternal > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-red-50 text-red-700 border-red-200">
          {links.brokenInternal} broken
        </span>
      )}
      {links.brokenExternal > 0 && (
        <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium bg-amber-50 text-amber-700 border-amber-200">
          {links.brokenExternal} external
        </span>
      )}
    </span>
  )
}

function LinksPanel({ links }: { links: LinkCheckResult }) {
  if (links.links.length === 0) {
    return <p className="text-sm text-green-600">All {links.checked} links responded OK. 🎉</p>
  }
  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-800">Link check</span>
        <span className="text-red-600 font-medium">{links.brokenInternal} broken (same-site)</span>
        <span className="text-amber-600 font-medium">{links.brokenExternal} external</span>
        <span className="text-slate-400 ml-auto">{links.checked} of {links.total} checked</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {links.links.map((l, i) => (
          <li key={i} className="px-3 py-2.5 space-y-1">
            <div className="flex items-start gap-2.5">
              <span className={`text-[11px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${l.kind === 'internal' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                {l.status ?? 'ERR'}
              </span>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex-1 min-w-0 break-all">{l.url}</a>
              <span className="text-[11px] text-slate-400 shrink-0 capitalize">{l.kind}</span>
            </div>
            <p className="text-[11px] text-slate-500 pl-1">{l.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImpactCounts({ page }: { page: PageRow }) {
  if (page.violations === 0) {
    return <span className="text-xs text-green-600 font-medium">Clean</span>
  }
  const parts: Array<[string, number]> = [
    ['critical', page.critical],
    ['serious', page.serious],
    ['moderate', page.moderate],
    ['minor', page.minor],
  ]
  return (
    <span className="flex items-center gap-1.5 flex-shrink-0">
      {parts.map(([impact, count]) =>
        count > 0 ? (
          <span
            key={impact}
            className={`text-[11px] px-1.5 py-0.5 rounded border font-medium capitalize ${IMPACT_STYLES[impact]}`}
          >
            {count} {impact}
          </span>
        ) : null
      )}
    </span>
  )
}
