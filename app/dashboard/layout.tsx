import { cookies } from 'next/headers'
import { getIronSession } from 'iron-session'
import { redirect } from 'next/navigation'
import { SessionData, SESSION_OPTIONS } from '@/lib/session'
import { queryOne } from '@/lib/db'
import Sidebar from '@/components/Sidebar'
import ErrorReporter from '@/components/ErrorReporter'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const session = await getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)

  if (!session.isLoggedIn) redirect('/login')
  if (session.isSuperadmin) redirect('/admin')

  // Enforce merchant suspension on live sessions (superadmin can pause a merchant).
  const acct = await queryOne<{ is_active: boolean }>(
    'SELECT is_active FROM merchants WHERE id = $1',
    [session.merchantId]
  )
  if (!acct || acct.is_active === false) {
    await session.destroy()
    redirect('/login?suspended=1')
  }

  const initials = (session.fullName ?? '').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <div className="flex min-h-screen">
      <ErrorReporter />
      <Sidebar fullName={session.fullName ?? ''} email={session.email ?? ''} />
      <main className="flex-1 dash-bg overflow-auto min-h-screen pt-14 lg:pt-0">
        {/* Desktop top bar */}
        <div className="hidden lg:flex sticky top-0 z-30 h-16 items-center justify-between gap-4 px-8 bg-white/70 backdrop-blur-xl border-b border-slate-200/70">
          <div className="relative w-full max-w-sm">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden>⌕</span>
            <input
              placeholder="Search sites, audits, pages…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-slate-100/80 border border-transparent focus:bg-white focus:border-primary/40 focus:ring-2 focus:ring-primary/15 text-sm outline-none transition-all placeholder:text-slate-400"
            />
          </div>
          <div className="flex items-center gap-2.5">
            <a href="/dashboard/audits" className="px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-dark shadow-sm shadow-primary/25 transition-colors whitespace-nowrap">+ New audit</a>
            <a href="/settings" className="relative w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors" aria-label="Notifications">
              <span aria-hidden>🔔</span>
              <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
            </a>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet flex items-center justify-center text-white text-xs font-bold" title={session.fullName ?? ''}>{initials || 'A'}</div>
          </div>
        </div>
        {children}
      </main>
    </div>
  )
}
