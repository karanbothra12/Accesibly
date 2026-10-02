'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Merchant = { id: number; email: string; full_name: string; plan: string; is_superadmin: boolean; is_active: boolean; created_at: string }
type Site = { id: number; domain: string; site_key: string; is_active: boolean; rum_enabled: boolean; created_at: string; pv30: number; rum30: number; last_ping: string | null }
type Billing = {
  plan: string; planName: string; planMonthlyCents: number; interval: string
  rumSites: number; rumAddonCents: number; mrrCents: number; pv30: number; rum30: number
}

const TABS = ['overview', 'sites', 'billing'] as const
type Tab = typeof TABS[number]

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`

// Stable badge color derived from the plan key — works for any SuperAdmin plan.
const PLAN_TINTS = ['bg-slate-100 text-slate-600', 'bg-blue-50 text-blue-700', 'bg-purple-50 text-purple-700', 'bg-emerald-50 text-emerald-700', 'bg-amber-50 text-amber-700']
function planTint(plan: string) {
  let h = 0
  for (let i = 0; i < plan.length; i++) h = (h * 31 + plan.charCodeAt(i)) >>> 0
  return PLAN_TINTS[h % PLAN_TINTS.length]
}

export default function MerchantDetail({
  currentMerchantId, merchant: initialMerchant, sites: initialSites, billing, plans,
}: {
  currentMerchantId: number
  merchant: Merchant
  sites: Site[]
  billing: Billing
  plans: { id: number; key: string; name: string }[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const [merchant, setMerchant] = useState(initialMerchant)
  const [sites, setSites] = useState(initialSites)
  const [busy, setBusy] = useState(false)

  const isSelf = merchant.id === currentMerchantId
  const rumSites = sites.filter(s => s.rum_enabled && s.is_active).length
  const activeSites = sites.filter(s => s.is_active).length

  async function patchMerchant(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/merchants', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: merchant.id, ...body }),
      })
      const data = await res.json()
      if (res.ok) {
        setMerchant(m => ({ ...m, ...data.merchant }))
        // Re-fetch server-computed billing (plan price/MRR) after a plan change.
        router.refresh()
      } else alert(data.error || 'Action failed')
    } finally { setBusy(false) }
  }

  async function toggleSite(site: Site) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/sites', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: site.id, is_active: !site.is_active }),
      })
      const data = await res.json()
      if (res.ok) setSites(prev => prev.map(s => s.id === site.id ? { ...s, is_active: data.site.is_active } : s))
    } finally { setBusy(false) }
  }

  async function deleteMerchant() {
    if (!confirm(`Delete "${merchant.email}"? This permanently removes all their sites and data.`)) return
    setBusy(true)
    const res = await fetch('/api/admin/merchants', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: merchant.id }),
    })
    if (res.ok) router.push('/admin')
    else setBusy(false)
  }

  const initials = merchant.full_name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
  const planBadge = planTint(merchant.plan)

  return (
    <div className="max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1.5 mb-4">← Merchants</Link>

      {/* Header card */}
      <div className="ui-card p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-violet text-white flex items-center justify-center text-xl font-bold shadow-lg shadow-primary/20">{initials || 'M'}</div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">{merchant.full_name}</h1>
                {merchant.is_superadmin && <span className="text-[10px] bg-yellow-50 text-yellow-700 px-1.5 py-0.5 rounded font-semibold">superadmin</span>}
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${merchant.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {merchant.is_active ? 'Active' : 'Suspended'}
                </span>
              </div>
              <p className="text-sm text-slate-500 mt-0.5">{merchant.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${planBadge}`}>{merchant.plan}</span>
            {!isSelf && !merchant.is_superadmin && (
              <>
                <button
                  onClick={() => patchMerchant({ is_active: !merchant.is_active })}
                  disabled={busy}
                  className={`text-sm px-3.5 py-2 rounded-lg border font-medium disabled:opacity-50 transition-colors
                    ${merchant.is_active ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                >
                  {merchant.is_active ? 'Pause merchant' : 'Resume merchant'}
                </button>
                <button onClick={deleteMerchant} disabled={busy} className="text-sm px-3.5 py-2 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors">Delete</button>
              </>
            )}
          </div>
        </div>
        {!merchant.is_active && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-100 px-4 py-2.5 text-sm text-red-700">
            This merchant is suspended — they cannot log in, and their sites have stopped collecting data.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize -mb-px border-b-2 transition-colors
              ${tab === t ? 'border-primary text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {t === 'sites' ? `Sites (${sites.length})` : t}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Metric label="Plan" value={merchant.plan} />
          <Metric label="Est. MRR" value={`${money(billing.mrrCents)}`} />
          <Metric label="Sites" value={`${activeSites}/${sites.length}`} sub="active / total" />
          <Metric label="RUM sites" value={rumSites} sub="paid add-on" />
          <Metric label="Pageviews (30d)" value={billing.pv30.toLocaleString()} />
          <Metric label="RUM page views (30d)" value={billing.rum30.toLocaleString()} />
          <Metric label="Joined" value={new Date(merchant.created_at).toLocaleDateString()} />
          <Metric label="Status" value={merchant.is_active ? 'Active' : 'Suspended'} valueClass={merchant.is_active ? 'text-emerald-600' : 'text-red-600'} />
        </div>
      )}

      {/* Sites */}
      {tab === 'sites' && (
        <div className="ui-card overflow-hidden">
          {sites.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-slate-400">This merchant has no sites.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-5 py-3 text-left">Domain</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">RUM</th>
                  <th className="px-4 py-3 text-right">Pageviews 30d</th>
                  <th className="px-4 py-3 text-right">RUM 30d</th>
                  <th className="px-4 py-3 text-left">Last ping</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sites.map(s => (
                  <tr key={s.id} onClick={() => router.push(`/admin/merchants/${merchant.id}/sites/${s.id}`)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-slate-900">{s.domain}</div>
                      <div className="text-xs text-slate-400 font-mono">{s.site_key.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{s.is_active ? 'Active' : 'Paused'}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.rum_enabled ? 'bg-primary-lt text-primary' : 'bg-slate-100 text-slate-400'}`}>{s.rum_enabled ? 'On' : 'Off'}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-600">{s.pv30.toLocaleString()}</td>
                    <td className="px-4 py-3.5 text-right text-slate-600">{s.rum30.toLocaleString()}</td>
                    <td className="px-4 py-3.5 text-xs text-slate-500">{s.last_ping ? new Date(s.last_ping).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSite(s) }}
                        disabled={busy}
                        className={`text-xs px-2.5 py-1 rounded-lg border disabled:opacity-50 transition-colors
                          ${s.is_active ? 'border-amber-200 text-amber-700 hover:bg-amber-50' : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'}`}
                      >
                        {s.is_active ? 'Pause' : 'Resume'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}

      {/* Billing */}
      {tab === 'billing' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="ui-card">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Estimated monthly bill</h3>
              {!isSelf && !merchant.is_superadmin && (
                <select
                  value={merchant.plan}
                  onChange={e => patchMerchant({ plan: e.target.value })}
                  disabled={busy}
                  className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {plans.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
              )}
            </div>
            <div className="p-5 space-y-3 text-sm">
              <Line
                label={`${billing.planName} plan${billing.interval === 'yearly' ? ' (billed yearly)' : ''}`}
                value={`${money(billing.planMonthlyCents)}/mo`}
              />
              <Line label={`RUM add-on × ${billing.rumSites} site${billing.rumSites === 1 ? '' : 's'}`} value={`${money(billing.rumAddonCents * billing.rumSites)}/mo`} />
              <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
                <span className="font-semibold text-slate-900">Estimated MRR</span>
                <span className="text-2xl font-bold text-slate-900">{money(billing.mrrCents)}<span className="text-sm font-medium text-slate-400">/mo</span></span>
              </div>
              <p className="text-xs text-slate-400 pt-1">Computed from live plan prices &amp; settings (DB-driven) — no payment provider connected yet.</p>
            </div>
          </div>

          <div className="ui-card">
            <div className="px-5 py-4 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-900">Usage this period (30d)</h3></div>
            <div className="p-5 grid grid-cols-2 gap-4">
              <Metric label="Pageviews" value={billing.pv30.toLocaleString()} />
              <Metric label="RUM page views" value={billing.rum30.toLocaleString()} />
              <Metric label="Active sites" value={activeSites} />
              <Metric label="Billable RUM sites" value={rumSites} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, sub, valueClass = 'text-slate-900' }: { label: string; value: string | number; sub?: string; valueClass?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 card-elev">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tracking-tight mt-1 capitalize ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  )
}
