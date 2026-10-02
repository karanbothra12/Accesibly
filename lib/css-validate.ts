// ── CSS validation (W3C CSS Validator / Jigsaw) ───────────────────
// Like the HTML checker, we call the W3C reference implementation rather than
// re-implementing CSS parsing. Self-host the "css-validator" (Jigsaw) and point
// CSS_VALIDATOR_URL at its endpoint. We validate by page URL (uri=…), so the
// validator fetches and checks every linked stylesheet + inline CSS server-side
// (no CORS limits, unlike reading document.styleSheets in the browser).
//
// parseCssValidation is kept pure so it can be unit-tested without a running
// validator.

export type CssSeverity = 'error' | 'warning'

export interface CssMessage {
  severity: CssSeverity
  message: string
  line: number | null
  source: string | null   // which stylesheet / page the issue is in
  context: string | null  // the selector/context reported by the validator
}

export interface CssResult {
  errors: number
  warnings: number
  ok: boolean
  messages: CssMessage[]
  validatorError: string | null
}

interface JigsawItem {
  source?: string
  line?: number
  context?: string
  message?: string
  type?: string
  level?: number
}
interface JigsawPayload {
  cssvalidation?: {
    validity?: boolean
    result?: { errorcount?: number; warningcount?: number }
    errors?: JigsawItem[]
    warnings?: JigsawItem[]
  }
}

const MAX_MESSAGES = 400
const clean = (s: string | undefined | null): string => (s ?? '').replace(/\s+/g, ' ').trim()

// Normalize the Jigsaw JSON payload into our stable result.
export function parseCssValidation(payload: JigsawPayload | null | undefined): CssResult {
  const v = payload?.cssvalidation
  if (!v) {
    return { errors: 0, warnings: 0, ok: false, messages: [], validatorError: 'The CSS validator returned an unexpected response.' }
  }
  const rawErrors = Array.isArray(v.errors) ? v.errors : []
  const rawWarnings = Array.isArray(v.warnings) ? v.warnings : []

  const messages: CssMessage[] = []
  const push = (severity: CssSeverity, it: JigsawItem) => {
    if (messages.length >= MAX_MESSAGES) return
    messages.push({
      severity,
      message: clean(it.message).slice(0, 1000),
      line: typeof it.line === 'number' ? it.line : null,
      source: it.source ? clean(it.source).slice(0, 300) : null,
      context: it.context ? clean(it.context).slice(0, 300) : null,
    })
  }
  for (const it of rawErrors) push('error', it)
  for (const it of rawWarnings) push('warning', it)

  const errors = v.result?.errorcount ?? rawErrors.length
  const warnings = v.result?.warningcount ?? rawWarnings.length
  return { errors, warnings, ok: errors === 0, messages, validatorError: null }
}

// Endpoint of the self-hosted validator (full path to the `validator` servlet).
export function cssValidatorEndpoint(): string {
  return (process.env.CSS_VALIDATOR_URL || 'http://localhost:8888/css-validator/validator').replace(/\/+$/, '')
}

export function isCssValidatorConfigured(): boolean {
  return !!process.env.CSS_VALIDATOR_URL
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Validate all CSS referenced by a page URL against the self-hosted validator.
// Never throws: transport/timeout problems come back as a validatorError.
// Retries on HTTP 429 (rate limiting), honoring Retry-After — important when
// pointing at the shared public W3C endpoint.
export async function validateCss(pageUrl: string, timeoutMs = 30_000, maxRetries = 3): Promise<CssResult> {
  const empty = (msg: string): CssResult => ({ errors: 0, warnings: 0, ok: false, messages: [], validatorError: msg })

  const qs = new URLSearchParams({ uri: pageUrl, output: 'json', profile: 'css3svg', warning: '1', lang: 'en' })
  const url = `${cssValidatorEndpoint()}?${qs.toString()}`

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (res.status === 429) {
        if (attempt === maxRetries) return empty('CSS validator is rate-limiting requests (HTTP 429). Self-host the validator (CSS_VALIDATOR_URL) to remove the public endpoint’s limit.')
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 15000)
        clearTimeout(timer)
        await sleep(waitMs)
        continue
      }
      if (!res.ok) return empty(`CSS validator returned HTTP ${res.status}.`)
      const json = (await res.json()) as JigsawPayload
      return parseCssValidation(json)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return empty(/abort/i.test(msg) ? 'The CSS validator timed out.' : `Could not reach the CSS validator (CSS_VALIDATOR_URL). ${msg}`)
    } finally {
      clearTimeout(timer)
    }
  }
  return empty('CSS validator is rate-limiting requests (HTTP 429).')
}
