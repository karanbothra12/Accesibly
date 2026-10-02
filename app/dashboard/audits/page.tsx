import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { query } from '@/lib/db'
import { isSuperadmin } from '@/lib/access'
import { hasFeature } from '@/lib/entitlements'
import AuditsList from '@/components/dashboard/AuditsList'
import { PageHeader } from '@/components/dashboard/ui'

async function getSession() {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

export default async function AuditsPage() {
  const session = await getSession()

  const sites = await query<{ id: number; domain: string }>(
    `SELECT id, domain FROM sites WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [session.merchantId]
  )
  const canPdf = session.merchantId
    ? (await isSuperadmin(session.merchantId)) || (await hasFeature(session.merchantId, 'pdf_reports'))
    : false

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader icon="✓" title="Accessibility Audits" subtitle="Run an automated WCAG scan across your pages, powered by axe-core." />
      <AuditsList sites={sites} type="accessibility" canPdf={canPdf} />
    </div>
  )
}
