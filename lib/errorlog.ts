import { query } from '@/lib/db'

// ── Error logging (best-effort; never throws) ────────────────────
// Persists server/API/job/client errors with stack + context for the
// SuperAdmin error console. A failure to log must never break the app.

export type ErrorSource = 'server' | 'api' | 'client' | 'job'

export async function logError(input: {
  source: ErrorSource
  message: string
  stack?: string | null
  path?: string | null
  method?: string | null
  merchantId?: number | null
  meta?: Record<string, unknown> | null
  level?: string
}): Promise<void> {
  try {
    await query(
      `INSERT INTO error_logs (source, level, message, stack, path, method, merchant_id, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.source,
        input.level || 'error',
        String(input.message ?? 'Unknown error').slice(0, 2000),
        input.stack ? String(input.stack).slice(0, 8000) : null,
        input.path ? String(input.path).slice(0, 500) : null,
        input.method ? String(input.method).slice(0, 12) : null,
        input.merchantId ?? null,
        input.meta ? JSON.stringify(input.meta).slice(0, 8000) : null,
      ]
    )
  } catch {
    /* swallow — logging must never throw */
  }
}
