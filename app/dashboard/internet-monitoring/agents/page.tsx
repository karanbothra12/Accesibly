import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { isSuperadmin } from '@/lib/access'
import { PageHeader } from '@/components/dashboard/ui'
import AgentsView from '@/components/monitoring/AgentsView'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

export default async function MonitoringAgentsPage() {
  const session = await getSession()
  const superadmin = await isSuperadmin(session.merchantId)
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader icon="📡" title="Global Monitoring Agents" subtitle="The fleet that runs synthetic checks. The central worker runs as agent #1; remote VPS agents join via token." />
      <AgentsView isSuperadmin={superadmin} />
    </div>
  )
}
