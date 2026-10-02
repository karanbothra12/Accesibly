import { query, queryOne } from '@/lib/db'
import { hasFeature } from '@/lib/entitlements'

// ── Email delivery ───────────────────────────────────────────────
// Provider-agnostic. Until a provider is configured (payment step), emails are
// queued to email_outbox and logged; a real provider drains them later. Callers
// go through notifyMerchant(), which enforces the plan feature + preferences.

type Prefs = { audit_done: boolean; limit_reached: boolean; recipient: string | null }

async function getPrefs(merchantId: number): Promise<Prefs> {
  const row = await queryOne<Prefs>(
    'SELECT audit_done, limit_reached, recipient FROM notification_settings WHERE merchant_id = $1',
    [merchantId]
  )
  // Sensible defaults when the merchant hasn't configured anything yet.
  return row ?? { audit_done: true, limit_reached: true, recipient: null }
}

// Actually send, or queue when no provider is configured. Returns the status.
async function deliver(recipient: string, subject: string, html: string): Promise<{ status: 'sent' | 'queued' | 'failed'; error?: string }> {
  // No provider wired yet — queue + log. (Resend/SMTP integration lands with billing.)
  if (!process.env.RESEND_API_KEY && !process.env.SMTP_URL) {
    console.log(`[email:queued] → ${recipient} · ${subject}`)
    return { status: 'queued' }
  }
  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Accessly <noreply@accessly.io>', to: recipient, subject, html }),
      })
      if (!res.ok) return { status: 'failed', error: `Resend ${res.status}` }
      return { status: 'sent' }
    }
    // SMTP_URL configured but no transport bundled — treat as queued for now.
    return { status: 'queued' }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
}

// Send a notification to a merchant, respecting the plan feature + their prefs.
// Best-effort: never throws (callers are usually background tasks).
export async function notifyMerchant(
  merchantId: number,
  kind: 'audit_done' | 'limit_reached' | 'monitor_alert',
  subject: string,
  html: string,
): Promise<void> {
  try {
    if (!(await hasFeature(merchantId, 'email_notifications'))) return
    const prefs = await getPrefs(merchantId)
    if (kind === 'audit_done' && !prefs.audit_done) return
    if (kind === 'limit_reached' && !prefs.limit_reached) return
    // Monitoring alerts follow the audit-updates preference.
    if (kind === 'monitor_alert' && !prefs.audit_done) return

    const recipient = prefs.recipient
      || (await queryOne<{ email: string }>('SELECT email FROM merchants WHERE id = $1', [merchantId]))?.email
    if (!recipient) return

    const { status, error } = await deliver(recipient, subject, html)
    await query(
      `INSERT INTO email_outbox (merchant_id, recipient, subject, body_html, kind, status, error, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,${status === 'sent' ? 'NOW()' : 'NULL'})`,
      [merchantId, recipient, subject, html, kind, status, error ?? null]
    )
  } catch {
    /* notifications are best-effort */
  }
}
