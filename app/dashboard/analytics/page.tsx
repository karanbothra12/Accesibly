import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import AnalyticsView from '@/components/dashboard/AnalyticsView'
import WidgetInsights from '@/components/dashboard/WidgetInsights'
import { PageHeader } from '@/components/dashboard/ui'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

export default async function AnalyticsPage() {
  const session = await getSession()

  const sites = await query<{ id: number; domain: string }>(
    `SELECT id, domain FROM sites WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [session.merchantId]
  )

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader icon="↗" title="Analytics" subtitle="Pageviews, widget engagement, top pages and site health." />
      <AnalyticsView sites={sites} />
      <div className="mt-10">
        <WidgetInsights sites={sites} />
      </div>
    </div>
  )
}
