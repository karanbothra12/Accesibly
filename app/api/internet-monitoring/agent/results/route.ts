import { NextRequest, NextResponse } from 'next/server'
import { queryOne } from '@/lib/db'
import { authenticateAgent, saveSyntheticResult } from '@/lib/monitoring/agents'
import { completeMonitoringJob } from '@/lib/monitoring/queue'
import type { SyntheticResult, SyntheticErrorType } from '@/lib/monitoring/synthetic'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const ERR_TYPES: SyntheticErrorType[] = ['dns', 'tcp', 'tls', 'ssl', 'http', 'timeout', 'ssrf']

function coerce(r: Record<string, unknown>): SyntheticResult {
  const et = r.errorType
  return {
    available: r.available === true,
    statusCode: num(r.statusCode),
    errorType: ERR_TYPES.includes(et as SyntheticErrorType) ? (et as SyntheticErrorType) : null,
    errorDetail: typeof r.errorDetail === 'string' ? r.errorDetail.slice(0, 500) : null,
    dnsMs: num(r.dnsMs), tcpMs: num(r.tcpMs), tlsMs: num(r.tlsMs), ttfbMs: num(r.ttfbMs),
    downloadMs: num(r.downloadMs), totalMs: num(r.totalMs), redirectMs: num(r.redirectMs),
    responseSize: num(r.responseSize), resolvedIp: typeof r.resolvedIp === 'string' ? r.resolvedIp.slice(0, 64) : null,
    sslExpiry: typeof r.sslExpiry === 'string' ? r.sslExpiry.slice(0, 40) : null,
  }
}

// POST /api/internet-monitoring/agent/results — token-authenticated.
// Body: { job_id, result } — persists the measurement and closes the job.
export async function POST(request: NextRequest) {
  const agent = await authenticateAgent(request.headers.get('authorization'))
  if (!agent) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const jobId = String(body.job_id || '')
  if (!jobId || typeof body.result !== 'object' || !body.result) {
    return NextResponse.json({ error: 'job_id and result are required' }, { status: 400 })
  }

  // The job must be one THIS agent is currently holding.
  const job = await queryOne<{ website_id: number }>(
    `SELECT website_id FROM monitoring_jobs WHERE id = $1 AND locked_by = $2 AND status = 'running'`,
    [jobId, agent.id]
  )
  if (!job) return NextResponse.json({ error: 'Job not found or not owned by this agent' }, { status: 409 })

  const result = coerce(body.result as Record<string, unknown>)
  // Source dimensions come from the AGENT's own network (enriched in Phase 2).
  const dims = await queryOne<{ country_code: string | null; isp: string | null; asn: number | null }>(
    'SELECT country_code, isp, asn FROM monitoring_agents WHERE id = $1', [agent.id]
  )
  await saveSyntheticResult(job.website_id, agent.id, jobId, result,
    { countryCode: dims?.country_code ?? null, isp: dims?.isp ?? null, asn: dims?.asn ?? null })

  // A "site down" result is a SUCCESSFUL measurement — the job is complete either
  // way. (The queue's retry/dead-letter path is only for jobs that threw before a
  // result could be produced.)
  await completeMonitoringJob(jobId, agent.id)

  return NextResponse.json({ ok: true })
}
