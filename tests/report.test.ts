import { describe, it, expect } from 'vitest'
import { buildReportCsv, buildReportHtml, reportBaseName, type ReportJob, type ReportPage } from '@/lib/report'

function job(over: Partial<ReportJob> = {}): ReportJob {
  return {
    id: 7, domain: 'example.com', start_url: 'https://example.com', job_type: 'accessibility',
    status: 'done', pages_crawled: 1, total_issues: 1, seo_score: null, ruleset: 'default',
    created_at: '2026-09-21T10:00:00.000Z', finished_at: '2026-09-21T10:00:05.000Z', seo_site: null,
    ...over,
  }
}

describe('reportBaseName', () => {
  it('is <type>_audit_<date>', () => {
    expect(reportBaseName(job({ job_type: 'html' }))).toBe('html_audit_2026-09-21')
    expect(reportBaseName(job({ job_type: 'css' }))).toBe('css_audit_2026-09-21')
    expect(reportBaseName(job({ job_type: 'links' }))).toBe('links_audit_2026-09-21')
  })
})

describe('buildReportCsv', () => {
  it('exports HTML validation messages with a header row', () => {
    const pages: ReportPage[] = [{
      url: 'https://example.com/', status_code: 200, issue_count: 1, violations: null, seo: null,
      html: { errors: 1, warnings: 1, info: 0, messages: [
        { severity: 'error', message: 'Stray end tag "div".', line: 12 },
        { severity: 'warning', message: 'Consider a lang attribute', line: 1 },
      ] },
    }]
    const csv = buildReportCsv(job({ job_type: 'html' }), pages)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Page URL,Severity,Line,Message')
    expect(lines[1]).toContain('error')
    expect(lines[1]).toContain('12')
    expect(lines).toHaveLength(3)
  })

  it('quotes fields containing commas', () => {
    const pages: ReportPage[] = [{
      url: 'https://example.com/', status_code: 200, issue_count: 1, violations: null, seo: null,
      html: { errors: 1, warnings: 0, info: 0, messages: [{ severity: 'error', message: 'Bad value, really', line: 3 }] },
    }]
    const csv = buildReportCsv(job({ job_type: 'html' }), pages)
    expect(csv).toContain('"Bad value, really"')
  })

  it('exports broken links for a links audit', () => {
    const pages: ReportPage[] = [{
      url: 'https://example.com/', status_code: 200, issue_count: 1, violations: null, seo: null,
      links: { total: 5, checked: 5, brokenInternal: 1, brokenExternal: 0, links: [
        { url: 'https://example.com/missing', status: 404, kind: 'internal', reason: 'Internal link returned HTTP 404.' },
      ] },
    }]
    const csv = buildReportCsv(job({ job_type: 'links' }), pages)
    expect(csv.split('\r\n')[0]).toBe('Page URL,Broken Link,Status,Kind,Reason')
    expect(csv).toContain('404')
    expect(csv).toContain('/missing')
  })

  it('exports security checks', () => {
    const pages: ReportPage[] = [{
      url: 'https://example.com/', status_code: 200, issue_count: 0, violations: null, seo: null,
      security: { score: 65, checks: [{ label: 'HSTS', status: 'warn', detail: 'Missing.', weight: 2 }] },
    }]
    const csv = buildReportCsv(job({ job_type: 'security' }), pages)
    expect(csv.split('\r\n')[0]).toBe('URL,Check,Status,Detail')
    expect(csv).toContain('HSTS')
  })
})

describe('buildReportHtml', () => {
  it('renders each audit type without throwing and titles it correctly', () => {
    for (const [t, title] of [['html', 'HTML Validation Report'], ['css', 'CSS Validation Report'], ['links', 'Broken Link Report'], ['security', 'Security & Headers Report']] as const) {
      const html = buildReportHtml(job({ job_type: t }), [])
      expect(html).toContain(title)
      expect(html.startsWith('<!doctype html>')).toBe(true)
    }
  })
})
