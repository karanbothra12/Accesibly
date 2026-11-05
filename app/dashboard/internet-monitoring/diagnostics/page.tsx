import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import { PageHeader, Card } from '@/components/dashboard/ui'
import DiagnosticsRunner from '@/components/monitoring/DiagnosticsRunner'

async function getSession() { const c = await cookies(); return getIronSession<SessionData>(c, SESSION_OPTIONS) }

export default async function MonitoringDiagnosticsPage() {
  const session = await getSession()
  const sites = await query<{ id: number; name: string; url: string }>(
    `SELECT id, name, url FROM monitored_websites WHERE merchant_id = $1 ORDER BY name`, [session.merchantId])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader icon="🩺" title="Network Diagnostics" subtitle="On-demand ping, traceroute and DNS from the monitoring agents, to localize slowness." />
      <DiagnosticsRunner sites={sites} />
      <Card className="mt-6 px-5 py-4 text-xs text-slate-500">
        Every synthetic check already records the full <b>DNS · TCP · TLS · TTFB · download</b> breakdown
        (see a site’s Results), which localizes most slowness to a phase. Ping/traceroute add hop-level
        detail but require privileged tools on the agent — if an agent lacks them the result says so,
        rather than guessing. We never attribute a cause without measurement evidence.
      </Card>
    </div>
  )
}
