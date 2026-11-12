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
  // Prefer the agent's self-reported IP; fall back to the request's forwarded IP
  // (Vercel sets x-forwarded-for), so agents that don't self-report still enrich.
  const fwd = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const reqIp = fwd || request.headers.get('x-real-ip') || null
  const publicIp = (typeof body.public_ip === 'string' && body.public_ip ? body.public_ip : reqIp)?.slice(0, 64) || null
  await recordHeartbeat(agent.id, {
    publicIp,
    currentJobs: Number.isFinite(body.current_jobs) ? Number(body.current_jobs) : null,
    failedJobs: Number.isFinite(body.failed_jobs) ? Number(body.failed_jobs) : null,
  })
  return NextResponse.json({ ok: true, agent_id: agent.id, agent_key: agent.agent_key })
}
