import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { isSuperadmin } from '@/lib/access'
import { getEntitlements, getLimit } from '@/lib/entitlements'
import { PageHeader, Card } from '@/components/dashboard/ui'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

export default async function MonitoringSettingsPage() {
  const session = await getSession()
  const superadmin = await isSuperadmin(session.merchantId)
  const ent = await getEntitlements(session.merchantId!) // layout guarantees auth
  const available = superadmin || !!ent?.features['internet_monitoring']
  const websiteLimit = superadmin ? -1 : (ent ? getLimit(ent, 'monitored_websites') : 0)
  const minFreq = superadmin ? 1 : (ent ? getLimit(ent, 'min_monitor_frequency_minutes') : 0)

  const row = (k: string, v: string) => (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500">{k}</span><span className="text-sm font-medium text-slate-800">{v}</span>
    </div>
  )

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <PageHeader icon="⚙" title="Monitoring Settings" subtitle="Your plan entitlements and data-retention policy." />
      <Card className="p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Plan entitlements</h2>
        {row('Internet Monitoring', available ? 'Enabled' : 'Not in plan')}
        {row('Monitored websites', websiteLimit === -1 ? 'Unlimited' : String(websiteLimit))}
        {row('Fastest check frequency', minFreq > 0 ? `Every ${minFreq} min` : '—')}
      </Card>
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Data retention</h2>
        <p className="text-sm text-slate-500 mb-3">Default policy for this module (configurable retention jobs land in a later phase):</p>
        {row('Raw synthetic measurements', '90 days')}
        {row('Aggregated performance stats', '12 months')}
        {row('RUM events (existing pipeline)', '30 days')}
        <p className="mt-3 text-xs text-slate-400">No existing application data is deleted automatically. Retention trimming runs as a scheduled maintenance job (Phase 4).</p>
      </Card>
    </div>
  )
}
