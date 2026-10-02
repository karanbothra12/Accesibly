'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import ErrorReporter from '@/components/ErrorReporter'

export default function AdminShell({
  fullName, email, children,
}: {
  fullName: string
  email: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [open, setOpen] = useState(false)

  async function logout() {
    setLoggingOut(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const initials = fullName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const links = [
    { href: '/admin', label: 'Merchants', icon: '👥', active: pathname === '/admin' || pathname.startsWith('/admin/merchants') },
    { href: '/admin/plans', label: 'Plans & Billing', icon: '💳', active: pathname.startsWith('/admin/plans') },
    { href: '/admin/pages', label: 'Content Pages', icon: '📄', active: pathname.startsWith('/admin/pages') },
    { href: '/admin/errors', label: 'Error Logs', icon: '🐞', active: pathname.startsWith('/admin/errors') },
  ]

  const Inner = (
    <>
      <div className="px-5 py-5 flex items-center justify-between">
        <Link href="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-violet flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-primary/25 group-hover:scale-105 transition-transform">A</div>
          <div>
            <span className="font-semibold text-sm tracking-wide block leading-tight">Accessly</span>
            <span className="text-[11px] text-primary">Superadmin</span>
          </div>
        </Link>
        <button onClick={() => setOpen(false)} className="lg:hidden text-slate-400 hover:text-white text-xl leading-none" aria-label="Close menu">✕</button>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-1">
        <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Platform</p>
        {links.map(l => (
          <Link
            key={l.href}
            href={l.href}
            onClick={() => setOpen(false)}
            className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all
              ${l.active ? 'bg-white/10 text-white font-medium ring-1 ring-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          >
            {l.active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full bg-primary shadow-[0_0_12px_rgba(201,162,39,.7)]" />}
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${l.active ? 'bg-primary text-white' : 'bg-white/5 text-slate-400 group-hover:text-white'}`}>{l.icon}</span>
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-white/5">
        <div className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl bg-white/5 ring-1 ring-white/5">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/30 to-violet/10 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0 ring-1 ring-primary/20">{initials || 'A'}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{fullName}</p>
            <p className="text-xs text-slate-500 truncate">{email}</p>
          </div>
        </div>
        <button onClick={logout} disabled={loggingOut} className="mt-2 w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
          <span className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center">⎋</span>
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </>
  )

  return (
    <div className="flex min-h-screen">
      <ErrorReporter />
      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-sidebar text-white flex items-center justify-between px-4 border-b border-white/10">
        <Link href="/admin" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-violet flex items-center justify-center text-xs font-bold text-white">A</div>
          <span className="font-semibold text-sm">Superadmin</span>
        </Link>
        <button onClick={() => setOpen(true)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/10" aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      </header>

      {/* Mobile drawer */}
      <div className={`lg:hidden fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
        <div onClick={() => setOpen(false)} className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`} />
        <aside className={`absolute left-0 top-0 h-full w-72 max-w-[85%] flex flex-col bg-gradient-to-b from-sidebar to-[#0c1428] text-white shadow-2xl transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          {Inner}
        </aside>
      </div>

      {/* Desktop sidebar — sticky full-height so profile + sign out stay visible */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col h-screen sticky top-0 bg-gradient-to-b from-sidebar to-[#0c1428] text-white border-r border-white/5">
        {Inner}
      </aside>

      <main className="flex-1 dash-bg overflow-auto p-8 pt-20 lg:pt-8">{children}</main>
    </div>
  )
}
