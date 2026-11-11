import { NextRequest, NextResponse } from 'next/server'
import { runMonitoringTick } from '@/lib/monitoring/scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60 // honored on Vercel Pro; Hobby caps lower

// GET /api/cron/monitor-tick — runs one monitoring cycle (schedule due checks →
// run them → detect incidents). Meant to be called every ~5 min by a reliable
// external cron (cron-job.org) or Vercel Cron, since GitHub's schedule is flaky.
//
// Auth: a shared secret via `Authorization: Bearer <token>`, `x-cron-key: <token>`,
// or `?key=<token>`. Token = CRON_SECRET (preferred), else INTERNAL_TOKEN/SESSION_SECRET.
function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET || process.env.INTERNAL_TOKEN || process.env.SESSION_SECRET
  if (!expected) return false
  const auth = req.headers.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  const header = req.headers.get('x-cron-key')
  const query = new URL(req.url).searchParams.get('key')
  // Vercel Cron sends this header on its own scheduled invocations.
  const isVercelCron = !!req.headers.get('x-vercel-cron')
  return isVercelCron || bearer === expected || header === expected || query === expected
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await runMonitoringTick()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
