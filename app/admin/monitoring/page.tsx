import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { redirect } from 'next/navigation'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import AdminShell from '@/components/admin/AdminShell'
import { PageHeader, StatCard } from '@/components/dashboard/ui'
import AgentsView from '@/components/monitoring/AgentsView'
import WebsitesManager from '@/components/monitoring/WebsitesManager'

const FREQUENCIES = [1, 5, 10, 15, 30]

type Website = {
  id: number; name: string; url: string; description: string | null
  frequency_minutes: number; expected_status: number; timeout_ms: number
  enabled: boolean; verified: boolean; verification_token: string; verification_method: string | null
  agent_ids: number[]; last_checked_at: string | null; created_at: string
}

export default async function AdminMonitoringPage() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
  if (!session.isLoggedIn || !session.merchantId) redirect('/login')
  const me = await queryOne<{ is_superadmin: boolean }>('SELECT is_superadmin FROM merchants WHERE id = $1', [session.merchantId])
  if (!me?.is_superadmin) redirect('/dashboard')

  // SuperAdmin sees ALL monitored websites across merchants.
  const websites = await query<Website>(
    `SELECT id, name, url, description, frequency_minutes, expected_status, timeout_ms,
            enabled, verified, verification_token, verification_method, agent_ids, last_checked_at, created_at
     FROM monitored_websites ORDER BY created_at DESC`
  )
  const counts = await queryOne<{ total: string; enabled: string }>(
    `SELECT COUNT(*) total, COUNT(*) FILTER (WHERE enabled) enabled FROM monitored_websites`
  )
  const perf = await queryOne<{ checks: string; up: string }>(
    `SELECT COUNT(*) checks, COUNT(*) FILTER (WHERE available) up
     FROM synthetic_results WHERE measured_at >= NOW() - INTERVAL '24 hours'`
  )
  const agents = await queryOne<{ total: string; online: string }>(
    `SELECT COUNT(*) total, COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '10 minutes') online FROM monitoring_agents`
  )
  const checks = Number(perf?.checks || 0)
  const avail = checks ? `${((Number(perf?.up || 0) / checks) * 100).toFixed(checks && Number(perf?.up) === checks ? 0 : 1)}%` : '—'

  return (
    <AdminShell fullName={session.fullName ?? ''} email={session.email ?? ''}>
      <PageHeader icon="🌐" title="Internet Performance Monitoring" subtitle="Platform-wide synthetic monitoring — all merchants' sites, the agent fleet, and ISP/latency analytics." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Monitored sites" value={counts?.total ?? '0'} sub={`${counts?.enabled ?? 0} active`} icon="⊡" tint="tint-indigo" />
        <StatCard label="24h availability" value={avail} icon="✓" tint="tint-emerald" />
        <StatCard label="24h checks" value={String(checks)} icon="⚡" />
        <StatCard label="Agents online" value={`${agents?.online ?? 0}/${agents?.total ?? 0}`} icon="📡" />
      </div>

      <div className="space-y-8">
        <section>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Agent fleet</h2>
          <AgentsView isSuperadmin />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Monitored websites</h2>
          <WebsitesManager
            initial={{ websites, available: true, websiteLimit: -1, minFrequency: 1, frequencies: FREQUENCIES }}
            superadmin
          />
        </section>
        <p className="text-xs text-slate-400">
          Analytics (ISP / Country / ASN), incidents and reports are available to merchants in their dashboard;
          as SuperAdmin you can enable monitoring on any site here with “Mark verified (I own this)”.
        </p>
      </div>
    </AdminShell>
  )
}
