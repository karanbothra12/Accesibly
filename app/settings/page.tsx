import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { redirect } from 'next/navigation'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import Sidebar from '@/components/Sidebar'
import SettingsForm from '@/components/SettingsForm'
import NotificationSettings from '@/components/dashboard/NotificationSettings'
import { PageHeader } from '@/components/dashboard/ui'

export default async function SettingsPage() {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)

  if (!session.isLoggedIn) redirect('/login')

  return (
    <div className="flex min-h-screen">
      <Sidebar fullName={session.fullName ?? ''} email={session.email ?? ''} />
      <main className="flex-1 dash-bg overflow-auto p-8 pt-20 lg:pt-8">
        <div className="max-w-2xl mx-auto">
          <PageHeader icon="⚙" title="Account Settings" subtitle="Update your profile and password." />
          <SettingsForm initialName={session.fullName ?? ''} email={session.email ?? ''} />
          <NotificationSettings />
        </div>
      </main>
    </div>
  )
}
