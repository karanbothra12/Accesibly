import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateAgent } from '@/lib/monitoring/agents'
import { claimMonitoringJob } from '@/lib/monitoring/queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/internet-monitoring/agent/poll — token-authenticated.
// Claims the next due job for this agent and returns what to measure, or {job:null}.
export async function GET(request: NextRequest) {
  const agent = await authenticateAgent(request.headers.get('authorization'))
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await claimMonitoringJob(agent.id)
  if (!job) return NextResponse.json({ job: null })

  const website = await queryOne<{ url: string; expected_status: number; timeout_ms: number }>(
    'SELECT url, expected_status, timeout_ms FROM monitored_websites WHERE id = $1',
    [job.website_id]
  )
  if (!website) {
    // Target vanished between scheduling and polling — nothing to do.
    return NextResponse.json({ job: null })
  }

  return NextResponse.json({
    job: {
      id: job.id,
      website_id: job.website_id,
      job_type: job.job_type,
      url: website.url,
      expected_status: website.expected_status,
      timeout_ms: website.timeout_ms,
    },
  })
}
