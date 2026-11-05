import { query, queryOne } from '@/lib/db'
import { notifyMerchant } from '@/lib/email'

// ── Incident detection + alerting ─────────────────────────────────────────────
// Phase 4. Opens an incident when a site fails several consecutive checks, resolves
// it on recovery, and fires alerts (email + webhook). A unique partial index keeps
// at most one open incident per (website, kind), which de-dupes alerts. Root cause
// is always presented as a HYPOTHESIS derived from the measured error phase.

const CONSECUTIVE_FAILURES = 3

export function causeHypothesis(errorType: string | null): string {
  switch (errorType) {
    case 'dns': return 'DNS resolution is failing — likely a DNS/nameserver issue (not the origin server).'
    case 'tcp': return 'TCP connection is failing — likely a network/routing or origin-reachability issue.'
    case 'tls':
    case 'ssl': return 'TLS handshake/certificate issue — check the certificate and TLS config.'
    case 'timeout': return 'Requests are timing out — likely origin/app overload or a network path problem.'
    case 'http': return 'Origin returned an error status — likely an application/origin issue.'
    default: return 'Site is unreachable — evidence is inconclusive about the exact layer.'
  }
}

type Site = { website_id: number; merchant_id: number; name: string; url: string }

// Fire configured alerts for an incident transition. Best-effort, never throws.
async function deliverAlerts(site: Site, kind: string, state: 'opened' | 'resolved', detail: string): Promise<void> {
  const subject = state === 'opened'
    ? `🚨 ${site.name} is ${kind === 'down' ? 'DOWN' : kind}`
    : `✅ ${site.name} recovered`
  const html = `<p><strong>${site.name}</strong> (${site.url})</p><p>${state === 'opened' ? detail : 'The site is responding again.'}</p>`

  // Email (respects the merchant's notification prefs inside notifyMerchant).
  try { await notifyMerchant(site.merchant_id, 'monitor_alert', subject, html) } catch { /* best-effort */ }

  // Webhooks from alert_configurations (condition matches the incident kind).
  const condition = kind === 'down' ? 'down' : kind
  const hooks = await query<{ target: string }>(
    `SELECT target FROM alert_configurations
     WHERE merchant_id = $1 AND enabled = TRUE AND channel = 'webhook' AND condition = $2
       AND (website_id IS NULL OR website_id = $3) AND target IS NOT NULL`,
    [site.merchant_id, condition, site.website_id]
  )
  for (const h of hooks) {
    try {
      await fetch(h.target, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: `incident.${state}`, kind, website: site.name, url: site.url, detail, at: new Date().toISOString() }),
        signal: AbortSignal.timeout(8000),
      })
    } catch { /* best-effort */ }
  }
}

// Scan recently-checked websites and open/resolve incidents. Returns counts.
export async function detectIncidents(): Promise<{ opened: number; resolved: number }> {
  let opened = 0, resolved = 0

  const sites = await query<Site>(
    `SELECT mw.id AS website_id, mw.merchant_id, mw.name, mw.url
     FROM monitored_websites mw JOIN merchants m ON m.id = mw.merchant_id
     WHERE mw.enabled = TRUE AND m.is_active = TRUE AND mw.last_checked_at > NOW() - INTERVAL '1 hour'`
  )

  for (const site of sites) {
    const recent = await query<{ available: boolean; error_type: string | null; error_detail: string | null }>(
      `SELECT available, error_type, error_detail FROM synthetic_results
       WHERE website_id = $1 ORDER BY measured_at DESC LIMIT $2`,
      [site.website_id, CONSECUTIVE_FAILURES]
    )
    if (recent.length === 0) continue
    const latestUp = recent[0].available
    const allDown = recent.length >= CONSECUTIVE_FAILURES && recent.every(r => !r.available)

    if (allDown) {
      const cause = causeHypothesis(recent[0].error_type)
      const ins = await queryOne<{ id: number }>(
        `INSERT INTO monitoring_incidents (website_id, kind, cause_hypothesis, failure_count, last_error, started_at, detected_at)
         VALUES ($1, 'down', $2, $3, $4, NOW(), NOW())
         ON CONFLICT (website_id, kind) WHERE status IN ('open','acknowledged') DO NOTHING
         RETURNING id`,
        [site.website_id, cause, recent.length, recent[0].error_detail]
      )
      if (ins) { opened++; await deliverAlerts(site, 'down', 'opened', cause) }
    } else if (latestUp) {
      const res = await queryOne<{ id: number }>(
        `UPDATE monitoring_incidents SET status = 'resolved', resolved_at = NOW()
         WHERE website_id = $1 AND kind = 'down' AND status IN ('open','acknowledged') RETURNING id`,
        [site.website_id]
      )
      if (res) { resolved++; await deliverAlerts(site, 'down', 'resolved', '') }
    }
  }
  return { opened, resolved }
}
