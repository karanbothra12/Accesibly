'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import AdminShell from './AdminShell'

type Merchant = {
  id: number; email: string; full_name: string; plan: string
  is_superadmin: boolean; is_active: boolean; created_at: string; siteCount: number
}

// Stable badge color derived from the plan key — works for any SuperAdmin plan.
const PLAN_TINTS = ['bg-slate-100 text-slate-600', 'bg-blue-50 text-blue-700', 'bg-purple-50 text-purple-700', 'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700']
const planBadge = (plan: string) => {
  let h = 0
  for (let i = 0; i < plan.length; i++) h = (h * 31 + plan.charCodeAt(i)) >>> 0
  return PLAN_TINTS[h % PLAN_TINTS.length]
}

export default function AdminDashboard({
  currentMerchantId, fullName, email, stats, plans, merchants: initialMerchants,
}: {
  currentMerchantId: number
  fullName: string
  email: string
  stats: { merchants: number; sites: number; pageviews30d: number; mrr: number }
  plans: { id: number; key: string; name: string }[]
  merchants: Merchant[]
}) {
  const router = useRouter()
  const [merchants, setMerchants] = useState(initialMerchants)
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [q, setQ] = useState('')

  async function patch(id: number, body: Record<string, unknown>) {
    setLoadingId(id)
    try {
      const res = await fetch('/api/admin/merchants', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const data = await res.json()
      if (res.ok) setMerchants(prev => prev.map(m => m.id === id ? { ...m, ...data.merchant } : m))
    } finally { setLoadingId(null) }
  }

  async function deleteMerchant(id: number, mEmail: string) {
    if (!confirm(`Delete account "${mEmail}"? This permanently removes all their sites and data.`)) return
    setLoadingId(id)
    try {
      const res = await fetch('/api/admin/merchants', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      })
      if (res.ok) setMerchants(prev => prev.filter(m => m.id !== id))
    } finally { setLoadingId(null) }
  }

  const filtered = merchants.filter(m =>
    !q || m.full_name.toLowerCase().includes(q.toLowerCase()) || m.email.toLowerCase().includes(q.toLowerCase())
  )

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <AdminShell fullName={fullName} email={email}>
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Platform Overview</h1>
          <p className="text-slate-500 text-sm mt-1">Every merchant, their sites and billing — click a merchant to drill in.</p>
        </div>

        {/* Platform stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Merchants" value={stats.merchants} icon="👥" tint="bg-blue-50 text-blue-600" />
          <StatCard label="Sites" value={stats.sites} icon="🌐" tint="bg-emerald-50 text-emerald-600" />
          <StatCard label="Pageviews (30d)" value={stats.pageviews30d.toLocaleString()} icon="👁️" tint="bg-primary-lt text-primary" />
          <StatCard label="Est. MRR" value={`$${stats.mrr.toLocaleString()}`} icon="💳" tint="bg-purple-50 text-purple-600" />
        </div>

        {/* Merchants */}
        <div className="ui-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Merchants ({filtered.length})</h2>
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search name or email…"
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-5 py-3 text-left">Merchant</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">Sites</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(m => (
                <tr
                  key={m.id}
                  onClick={() => router.push(`/admin/merchants/${m.id}`)}
                  className="hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{m.full_name}</span>
                      {m.is_superadmin && <span className="text-[10px] bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded font-semibold">superadmin</span>}
                    </div>
                    <div className="text-xs text-slate-500">{m.email}</div>
                  </td>
                  <td className="px-4 py-3.5" onClick={stop}>
                    {m.id === currentMerchantId ? (
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${planBadge(m.plan)}`}>{m.plan}</span>
                    ) : (
                      <select
                        value={m.plan}
                        onChange={e => patch(m.id, { plan: e.target.value })}
                        disabled={loadingId === m.id}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        {plans.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{m.siteCount}</td>
                  <td className="px-4 py-3.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                      {m.is_active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap" onClick={stop}>
                    <button
                      onClick={() => router.push(`/admin/merchants/${m.id}`)}
                      className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors mr-1.5"
                    >
                      View
                    </button>
                    {m.id !== currentMerchantId && !m.is_superadmin && (
                      <>
                        <button
                          onClick={() => patch(m.id, { is_active: !m.is_active })}
                          disabled={loadingId === m.id}
                          className={`text-xs px-2.5 py-1 rounded-lg border disabled:opacity-50 transition-colors mr-1.5
                            ${m.is_active ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                        >
                          {m.is_active ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => deleteMerchant(m.id, m.email)}
                          disabled={loadingId === m.id}
                          className="text-xs px-2.5 py-1 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {filtered.length === 0 && <p className="px-5 py-10 text-center text-sm text-slate-400">No merchants match “{q}”.</p>}
        </div>
      </div>
    </AdminShell>
  )
}

function StatCard({ label, value, icon, tint }: { label: string; value: string | number; icon: string; tint: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 card-elev card-hover">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm ${tint}`} aria-hidden>{icon}</span>
      </div>
      <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    </div>
  )
}
