import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query, queryOne } from '@/lib/db'
import { getEntitlements } from '@/lib/entitlements'
import { PageHeader, StatCard, Card } from '@/components/dashboard/ui'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

export default async function InternetMonitoringOverview() {
  const session = await getSession()
  const merchantId = session.merchantId! // dashboard layout guarantees an authenticated merchant
  const ent = await getEntitlements(merchantId)
  const available = !!ent?.features['internet_monitoring']

  const counts = await queryOne<{ total: string; enabled: string; verified: string }>(
    `SELECT COUNT(*) total,
            COUNT(*) FILTER (WHERE enabled) enabled,
            COUNT(*) FILTER (WHERE verified) verified
     FROM monitored_websites WHERE merchant_id = $1`,
    [merchantId]
  )
  const perf = await queryOne<{ checks: string; up: string; avg_total: number | null }>(
    `SELECT COUNT(*) checks, COUNT(*) FILTER (WHERE sr.available) up, AVG(sr.total_ms) avg_total
     FROM synthetic_results sr JOIN monitored_websites mw ON mw.id = sr.website_id
     WHERE mw.merchant_id = $1 AND sr.measured_at >= NOW() - INTERVAL '24 hours'`,
    [merchantId]
  )
  const agents = await queryOne<{ total: string; online: string }>(
    `SELECT COUNT(*) total,
            COUNT(*) FILTER (WHERE last_heartbeat_at > NOW() - INTERVAL '2 minutes') online
     FROM monitoring_agents`
  )
  const recent = await query<{ name: string; url: string; available: boolean; total_ms: number | null; measured_at: string; status_code: number | null; error_type: string | null }>(
    `SELECT DISTINCT ON (mw.id) mw.name, mw.url, sr.available, sr.total_ms, sr.measured_at, sr.status_code, sr.error_type
     FROM monitored_websites mw
     LEFT JOIN synthetic_results sr ON sr.website_id = mw.id
     WHERE mw.merchant_id = $1
     ORDER BY mw.id, sr.measured_at DESC NULLS LAST`,
    [merchantId]
  )

  const checks = Number(perf?.checks || 0)
  const up = Number(perf?.up || 0)
  const availability = checks ? ((up / checks) * 100).toFixed(checks && up === checks ? 0 : 2) + '%' : '—'

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader icon="🌐" title="Internet Performance Monitoring" subtitle="Global synthetic uptime + performance from distributed agents." />

      {!available && (
        <Card className="px-6 py-4 mb-6 text-sm text-amber-700 bg-amber-50 border-amber-200">
          This feature isn’t in your current plan — you can explore the setup, but checks won’t run. <a href="/dashboard/billing" className="font-semibold underline">View plans →</a>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Monitored sites" value={counts?.total ?? '0'} sub={`${counts?.enabled ?? 0} active`} icon="⊡" tint="tint-indigo" />
        <StatCard label="24h availability" value={availability} icon="✓" tint="tint-emerald" valueClass={checks && up === checks ? 'text-emerald-600' : 'text-slate-900'} />
        <StatCard label="24h avg response" value={perf?.avg_total != null ? `${Math.round(perf.avg_total)} ms` : '—'} icon="⚡" />
        <StatCard label="Agents online" value={`${agents?.online ?? 0}/${agents?.total ?? 0}`} icon="📡" />
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Latest status by site</h2>
          <a href="/dashboard/internet-monitoring/websites" className="text-xs font-semibold text-primary hover:underline">Manage websites →</a>
        </div>
        {recent.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">No monitored websites yet. <a href="/dashboard/internet-monitoring/websites" className="text-primary font-semibold hover:underline">Add one →</a></p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((r, i) => (
              <li key={i} className="px-5 py-3.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{r.name}</p>
                  <p className="text-xs text-slate-400 truncate">{r.url}</p>
                </div>
                <div className="text-right shrink-0">
                  {r.measured_at == null ? <span className="text-xs text-slate-400">no checks yet</span>
                    : r.available ? <span className="text-xs text-emerald-600 font-medium">{r.total_ms != null ? `${Math.round(r.total_ms)} ms` : 'up'}</span>
                    : <span className="text-xs text-rose-600 font-medium">{r.error_type ?? 'down'}{r.status_code ? ` ${r.status_code}` : ''}</span>}
                  {r.measured_at && <p className="text-[11px] text-slate-400">{new Date(r.measured_at).toLocaleTimeString()}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
