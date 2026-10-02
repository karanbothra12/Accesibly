'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

const navGroups: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  {
    label: 'Main',
    items: [
      { href: '/dashboard', label: 'Overview', icon: '◈' },
      { href: '/dashboard/sites', label: 'Sites', icon: '⊞' },
      { href: '/dashboard/install', label: 'Install', icon: '⚡' },
      { href: '/dashboard/analytics', label: 'Analytics', icon: '↗' },
      { href: '/dashboard/rum', label: 'Monitoring', icon: '◍' },
    ],
  },
  {
    label: 'Audits',
    items: [
      { href: '/dashboard/audits', label: 'Accessibility', icon: '✓' },
      { href: '/dashboard/seo', label: 'SEO', icon: '🔍' },
      { href: '/dashboard/html', label: 'HTML', icon: '⟨⟩' },
      { href: '/dashboard/css', label: 'CSS', icon: '❏' },
      { href: '/dashboard/links', label: 'Broken Links', icon: '🔗' },
      { href: '/dashboard/security', label: 'Security', icon: '🛡' },
      { href: '/dashboard/competitor', label: 'Competitor', icon: '⚔' },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/dashboard/billing', label: 'Plan & Usage', icon: '◔' },
      { href: '/settings', label: 'Settings', icon: '⚙' },
    ],
  },
]

export default function Sidebar({ fullName, email }: { fullName: string; email: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)
  const [open, setOpen] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  const initials = fullName.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(href + '/')

  const Inner = (
    <>
      <div className="px-5 py-5 flex items-center justify-between">
        <Link href="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary to-violet flex items-center justify-center text-base font-bold text-white shadow-lg shadow-primary/30 group-hover:scale-105 transition-transform">A</div>
          <span className="font-bold text-[15px] tracking-tight text-slate-900">Accessly</span>
        </Link>
        <button onClick={() => setOpen(false)} className="lg:hidden text-slate-400 hover:text-slate-700 text-xl leading-none" aria-label="Close menu">✕</button>
      </div>

      <nav className="flex-1 px-4 py-2 space-y-6 overflow-y-auto">
        {navGroups.map(group => (
          <div key={group.label}>
            <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{group.label}</p>
            <div className="space-y-1">
              {group.items.map(item => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`nav-pill group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm
                      ${active ? 'nav-pill-active' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors
                      ${active ? 'bg-primary text-white shadow-sm shadow-primary/30' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'}`}>{item.icon}</span>
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-slate-100">
        <div className="flex items-center gap-3 px-2.5 py-2.5 rounded-2xl bg-slate-50">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-violet flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{initials || 'A'}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{fullName}</p>
            <p className="text-xs text-slate-400 truncate">{email}</p>
          </div>
        </div>
        <button onClick={handleLogout} disabled={loggingOut} className="mt-2 w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors">
          <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">⎋</span>
          {loggingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-40 h-14 bg-white text-slate-900 flex items-center justify-between px-4 border-b border-slate-200">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-violet flex items-center justify-center text-xs font-bold text-white">A</div>
          <span className="font-bold text-sm">Accessly</span>
        </Link>
        <button onClick={() => setOpen(true)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100" aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      </header>

      {/* Mobile drawer */}
      <div className={`lg:hidden fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
        <div onClick={() => setOpen(false)} className={`absolute inset-0 bg-slate-900/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`} />
        <aside className={`absolute left-0 top-0 h-full w-72 max-w-[85%] flex flex-col bg-white shadow-2xl transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          {Inner}
        </aside>
      </div>

      {/* Desktop sidebar — sticky, light, modern */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col h-screen sticky top-0 bg-white border-r border-slate-200">
        {Inner}
      </aside>
    </>
  )
}
