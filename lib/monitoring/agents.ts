import crypto from 'node:crypto'
import { query, queryOne } from '@/lib/db'
import type { SyntheticResult } from '@/lib/monitoring/synthetic'

// ── Monitoring agents: registration, auth, heartbeat ──────────────────────────
// Agents authenticate with a per-agent opaque bearer token. Only its SHA-256 hash
// is stored (agent_credentials.token_hash); the plaintext is shown once at
// registration. Agents NEVER receive DATABASE_URL — all access is via the API.
// This token model is separate from the RUM site-key (which is a public embed key).

export type AgentRow = {
  id: number
  agent_key: string
  name: string
  kind: 'central' | 'remote'
  status: 'pending' | 'active' | 'offline' | 'disabled'
}

export function generateAgentToken(): string {
  return 'agt_' + crypto.randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export type RegisterInput = {
  name: string
  kind?: 'central' | 'remote'
  countryCode?: string | null
  city?: string | null
  region?: string | null
  version?: string | null
  publicIp?: string | null
}

// Create an agent + its first credential. Returns the plaintext token ONCE.
export async function registerAgent(input: RegisterInput): Promise<{ agentId: number; agentKey: string; token: string }> {
  const agent = await queryOne<{ id: number; agent_key: string }>(
    `INSERT INTO monitoring_agents (name, kind, country_code, city, region, version, public_ip, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
     RETURNING id, agent_key`,
    [input.name, input.kind ?? 'remote', input.countryCode ?? null, input.city ?? null, input.region ?? null, input.version ?? null, input.publicIp ?? null]
  )
  const token = generateAgentToken()
  await query(
    `INSERT INTO agent_credentials (agent_id, token_hash, token_prefix) VALUES ($1, $2, $3)`,
    [agent!.id, hashToken(token), token.slice(0, 12)]
  )
  return { agentId: agent!.id, agentKey: agent!.agent_key, token }
}

// Resolve a bearer token to its agent (active credential only). Updates last_used_at.
export async function authenticateAgent(token: string | null | undefined): Promise<AgentRow | null> {
  if (!token) return null
  const bearer = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim()
  if (!bearer) return null
  const row = await queryOne<AgentRow & { credential_id: number }>(
    `SELECT a.id, a.agent_key, a.name, a.kind, a.status, c.id AS credential_id
     FROM agent_credentials c JOIN monitoring_agents a ON a.id = c.agent_id
     WHERE c.token_hash = $1 AND c.revoked = FALSE`,
    [hashToken(bearer)]
  )
  if (!row || row.status === 'disabled') return null
  await query('UPDATE agent_credentials SET last_used_at = NOW() WHERE id = $1', [row.credential_id])
  return { id: row.id, agent_key: row.agent_key, name: row.name, kind: row.kind, status: row.status }
}

export async function recordHeartbeat(
  agentId: number,
  info: { publicIp?: string | null; currentJobs?: number | null; failedJobs?: number | null; meta?: Record<string, unknown> } = {}
): Promise<void> {
  await query(
    `UPDATE monitoring_agents
     SET last_heartbeat_at = NOW(), status = 'active',
         public_ip = COALESCE($2, public_ip)
     WHERE id = $1`,
    [agentId, info.publicIp ?? null]
  )
  await query(
    `INSERT INTO agent_heartbeats (agent_id, public_ip, current_jobs, failed_jobs, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [agentId, info.publicIp ?? null, info.currentJobs ?? null, info.failedJobs ?? null, info.meta ? JSON.stringify(info.meta) : null]
  )
}

// Upsert the in-process central agent (the Singapore worker runs as "agent #1").
export async function ensureCentralAgent(name = 'central-worker'): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    `SELECT id FROM monitoring_agents WHERE kind = 'central' ORDER BY id ASC LIMIT 1`
  )
  if (existing) {
    await query(`UPDATE monitoring_agents SET last_heartbeat_at = NOW(), status = 'active' WHERE id = $1`, [existing.id])
    return existing.id
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO monitoring_agents (name, kind, status, last_heartbeat_at)
     VALUES ($1, 'central', 'active', NOW()) RETURNING id`,
    [name]
  )
  return row!.id
}

// Persist a synthetic measurement + update rollup counters. countryCode/isp/asn are
// the AGENT's network dimensions (enriched in Phase 2); null is fine for now.
export async function saveSyntheticResult(
  websiteId: number,
  agentId: number,
  jobId: string | number | null,
  r: SyntheticResult,
  dims: { countryCode?: string | null; isp?: string | null; asn?: number | null } = {}
): Promise<void> {
  await query(
    `INSERT INTO synthetic_results
      (website_id, agent_id, job_id, country_code, isp, asn, available, status_code, error_type, error_detail,
       dns_ms, tcp_ms, tls_ms, ttfb_ms, download_ms, total_ms, redirect_ms, response_size, resolved_ip, ssl_expiry)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [websiteId, agentId, jobId ?? null, dims.countryCode ?? null, dims.isp ?? null, dims.asn ?? null,
     r.available, r.statusCode, r.errorType, r.errorDetail,
     r.dnsMs, r.tcpMs, r.tlsMs, r.ttfbMs, r.downloadMs, r.totalMs, r.redirectMs, r.responseSize, r.resolvedIp, r.sslExpiry]
  )
  await query(
    `UPDATE monitoring_agents
     SET jobs_succeeded = jobs_succeeded + CASE WHEN $2 THEN 1 ELSE 0 END,
         jobs_failed    = jobs_failed    + CASE WHEN $2 THEN 0 ELSE 1 END,
         last_success_at = CASE WHEN $2 THEN NOW() ELSE last_success_at END
     WHERE id = $1`,
    [agentId, r.available]
  )
  await query('UPDATE monitored_websites SET last_checked_at = NOW() WHERE id = $1', [websiteId])
}
