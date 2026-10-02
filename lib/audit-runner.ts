import { query, queryOne } from '@/lib/db'
import { runCrawl, type Ruleset } from '@/lib/audit'
import { auditSecurity } from '@/lib/security-audit'
import { notifyMerchant } from '@/lib/email'

// Returns the id of the oldest queued crawl job, or null. The actual claim is
// done atomically inside processCrawlJob, so it's safe if several workers race.
export async function nextQueuedCrawlJobId(): Promise<number | null> {
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM crawl_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`
  )
  return row?.id ?? null
}

// Recover jobs whose worker/function died mid-crawl: any 'running' job that has
// been stuck longer than stallMinutes is reset to 'queued'. Partial results are
// cleared so the re-run starts clean (crawl_pages are inserted incrementally, so
// resuming in place would duplicate rows and double-count issues).
export async function requeueStalledCrawlJobs(stallMinutes = 15): Promise<number> {
  const stalled = await query<{ id: number }>(
    `SELECT id FROM crawl_jobs
       WHERE status = 'running' AND started_at < NOW() - make_interval(mins => $1::int)`,
    [stallMinutes]
  )
  for (const j of stalled) {
    await query('DELETE FROM crawl_pages WHERE job_id = $1', [j.id])
    await query(
      `UPDATE crawl_jobs
         SET status = 'queued', started_at = NULL, pages_crawled = 0, total_issues = 0,
             seo_score = NULL, seo_site = NULL
       WHERE id = $1 AND status = 'running'`,
      [j.id]
    )
  }
  return stalled.length
}

// Processes a queued crawl job in-process: atomically claims it, runs the
// headless crawl+axe pass persisting each page as it goes, then marks the
// job done or failed. Safe to call more than once — the atomic claim means
// only a currently-queued job is ever picked up.
export async function processCrawlJob(
  jobId: number
): Promise<{ ok: boolean; skipped?: boolean; error?: string; cancelled?: boolean }> {
  const claimed = await queryOne<{
    mode: 'single' | 'full'
    start_url: string
    max_pages: number
    ruleset: Ruleset
    seo_enabled: boolean
    job_type: 'accessibility' | 'seo' | 'html' | 'css' | 'security' | 'links'
  }>(
    `UPDATE crawl_jobs
     SET status = 'running', started_at = NOW()
     WHERE id = $1 AND status = 'queued'
     RETURNING mode, start_url, max_pages, ruleset, seo_enabled, job_type`,
    [jobId]
  )

  if (!claimed) return { ok: true, skipped: true }

  // Security audits are site-level and need no headless browser — run the
  // dedicated (network-only) path and finish.
  if (claimed.job_type === 'security') {
    return processSecurityJob(jobId, claimed.start_url)
  }

  try {
    // Each job type runs exactly one pass: SEO, HTML/CSS validation, or axe.
    const isSeoJob = claimed.job_type === 'seo'
    const isHtmlJob = claimed.job_type === 'html'
    const isCssJob = claimed.job_type === 'css'
    const isLinksJob = claimed.job_type === 'links'
    const { pagesCrawled, totalIssues, cancelled, seoScore, seoIssues, seoSite } = await runCrawl({
      startUrl: claimed.start_url,
      mode: claimed.mode,
      maxPages: claimed.max_pages,
      ruleset: claimed.ruleset,
      seo: isSeoJob || claimed.seo_enabled,
      a11y: !isSeoJob && !isHtmlJob && !isCssJob && !isLinksJob,
      html: isHtmlJob,
      css: isCssJob,
      linkcheck: isLinksJob,
      // Stop the crawl as soon as the job is no longer 'running' (e.g. a user
      // hit Cancel, which flips status to 'cancelled').
      shouldCancel: async () => {
        const row = await queryOne<{ status: string }>(
          'SELECT status FROM crawl_jobs WHERE id = $1',
          [jobId]
        )
        return !row || row.status !== 'running'
      },
      onPage: async page => {
        await query(
          `INSERT INTO crawl_pages
             (job_id, url, status_code, violations, issue_count, error, seo, html, css, links)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            jobId,
            page.url,
            page.statusCode ?? 0,
            JSON.stringify(page.results),
            page.violations,
            page.error,
            page.seo ? JSON.stringify(page.seo) : null,
            page.html ? JSON.stringify(page.html) : null,
            page.css ? JSON.stringify(page.css) : null,
            page.links ? JSON.stringify(page.links) : null,
          ]
        )
        await query(
          `UPDATE crawl_jobs
             SET pages_crawled = pages_crawled + 1,
                 total_issues = total_issues + $2
           WHERE id = $1`,
          [jobId, page.violations]
        )
      },
    })

    const seoSiteJson = seoSite ? JSON.stringify(seoSite) : null
    // For an SEO job the headline count is SEO issues (failing/warning checks).
    const issueCount = isSeoJob ? seoIssues : totalIssues

    if (cancelled) {
      // Preserve the 'cancelled' status set by the cancel endpoint; just
      // finalize the counts of whatever was audited before stopping.
      await query(
        `UPDATE crawl_jobs
           SET pages_crawled = $2, total_issues = $3,
               seo_score = $4, seo_site = $5,
               finished_at = COALESCE(finished_at, NOW())
         WHERE id = $1`,
        [jobId, pagesCrawled, issueCount, seoScore, seoSiteJson]
      )
      return { ok: true, cancelled: true }
    }

    // Only mark done if still running (guards against a concurrent cancel).
    await query(
      `UPDATE crawl_jobs
         SET status = 'done', finished_at = NOW(),
             pages_crawled = $2, total_issues = $3,
             seo_score = $4, seo_site = $5
       WHERE id = $1 AND status = 'running'`,
      [jobId, pagesCrawled, issueCount, seoScore, seoSiteJson]
    )

    // Notify the merchant that their audit finished (feature-gated, best-effort).
    const owner = await queryOne<{ merchant_id: number; domain: string }>(
      'SELECT s.merchant_id, s.domain FROM crawl_jobs j JOIN sites s ON s.id = j.site_id WHERE j.id = $1', [jobId]
    )
    if (owner) {
      const label = isSeoJob ? 'SEO audit' : isHtmlJob ? 'HTML validation' : isCssJob ? 'CSS validation' : isLinksJob ? 'Broken-link check' : 'Accessibility audit'
      await notifyMerchant(owner.merchant_id, 'audit_done',
        `Your ${label} for ${owner.domain} is ready`,
        `<p>Your ${label} for <b>${owner.domain}</b> finished.</p>
         <p>${pagesCrawled} page(s) scanned · ${issueCount} ${isSeoJob ? 'SEO ' : ''}issue(s)${isSeoJob && seoScore != null ? ` · score ${seoScore}` : ''}.</p>
         <p>View it in your Accessly dashboard.</p>`)
    }

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await query(
      `UPDATE crawl_jobs SET status = 'failed', error_message = $2, finished_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [jobId, message]
    )
    const { logError } = await import('@/lib/errorlog')
    await logError({ source: 'job', message, stack: err instanceof Error ? err.stack : null, path: `crawl_job#${jobId}`, meta: { jobId } })
    return { ok: false, error: message }
  }
}

// Site-level security & headers audit (job_type='security'). No headless
// browser: one network probe of the origin, stored as a single crawl_pages row
// with the security report in the `security` JSONB column.
async function processSecurityJob(
  jobId: number,
  startUrl: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const report = await auditSecurity(startUrl)
    // "Issues" = failing checks; warnings are advisory and shown separately.
    const issues = report.checks.filter(c => c.weight > 0 && c.status === 'fail').length

    await query(
      `INSERT INTO crawl_pages (job_id, url, status_code, violations, issue_count, error, security)
       VALUES ($1, $2, $3, '[]'::jsonb, $4, NULL, $5)`,
      [jobId, report.meta.finalUrl || startUrl, report.meta.statusCode ?? 0, issues, JSON.stringify(report)]
    )
    await query(
      `UPDATE crawl_jobs
         SET status = 'done', finished_at = NOW(),
             pages_crawled = 1, total_issues = $2, seo_score = $3
       WHERE id = $1 AND status = 'running'`,
      [jobId, issues, report.score]
    )

    const owner = await queryOne<{ merchant_id: number; domain: string }>(
      'SELECT s.merchant_id, s.domain FROM crawl_jobs j JOIN sites s ON s.id = j.site_id WHERE j.id = $1', [jobId]
    )
    if (owner) {
      await notifyMerchant(owner.merchant_id, 'audit_done',
        `Your security audit for ${owner.domain} is ready`,
        `<p>Your security &amp; headers audit for <b>${owner.domain}</b> finished.</p>
         <p>Score ${report.score}/100 · ${issues} failing check(s).</p>
         <p>View it in your Accessly dashboard.</p>`)
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await query(
      `UPDATE crawl_jobs SET status = 'failed', error_message = $2, finished_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [jobId, message]
    )
    const { logError } = await import('@/lib/errorlog')
    await logError({ source: 'job', message, stack: err instanceof Error ? err.stack : null, path: `security_job#${jobId}`, meta: { jobId } })
    return { ok: false, error: message }
  }
}
