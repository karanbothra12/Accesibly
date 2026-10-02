import { queryOne } from '@/lib/db'

// ── DB-backed fixed-window rate limiter ──────────────────────────
// Shared across serverless instances (uses Postgres). Fixed-window is simple and
// good enough for auth/abuse throttling. Fails OPEN: if the DB errors we allow
// the request rather than lock users out.

export async function rateLimit(
  bucket: string, limit: number, windowSeconds: number
): Promise<{ ok: boolean; remaining: number; retryAfter: number }> {
  try {
    const row = await queryOne<{ count: number; expires_at: string }>(
      `INSERT INTO rate_limits (bucket, count, expires_at)
       VALUES ($1, 1, NOW() + make_interval(secs => $2))
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN rate_limits.expires_at < NOW() THEN 1 ELSE rate_limits.count + 1 END,
         expires_at = CASE WHEN rate_limits.expires_at < NOW() THEN NOW() + make_interval(secs => $2) ELSE rate_limits.expires_at END
       RETURNING count, expires_at`,
      [bucket, windowSeconds]
    )
    const count = row?.count ?? 1
    const retryAfter = row ? Math.max(0, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000)) : windowSeconds
    return { ok: count <= limit, remaining: Math.max(0, limit - count), retryAfter }
  } catch {
    return { ok: true, remaining: limit, retryAfter: 0 }
  }
}

// Best-effort client IP from proxy headers (Vercel sets x-forwarded-for).
export function clientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return request.headers.get('x-real-ip') || 'unknown'
}
