import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { redirect } from 'next/navigation'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { queryOne } from '@/lib/db'
import AdminShell from '@/components/admin/AdminShell'
import PlanManager from '@/components/admin/PlanManager'

export default async function AdminPlansPage() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
  if (!session.isLoggedIn || !session.merchantId) redirect('/login')
  const me = await queryOne<{ is_superadmin: boolean }>('SELECT is_superadmin FROM merchants WHERE id = $1', [session.merchantId])
  if (!me?.is_superadmin) redirect('/dashboard')

  return (
    <AdminShell fullName={session.fullName ?? ''} email={session.email ?? ''}>
      <PlanManager />
    </AdminShell>
  )
}
