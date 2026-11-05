import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import { PageHeader } from '@/components/dashboard/ui'
import ReportsView from '@/components/monitoring/ReportsView'

async function getSession() { const c = await cookies(); return getIronSession<SessionData>(c, SESSION_OPTIONS) }

export default async function ReportsPage() {
  const session = await getSession()
  const sites = await query<{ id: number; name: string }>(
    `SELECT id, name FROM monitored_websites WHERE merchant_id = $1 ORDER BY name`, [session.merchantId])
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader icon="📄" title="Historical Reports" subtitle="ISP leaderboards and raw-measurement CSV export." />
      <ReportsView sites={sites} />
    </div>
  )
}
