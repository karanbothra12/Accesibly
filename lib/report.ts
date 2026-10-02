// Builds a self-contained, print-optimized HTML report for an audit job.
// Rendered to PDF by Chromium in the /api/audits/[id]/pdf route (feature-gated).

import { summarizeStandards } from '@/lib/standards'

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export type ReportType = 'accessibility' | 'seo' | 'html' | 'css' | 'links' | 'security'

export type ReportJob = {
  id: number; domain: string; start_url: string; job_type: ReportType
  status: string; pages_crawled: number; total_issues: number
  seo_score: number | null; ruleset: string; created_at: string; finished_at: string | null
  seo_site: { robotsTxt?: { found: boolean; referencesSitemap: boolean }; sitemapXml?: { found: boolean; urlCount: number | null } } | null
}

type HtmlMsg = { severity: string; message: string; line: number | null }
type CssMsg = { severity: string; message: string; line: number | null; source: string | null }
type BrokenLink = { url: string; status: number | null; kind: string; reason: string }
type SecCheck = { label: string; status: string; detail: string; weight: number }

export type ReportPage = {
  url: string; status_code: number; issue_count: number
  violations: Array<{ id?: string; impact?: string | null; help?: string; description?: string; tags?: string[] }> | null
  seo: { score: number; checks: Array<{ label: string; status: string; detail: string; weight: number }> } | null
  html?: { errors: number; warnings: number; info: number; messages: HtmlMsg[] } | null
  css?: { errors: number; warnings: number; messages: CssMsg[] } | null
  links?: { total: number; checked: number; brokenInternal: number; brokenExternal: number; links: BrokenLink[] } | null
  security?: { score: number; checks: SecCheck[] } | null
}

const REPORT_TITLE: Record<ReportType, string> = {
  accessibility: 'Accessibility Audit Report',
  seo: 'Technical SEO Report',
  html: 'HTML Validation Report',
  css: 'CSS Validation Report',
  links: 'Broken Link Report',
  security: 'Security & Headers Report',
}

// severity/status → CSS tag class in the report stylesheet.
const TAG: Record<string, string> = {
  error: 'fail', warning: 'warn', info: 'minor',
  internal: 'fail', external: 'warn',
  pass: 'pass', warn: 'warn', fail: 'fail',
}

function scoreColor(score: number): string {
  return score >= 90 ? '#16a34a' : score >= 70 ? '#d97706' : '#dc2626'
}

export type CompetitorScorecard = {
  url: string; ok: boolean; statusCode: number | null; error: string | null
  a11yIssues: number; critical: number; serious: number; moderate: number; minor: number
  seoScore: number | null; seoIssues: number | null
}
export type CompetitorReport = {
  your_url: string; competitor_url: string; created_at: string
  result: { you: CompetitorScorecard; competitor: CompetitorScorecard }
}

export function buildCompetitorHtml(rep: CompetitorReport): string {
  const when = new Date(rep.created_at).toLocaleString()
  const col = (title: string, c: CompetitorScorecard) => `
    <div class="ccard">
      <div class="ctitle">${esc(title)}</div>
      <div class="curl">${esc(c.url)}</div>
      ${c.error ? `<p style="color:#dc2626">Couldn't audit: ${esc(c.error)}</p>` : `
        <div class="cgrid">
          <div><div class="big" style="color:${c.seoScore == null ? '#94a3b8' : scoreColor(c.seoScore)}">${c.seoScore ?? '—'}</div><div class="lbl">SEO score</div></div>
          <div><div class="big">${c.a11yIssues}</div><div class="lbl">A11y issues</div></div>
        </div>
        <p class="muted">${c.critical} critical · ${c.serious} serious · ${c.moderate} moderate · ${c.minor} minor</p>`}
    </div>`

  const you = rep.result.you, comp = rep.result.competitor
  const seoWin = (you.seoScore ?? -1) - (comp.seoScore ?? -1)
  const a11yWin = comp.a11yIssues - you.a11yIssues
  const verdict = (you.ok && comp.ok)
    ? `${seoWin === 0 ? 'SEO scores are tied.' : seoWin > 0 ? `You lead on SEO by ${seoWin} points.` : `Competitor leads on SEO by ${-seoWin} points.`} ${a11yWin === 0 ? 'Accessibility issues are even.' : a11yWin > 0 ? `You have ${a11yWin} fewer accessibility issues.` : `Competitor has ${-a11yWin} fewer accessibility issues.`}`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing:border-box; } body { font:13px/1.5 -apple-system,system-ui,sans-serif; color:#0f172a; margin:0; padding:32px; }
    .head { display:flex; justify-content:space-between; border-bottom:2px solid #C9A227; padding-bottom:14px; margin-bottom:20px; }
    .brand { font-weight:700; color:#C9A227; } h1 { font-size:22px; margin:2px 0; }
    .muted { color:#64748b; font-size:12px; }
    .cols { display:flex; gap:16px; margin-top:8px; }
    .ccard { flex:1; border:1px solid #e2e8f0; border-radius:12px; padding:16px; }
    .ctitle { font-weight:700; font-size:15px; } .curl { color:#64748b; font-size:12px; word-break:break-all; margin-bottom:8px; }
    .cgrid { display:flex; gap:24px; margin:6px 0; }
    .big { font-size:30px; font-weight:700; } .lbl { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; }
    .verdict { margin-top:18px; padding:14px; background:#faf7ec; border:1px solid #ecdca0; border-radius:10px; font-size:14px; }
    .foot { margin-top:24px; color:#94a3b8; font-size:11px; text-align:center; }
  </style></head><body>
    <div class="head">
      <div><div class="brand">Accessly</div><h1>Competitor Analysis</h1><p class="muted">${esc(rep.your_url)} vs ${esc(rep.competitor_url)}</p></div>
      <div class="muted" style="text-align:right">${when}</div>
    </div>
    <div class="cols">${col('Your site', you)}${col('Competitor', comp)}</div>
    ${verdict ? `<div class="verdict">${esc(verdict)}</div>` : ''}
    <div class="foot">Generated by Accessly · ${when}</div>
  </body></html>`
}

function card(value: string | number, label: string, color?: string): string {
  return `<div class="card"><div class="big"${color ? ` style="color:${color}"` : ''}>${esc(value)}</div><div class="lbl">${esc(label)}</div></div>`
}

function summaryFor(job: ReportJob, pages: ReportPage[]): string {
  switch (job.job_type) {
    case 'seo':
      return card(job.seo_score ?? '—', 'Avg SEO score', scoreColor(job.seo_score ?? 0)) + card(job.pages_crawled, 'Pages') + card(job.total_issues, 'SEO issues')
    case 'html': {
      const warns = pages.reduce((n, p) => n + (p.html?.warnings ?? 0), 0)
      return card(job.pages_crawled, 'Pages') + card(job.total_issues, 'Errors') + card(warns, 'Warnings')
    }
    case 'css': {
      const warns = pages.reduce((n, p) => n + (p.css?.warnings ?? 0), 0)
      return card(job.pages_crawled, 'Pages') + card(job.total_issues, 'Errors') + card(warns, 'Warnings')
    }
    case 'links': {
      const ext = pages.reduce((n, p) => n + (p.links?.brokenExternal ?? 0), 0)
      return card(job.pages_crawled, 'Pages') + card(job.total_issues, 'Broken (same-site)') + card(ext, 'External warnings')
    }
    case 'security': {
      const s = pages[0]?.security?.score ?? job.seo_score ?? 0
      return card(s, 'Score', scoreColor(s)) + card(job.total_issues, 'Failing checks') + card(pages[0]?.security ? (pages[0].security.checks.filter(c => c.weight > 0 && c.status === 'warn').length) : 0, 'Warnings')
    }
    default:
      return card(job.pages_crawled, 'Pages') + card(job.total_issues, 'Total issues') + `<div class="card"><div class="lbl2">${esc(job.ruleset)}</div><div class="lbl">Standard</div></div>`
  }
}

function pageBlock(head: string, rows: string, emptyMsg: string, badge = ''): string {
  return `<div class="page"><div class="pageHead"><span class="url">${esc(head)}</span>${badge}</div>${rows ? `<ul>${rows}</ul>` : `<p class="ok">${esc(emptyMsg)}</p>`}</div>`
}

function pagesFor(job: ReportJob, pages: ReportPage[]): string {
  switch (job.job_type) {
    case 'seo':
      return pages.map(p => {
        const rows = (p.seo?.checks || []).filter(c => c.weight > 0 && c.status !== 'pass')
          .map(c => `<li><span class="tag ${TAG[c.status] || 'minor'}">${esc(c.status)}</span> <b>${esc(c.label)}</b> — ${esc(c.detail)}</li>`).join('')
        return pageBlock(p.url, rows, 'No SEO issues on this page.', p.seo ? `<span class="pill" style="background:${scoreColor(p.seo.score)}">${p.seo.score}</span>` : '')
      }).join('')
    case 'html':
      return pages.map(p => {
        const rows = (p.html?.messages || []).slice(0, 40)
          .map(m => `<li><span class="tag ${TAG[m.severity] || 'minor'}">${esc(m.severity)}</span> ${m.line != null ? `<span class="count">L${m.line}</span> ` : ''}${esc(m.message)}</li>`).join('')
        return pageBlock(p.url, rows, 'Valid — no HTML issues.', `<span class="count">${p.html?.errors ?? 0} err · ${p.html?.warnings ?? 0} warn</span>`)
      }).join('')
    case 'css':
      return pages.map(p => {
        const rows = (p.css?.messages || []).slice(0, 40)
          .map(m => `<li><span class="tag ${TAG[m.severity] || 'minor'}">${esc(m.severity)}</span> ${m.line != null ? `<span class="count">L${m.line}</span> ` : ''}${esc(m.message)}${m.source ? ` <span class="muted">(${esc(m.source)})</span>` : ''}</li>`).join('')
        return pageBlock(p.url, rows, 'Valid — no CSS issues.', `<span class="count">${p.css?.errors ?? 0} err · ${p.css?.warnings ?? 0} warn</span>`)
      }).join('')
    case 'links':
      return pages.map(p => {
        const rows = (p.links?.links || []).map(l => `<li><span class="tag ${TAG[l.kind] || 'minor'}">${esc(l.status ?? 'ERR')}</span> <b>${esc(l.url)}</b> — ${esc(l.reason)}</li>`).join('')
        return pageBlock(p.url, rows, 'All links OK.', `<span class="count">${(p.links?.brokenInternal ?? 0) + (p.links?.brokenExternal ?? 0)} broken</span>`)
      }).join('')
    case 'security': {
      const sec = pages[0]?.security
      if (!sec) return '<p class="muted">No security data.</p>'
      const rows = sec.checks.map(c => `<li><span class="tag ${TAG[c.status] || 'minor'}">${esc(c.status)}</span> <b>${esc(c.label)}</b> — ${esc(c.detail)}</li>`).join('')
      return pageBlock(pages[0].url, rows, 'No checks.', `<span class="pill" style="background:${scoreColor(sec.score)}">${sec.score}</span>`)
    }
    default:
      return pages.map(p => {
        const rows = (p.violations || []).slice(0, 20).map(v => `<li><span class="tag ${esc(v.impact || 'minor')}">${esc(v.impact || 'minor')}</span> <b>${esc(v.help || v.id)}</b></li>`).join('')
        return pageBlock(p.url, rows, 'No violations on this page.', `<span class="count">${p.issue_count} issues</span>`)
      }).join('')
  }
}

export function buildReportHtml(job: ReportJob, pages: ReportPage[]): string {
  const when = new Date(job.created_at).toLocaleString()
  const title = REPORT_TITLE[job.job_type] || REPORT_TITLE.accessibility
  const summaryCards = summaryFor(job, pages)

  const siteSeo = job.job_type === 'seo' && job.seo_site
    ? `<p class="muted">robots.txt: <b>${job.seo_site.robotsTxt?.found ? 'found' : 'missing'}</b>${job.seo_site.robotsTxt?.found ? (job.seo_site.robotsTxt?.referencesSitemap ? ' (links sitemap)' : ' (no sitemap link)') : ''} · sitemap.xml: <b>${job.seo_site.sitemapXml?.found ? 'found' : 'missing'}</b>${job.seo_site.sitemapXml?.found && job.seo_site.sitemapXml?.urlCount != null ? ` (${job.seo_site.sitemapXml.urlCount} URLs)` : ''}</p>`
    : ''

  const pagesHtml = pagesFor(job, pages)

  // Accessibility jobs get a legislation/standards compliance summary.
  let standardsHtml = ''
  if (job.job_type === 'accessibility') {
    const vios = pages.flatMap(p => p.violations || [])
    const summary = summarizeStandards(vios)
    const rows = summary.map(s => `<tr>
      <td>${esc(s.name)}</td><td class="muted">${esc(s.region)}</td><td>WCAG ${esc(s.version)} AA</td>
      <td style="text-align:right"><span class="tag ${s.compliant ? 'pass' : 'fail'}">${s.compliant ? 'No failures' : `${s.failingRules} failing`}</span></td>
    </tr>`).join('')
    standardsHtml = `
      <h2 style="font-size:15px;margin:18px 0 4px">Compliance by standard</h2>
      <table class="std"><thead><tr><th>Standard</th><th>Region</th><th>Basis</th><th style="text-align:right">Automated result</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted" style="margin-top:6px">Based on automated WCAG checks (the machine-testable subset) — not a legal conformance guarantee; some criteria require manual review.</p>`
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font: 13px/1.5 -apple-system, system-ui, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #C9A227; padding-bottom:14px; margin-bottom:20px; }
    .brand { font-weight:700; color:#C9A227; letter-spacing:.02em; }
    h1 { font-size:22px; margin:2px 0 2px; }
    .muted { color:#64748b; font-size:12px; margin:2px 0; }
    .cards { display:flex; gap:12px; margin:16px 0 8px; }
    .card { flex:1; border:1px solid #e2e8f0; border-radius:12px; padding:14px; text-align:center; }
    .big { font-size:26px; font-weight:700; }
    .lbl2 { font-size:14px; font-weight:600; }
    .lbl { font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }
    .page { border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; margin:10px 0; page-break-inside:avoid; }
    .pageHead { display:flex; justify-content:space-between; align-items:center; gap:10px; }
    .url { font-family:ui-monospace,monospace; font-size:12px; color:#334155; word-break:break-all; }
    .count { color:#334155; font-weight:600; font-size:12px; white-space:nowrap; }
    .pill { color:#fff; font-weight:700; border-radius:999px; padding:2px 9px; font-size:12px; }
    ul { margin:8px 0 0; padding-left:0; list-style:none; }
    li { padding:3px 0; font-size:12px; }
    .tag { display:inline-block; min-width:56px; text-align:center; border-radius:999px; padding:1px 7px; font-size:10px; font-weight:600; text-transform:capitalize; color:#fff; margin-right:6px; }
    .tag.critical,.tag.fail { background:#dc2626; } .tag.serious { background:#ea580c; }
    .tag.moderate,.tag.warn { background:#d97706; } .tag.minor { background:#64748b; } .tag.pass { background:#16a34a; }
    .ok { color:#16a34a; font-size:12px; margin:6px 0 0; }
    .std { width:100%; border-collapse:collapse; margin-top:6px; font-size:12px; }
    .std th { text-align:left; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.05em; border-bottom:1px solid #e2e8f0; padding:6px 8px; }
    .std td { padding:6px 8px; border-bottom:1px solid #f1f5f9; }
    .foot { margin-top:24px; color:#94a3b8; font-size:11px; text-align:center; }
  </style></head><body>
    <div class="head">
      <div><div class="brand">Accessly</div><h1>${title}</h1><p class="muted">${esc(job.domain)} · ${esc(job.start_url)}</p></div>
      <div class="muted" style="text-align:right">${when}<br>Report #${job.id}</div>
    </div>
    <div class="cards">${summaryCards}</div>
    ${siteSeo}
    ${standardsHtml}
    <h2 style="font-size:15px;margin:18px 0 4px">Pages</h2>
    ${pagesHtml || '<p class="muted">No pages were audited.</p>'}
    <div class="foot">Generated by Accessly · ${when}</div>
  </body></html>`
}

// ── CSV export ────────────────────────────────────────────────────
const csvCell = (v: unknown): string => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const csvRows = (header: string[], rows: (string | number | null)[][]): string =>
  [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')

// Build a findings CSV for an audit job, with columns appropriate to its type.
export function buildReportCsv(job: ReportJob, pages: ReportPage[]): string {
  switch (job.job_type) {
    case 'seo': {
      const rows: (string | number | null)[][] = []
      for (const p of pages) for (const c of (p.seo?.checks || [])) {
        if (c.weight > 0 && c.status !== 'pass') rows.push([p.url, c.status, c.label, c.detail])
      }
      return csvRows(['Page URL', 'Status', 'Check', 'Detail'], rows)
    }
    case 'html': {
      const rows: (string | number | null)[][] = []
      for (const p of pages) for (const m of (p.html?.messages || [])) rows.push([p.url, m.severity, m.line ?? '', m.message])
      return csvRows(['Page URL', 'Severity', 'Line', 'Message'], rows)
    }
    case 'css': {
      const rows: (string | number | null)[][] = []
      for (const p of pages) for (const m of (p.css?.messages || [])) rows.push([p.url, m.severity, m.line ?? '', m.source ?? '', m.message])
      return csvRows(['Page URL', 'Severity', 'Line', 'Source', 'Message'], rows)
    }
    case 'links': {
      const rows: (string | number | null)[][] = []
      for (const p of pages) for (const l of (p.links?.links || [])) rows.push([p.url, l.url, l.status ?? 'ERR', l.kind, l.reason])
      return csvRows(['Page URL', 'Broken Link', 'Status', 'Kind', 'Reason'], rows)
    }
    case 'security': {
      const sec = pages[0]?.security
      const rows = (sec?.checks || []).map(c => [pages[0]?.url ?? job.start_url, c.label, c.status, c.detail])
      return csvRows(['URL', 'Check', 'Status', 'Detail'], rows)
    }
    default: {
      const rows: (string | number | null)[][] = []
      for (const p of pages) for (const v of (p.violations || [])) rows.push([p.url, v.impact || 'minor', v.id ?? '', v.help ?? v.description ?? ''])
      return csvRows(['Page URL', 'Impact', 'Rule', 'Help'], rows)
    }
  }
}

// Download filename like "html_audit_2026-09-21" (no extension).
export function reportBaseName(job: ReportJob): string {
  const d = new Date(job.created_at)
  const date = isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
  return `${job.job_type}_audit_${date}`
}
