import { queryOne, query } from '@/lib/db'
import { compare } from '@/lib/competitor'

// Processes a queued competitor comparison in-process (via after()), so it
// survives the user navigating away. Atomic claim = safe to call once per row.
export async function processCompetitorReport(id: number): Promise<void> {
  const claimed = await queryOne<{ your_url: string; competitor_url: string }>(
    `UPDATE competitor_reports SET status = 'running'
     WHERE id = $1 AND status = 'pending'
     RETURNING your_url, competitor_url`,
    [id]
  )
  if (!claimed) return

  try {
    const result = await compare(claimed.your_url, claimed.competitor_url)
    await query(
      `UPDATE competitor_reports SET status = 'done', result = $2 WHERE id = $1`,
      [id, JSON.stringify(result)]
    )
  } catch (e) {
    await query(
      `UPDATE competitor_reports SET status = 'failed', error = $2 WHERE id = $1`,
      [id, e instanceof Error ? e.message : String(e)]
    )
    const { logError } = await import('@/lib/errorlog')
    await logError({ source: 'job', message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : null, path: `competitor_report#${id}`, meta: { id } })
  }
}
