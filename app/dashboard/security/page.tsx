import Link from 'next/link'
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

export default async function SecurityAuditsPage() {
  const session = await getSession()

  const superadmin = session.merchantId ? await isSuperadmin(session.merchantId) : false
  const allowed = superadmin || (session.merchantId ? await hasFeature(session.merchantId, 'security_audit') : false)
  const canPdf = superadmin || (session.merchantId ? await hasFeature(session.merchantId, 'pdf_reports') : false)

  const sites = await query<{ id: number; domain: string }>(
    `SELECT id, domain FROM sites WHERE merchant_id = $1 ORDER BY created_at DESC`,
    [session.merchantId]
  )

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <PageHeader icon="🛡" title="Security & Headers" subtitle="Check TLS and HTTP security headers against IETF/OWASP guidance — HSTS, CSP, framing, certificate health and more." />

      {allowed ? (
        <AuditsList sites={sites} type="security" canPdf={canPdf} />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-teal-50 mx-auto flex items-center justify-center text-3xl mb-4">🛡</div>
          <h2 className="text-lg font-semibold text-slate-900">Security &amp; Headers isn&apos;t on your plan yet</h2>
          <p className="text-slate-500 text-sm mt-1 max-w-md mx-auto">
            Upgrade to grade your site&apos;s TLS certificate and HTTP security headers (HSTS, CSP, X-Frame-Options and more) against current best practice.
          </p>
          <Link href="/dashboard/billing" className="mt-5 inline-block px-5 py-2.5 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors">
            View plans
          </Link>
        </div>
      )}
    </div>
  )
}
