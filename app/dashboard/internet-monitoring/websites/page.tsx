import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { getEntitlements, getLimit } from '@/lib/entitlements'
import { PageHeader } from '@/components/dashboard/ui'
import WebsitesManager from '@/components/monitoring/WebsitesManager'

const FREQUENCIES = [1, 5, 10, 15, 30]

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

type Website = {
  id: number; name: string; url: string; description: string | null
  frequency_minutes: number; expected_status: number; timeout_ms: number
  enabled: boolean; verified: boolean; verification_token: string; verification_method: string | null
  agent_ids: number[]; last_checked_at: string | null; created_at: string
}

export default async function MonitoringWebsitesPage() {
  const session = await getSession()
  const superadmin = await isSuperadmin(session.merchantId)
  const ent = await getEntitlements(session.merchantId!) // layout guarantees auth
  const available = superadmin || !!ent?.features['internet_monitoring']
  const minFrequency = superadmin ? 1 : (ent ? getLimit(ent, 'min_monitor_frequency_minutes') : 0)
  const websiteLimit = superadmin ? -1 : (ent ? getLimit(ent, 'monitored_websites') : 0)
  const frequencies = available && minFrequency > 0 ? FREQUENCIES.filter(f => f >= minFrequency) : (superadmin ? FREQUENCIES : [])

  const websites = await query<Website>(
    `SELECT id, name, url, description, frequency_minutes, expected_status, timeout_ms,
            enabled, verified, verification_token, verification_method, agent_ids, last_checked_at, created_at
     FROM monitored_websites
     ${superadmin ? '' : 'WHERE merchant_id = $1'}
     ORDER BY created_at DESC`,
    superadmin ? [] : [session.merchantId]
  )

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <PageHeader icon="⊡" title="Website Monitoring" subtitle="Register sites, verify ownership, and track uptime + response-time breakdown." />
      <WebsitesManager initial={{ websites, available, websiteLimit, minFrequency, frequencies }} superadmin={superadmin} />
    </div>
  )
}
