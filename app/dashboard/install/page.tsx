import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import InstallGuide from '@/components/dashboard/InstallGuide'
import { PageHeader } from '@/components/dashboard/ui'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

export default async function InstallPage() {
  const session = await getSession()

  const sites = await query<{ id: number; domain: string; site_key: string; rum_enabled: boolean; widget_position: string; widget_hidden: boolean }>(
    `SELECT id, domain, site_key, rum_enabled, widget_position, widget_hidden
     FROM sites WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [session.merchantId]
  )

  // Absolute base for the embed snippet (falls back to a relative path in dev).
  const base =
    (process.env.NEXT_PUBLIC_WIDGET_CDN_URL || '').replace(/\/widget\.min\.js.*$/, '') ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ''

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <PageHeader icon="⚡" title="Install & Setup" subtitle="Add Accessly to your website in one line — then configure position and monitoring." />
      <InstallGuide sites={sites} base={base} />
    </div>
  )
}
