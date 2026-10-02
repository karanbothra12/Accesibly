// ── HTML validation (W3C Nu Html Checker) ─────────────────────────
// We do NOT re-implement the HTML spec — we call the reference implementation
// from the W3C/WHATWG: the "Nu Html Checker" (vnu), self-hosted as an HTTP
// service. Point VNU_URL at your running checker (Docker `validator/validator`
// or `java -jar vnu.jar --server`, default port 8888). The crawler hands us the
// page's HTML and we POST it to the checker, then normalize the JSON messages.
//
// Keeping the message-normalization pure (parseVnu) makes it unit-testable
// without a running validator.

export type HtmlSeverity = 'error' | 'warning' | 'info'

export interface HtmlMessage {
  severity: HtmlSeverity
  message: string
  line: number | null       // last line of the offending region
  column: number | null     // last column
  extract: string | null    // snippet of the offending markup
  fatal: boolean            // fatal parse error (validation aborted early)
}

export interface HtmlResult {
  errors: number
  warnings: number
  info: number
  ok: boolean               // no errors (fatal or otherwise)
  messages: HtmlMessage[]
  validatorError: string | null  // set when the checker couldn't be reached/ran
}

// vnu's JSON message shape (only the fields we use).
interface VnuMessage {
  type?: string             // 'error' | 'info' | 'non-document-error'
  subType?: string          // 'warning' | 'fatal' | 'internal' | 'io' | 'schema'
  message?: string
  extract?: string
  lastLine?: number
  firstLine?: number
  lastColumn?: number
  firstColumn?: number
}

// How many messages we persist per page (keeps JSONB rows bounded).
const MAX_MESSAGES = 400

// Normalize the vnu JSON payload into our stable, scored result.
// vnu encodes warnings as { type:'info', subType:'warning' }, plain notices as
// { type:'info' }, spec violations as { type:'error' }, and validator/runtime
// problems as { type:'non-document-error' } (surfaced as a validatorError).
export function parseVnu(payload: { messages?: VnuMessage[] } | null | undefined): HtmlResult {
  const raw = Array.isArray(payload?.messages) ? payload!.messages! : []
  const messages: HtmlMessage[] = []
  let errors = 0, warnings = 0, info = 0
  let validatorError: string | null = null

  for (const m of raw) {
    const type = m.type ?? 'info'

    if (type === 'non-document-error') {
      // A problem with the checker itself, not the document.
      validatorError = validatorError || m.message || 'The HTML checker reported a non-document error.'
      continue
    }

    let severity: HtmlSeverity
    const fatal = m.subType === 'fatal'
    if (type === 'error') { severity = 'error'; errors++ }
    else if (type === 'info' && m.subType === 'warning') { severity = 'warning'; warnings++ }
    else { severity = 'info'; info++ }

    if (messages.length < MAX_MESSAGES) {
      messages.push({
        severity,
        message: (m.message ?? '').slice(0, 1000),
        line: m.lastLine ?? m.firstLine ?? null,
        column: m.lastColumn ?? m.firstColumn ?? null,
        extract: m.extract ? m.extract.slice(0, 300) : null,
        fatal,
      })
    }
  }

  // Sort so the drill-down leads with errors, then warnings, then info.
  const rank: Record<HtmlSeverity, number> = { error: 0, warning: 1, info: 2 }
  messages.sort((a, b) => rank[a.severity] - rank[b.severity])

  return { errors, warnings, info, ok: errors === 0, messages, validatorError }
}

// Base URL of the self-hosted checker (no trailing slash).
export function vnuBase(): string {
  return (process.env.VNU_URL || 'http://localhost:8888').replace(/\/+$/, '')
}

export function isVnuConfigured(): boolean {
  return !!process.env.VNU_URL
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Validate a single HTML document against the self-hosted checker.
// Never throws: on transport/timeout errors it returns a result whose
// validatorError explains the failure, so one bad page can't kill a crawl.
// Retries on HTTP 429 (rate limiting), honoring Retry-After — relevant when
// pointing at the shared public W3C endpoint.
export async function validateHtml(html: string, timeoutMs = 30_000, maxRetries = 3): Promise<HtmlResult> {
  const empty = (msg: string): HtmlResult =>
    ({ errors: 0, warnings: 0, info: 0, ok: false, messages: [], validatorError: msg })

  if (!html || !html.trim()) return empty('No HTML was captured for this page.')

  const url = `${vnuBase()}/?out=json`
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: html,
        signal: controller.signal,
      })
      if (res.status === 429) {
        if (attempt === maxRetries) return empty('HTML checker is rate-limiting requests (HTTP 429). Self-host the checker (VNU_URL) to remove the public endpoint’s limit.')
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 15000)
        clearTimeout(timer)
        await sleep(waitMs)
        continue
      }
      if (!res.ok) return empty(`HTML checker returned HTTP ${res.status}.`)
      const json = (await res.json()) as { messages?: VnuMessage[] }
      return parseVnu(json)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return empty(
        /abort/i.test(msg)
          ? 'The HTML checker timed out.'
          : `Could not reach the HTML checker (VNU_URL). ${msg}`
      )
    } finally {
      clearTimeout(timer)
    }
  }
  return empty('HTML checker is rate-limiting requests (HTTP 429).')
}
