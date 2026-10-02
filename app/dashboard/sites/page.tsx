import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import SitesList from '@/components/dashboard/SitesList'
import { PageHeader } from '@/components/dashboard/ui'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

export default async function SitesPage() {
  const session = await getSession()

  const sites = await query<{
    id: number; domain: string; site_key: string; is_active: boolean; rum_enabled: boolean
    widget_position: string; widget_hidden: boolean; created_at: string
  }>(
    `SELECT id, domain, site_key, is_active, rum_enabled, widget_position, widget_hidden, created_at
     FROM sites WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [session.merchantId]
  )

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader icon="⊞" title="Sites" subtitle="Register domains, manage status, and grab your embed snippet." />

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SitesList initialSites={sites} />
        </div>

        {/* Install guide */}
        <aside className="space-y-4">
          <div className="ui-card p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">How to install</h2>
            <ol className="space-y-3 text-sm text-slate-600">
              <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-primary-lt text-primary text-xs font-bold flex items-center justify-center">1</span>Add your domain here.</li>
              <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-primary-lt text-primary text-xs font-bold flex items-center justify-center">2</span>Copy the embed snippet below each site.</li>
              <li className="flex gap-2.5"><span className="shrink-0 w-5 h-5 rounded-full bg-primary-lt text-primary text-xs font-bold flex items-center justify-center">3</span>Paste it right before <code className="font-mono text-xs bg-slate-100 px-1 rounded">&lt;/body&gt;</code>.</li>
            </ol>
          </div>
          <div className="bg-primary-lt/60 rounded-xl border border-primary/20 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-1">Privacy-first</h2>
            <p className="text-sm text-slate-600">The widget stores no IP addresses and no personal data — only anonymous pageview and engagement counts.</p>
          </div>
        </aside>
      </div>
    </div>
  )
}
