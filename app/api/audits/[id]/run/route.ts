import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { processCrawlJob } from '@/lib/audit-runner'

// Manual/cron reclaim endpoint for a queued job (the normal path runs the job
// in-process via after() in POST /api/audits). Token-guarded and allowed
// through proxy.ts for the /run suffix. Runs on Node with a large budget.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Dedicated internal token (falls back to SESSION_SECRET only if unset).
  const expected = process.env.INTERNAL_TOKEN || process.env.SESSION_SECRET
  const token = request.headers.get('x-internal-token')
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const jobId = Number((await params).id)
  if (!jobId) return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })

  const result = await processCrawlJob(jobId)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
