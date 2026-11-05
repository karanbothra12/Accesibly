import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import { PageHeader } from '@/components/dashboard/ui'
import AnalyticsView from '@/components/monitoring/AnalyticsView'

async function getSession() { const c = await cookies(); return getIronSession<SessionData>(c, SESSION_OPTIONS) }

export default async function IspAnalyticsPage() {
  const session = await getSession()
  const sites = await query<{ id: number; name: string }>(
    `SELECT id, name FROM monitored_websites WHERE merchant_id = $1 ORDER BY name`, [session.merchantId])
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader icon="📶" title="ISP Analytics" subtitle="Response time, availability and phase breakdown by ISP. Select rows to compare." />
      <AnalyticsView dimension="isp" label="ISP" sites={sites} />
    </div>
  )
}
