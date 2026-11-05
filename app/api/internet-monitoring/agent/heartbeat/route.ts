import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgent, recordHeartbeat } from '@/lib/monitoring/agents'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/internet-monitoring/agent/heartbeat — token-authenticated.
// Body: { public_ip?, current_jobs?, failed_jobs?, version? }
export async function POST(request: NextRequest) {
  const agent = await authenticateAgent(request.headers.get('authorization'))
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  await recordHeartbeat(agent.id, {
    publicIp: typeof body.public_ip === 'string' ? body.public_ip.slice(0, 64) : null,
    currentJobs: Number.isFinite(body.current_jobs) ? Number(body.current_jobs) : null,
    failedJobs: Number.isFinite(body.failed_jobs) ? Number(body.failed_jobs) : null,
  })
  return NextResponse.json({ ok: true, agent_id: agent.id, agent_key: agent.agent_key })
}
