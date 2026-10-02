'use client'

import { useEffect, useState, useCallback } from 'react'

type FeatureDef = { key: string; label: string; description?: string }
type LimitDef = { key: string; label: string; period: string; unit: string }
type Plan = {
  id: number; key: string; name: string; description: string | null
  price_cents: number; price_yearly_cents: number; billing_period: string; is_active: boolean; is_archived: boolean
  page_overage_enabled: boolean; extra_page_price_cents: number; subscribers: number
  features: Record<string, boolean>; limits: Record<string, number>
}
type Catalog = { features: FeatureDef[]; limits: LimitDef[] }
type Settings = Record<string, { value: string; label: string | null }>

const centsToDollars = (v: string | number | undefined) => (((Number(v) || 0)) / 100).toString()

type Draft = {
  id?: number; key: string; name: string; description: string
  priceDollars: string; priceYearlyDollars: string; billing_period: string; is_active: boolean
  page_overage_enabled: boolean; extraPageDollars: string
  features: Record<string, boolean>; limits: Record<string, string>
}

export default function PlanManager() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [catalog, setCatalog] = useState<Catalog>({ features: [], limits: [] })
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [settings, setSettings] = useState<Settings>({})
  const [rumAddon, setRumAddon] = useState('0')
  const [savingSettings, setSavingSettings] = useState(false)

  const applyData = (d: { plans: Plan[]; catalog: Catalog; settings?: Settings }) => {
    setPlans(d.plans); setCatalog(d.catalog)
    setSettings(d.settings || {})
    setRumAddon(centsToDollars(d.settings?.rum_addon_price_cents?.value))
    setLoading(false)
  }

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/plans')
    if (res.ok) applyData(await res.json())
  }, [])
  useEffect(() => {
    let alive = true
    ;(async () => {
      const res = await fetch('/api/admin/plans')
      if (!res.ok || !alive) return
      const d = await res.json()
      if (!alive) return
      applyData(d)
    })()
    return () => { alive = false }
  }, [])

  async function saveSettings() {
    setSavingSettings(true)
    try {
      await fetch('/api/admin/plans', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { rum_addon_price_cents: Math.round(parseFloat(rumAddon || '0') * 100) } }),
      })
      await load()
    } finally { setSavingSettings(false) }
  }

  function newDraft(): Draft {
    return {
      key: '', name: '', description: '', priceDollars: '0', priceYearlyDollars: '0', billing_period: 'monthly', is_active: true,
      page_overage_enabled: false, extraPageDollars: '0',
      features: Object.fromEntries(catalog.features.map(f => [f.key, false])),
      limits: Object.fromEntries(catalog.limits.map(l => [l.key, '0'])),
    }
  }
  function editDraft(p: Plan): Draft {
    return {
      id: p.id, key: p.key, name: p.name, description: p.description || '',
      priceDollars: (p.price_cents / 100).toString(), priceYearlyDollars: ((p.price_yearly_cents || 0) / 100).toString(),
      billing_period: p.billing_period, is_active: p.is_active,
      page_overage_enabled: p.page_overage_enabled, extraPageDollars: (p.extra_page_price_cents / 100).toString(),
      features: Object.fromEntries(catalog.features.map(f => [f.key, !!p.features[f.key]])),
      limits: Object.fromEntries(catalog.limits.map(l => [l.key, String(p.limits[l.key] ?? 0)])),
    }
  }

  async function save() {
    if (!draft) return
    setErr(''); setSaving(true)
    try {
      const payload = {
        id: draft.id,
        key: draft.key, name: draft.name, description: draft.description,
        price_cents: Math.round(parseFloat(draft.priceDollars || '0') * 100),
        price_yearly_cents: Math.round(parseFloat(draft.priceYearlyDollars || '0') * 100),
        billing_period: draft.billing_period, is_active: draft.is_active,
        page_overage_enabled: draft.page_overage_enabled,
        extra_page_price_cents: Math.round(parseFloat(draft.extraPageDollars || '0') * 100),
        features: draft.features,
        limits: Object.fromEntries(Object.entries(draft.limits).map(([k, v]) => [k, parseInt(v || '0', 10)])),
      }
      const res = await fetch('/api/admin/plans', {
        method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Save failed'); return }
      setDraft(null); await load()
    } finally { setSaving(false) }
  }

  async function archive(p: Plan) {
    if (!confirm(`Archive "${p.name}"? Existing subscribers keep it until moved; it won't be offered for new subscriptions.`)) return
    const res = await fetch('/api/admin/plans', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
    if (res.ok) load()
  }
  async function toggleActive(p: Plan) {
    const res = await fetch('/api/admin/plans', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, is_active: !p.is_active }) })
    if (res.ok) load()
  }

  const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: c % 100 ? 2 : 0 })}`

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Plans & Billing</h1>
          <p className="text-slate-500 text-sm mt-1">Create and configure plans, features, limits and overage — no code changes needed.</p>
        </div>
        <button onClick={() => setDraft(newDraft())} className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark shadow-sm shadow-primary/20 transition-colors">+ New plan</button>
      </div>

      {loading ? (
        <div className="ui-card px-6 py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.map(p => (
            <div key={p.id} className={`bg-white rounded-2xl border card-elev p-5 ${p.is_archived ? 'border-slate-200/70 opacity-70' : 'border-slate-200/70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-slate-900">{p.name}</h3>
                  <p className="text-xs text-slate-400 font-mono">{p.key}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${p.is_archived ? 'bg-slate-100 text-slate-500' : p.is_active ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                  {p.is_archived ? 'Archived' : p.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <p className="mt-2 text-2xl font-bold text-slate-900">{money(p.price_cents)}<span className="text-sm font-medium text-slate-400">/mo</span></p>
              <p className="text-xs text-slate-500">{p.price_yearly_cents > 0 ? `${money(p.price_yearly_cents)}/yr` : 'Yearly not offered'}</p>
              <p className="text-xs text-slate-500 mt-2">{Object.values(p.features).filter(Boolean).length} features · {Object.keys(p.limits).length} limits · {p.subscribers} subscriber{p.subscribers === 1 ? '' : 's'}</p>
              <p className="text-xs text-slate-500 mt-1">
                {p.page_overage_enabled ? `Overage: ${money(p.extra_page_price_cents)}/extra page` : 'No overage'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => setDraft(editDraft(p))} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Edit</button>
                {!p.is_archived && <button onClick={() => toggleActive(p)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">{p.is_active ? 'Deactivate' : 'Activate'}</button>}
                {!p.is_archived && <button onClick={() => archive(p)} className="text-xs px-3 py-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50">Archive</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Platform settings — DB-driven config that isn't plan-specific */}
      {!loading && (
        <div className="mt-6 ui-card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Platform settings</h2>
          <p className="text-xs text-slate-400 mt-0.5">Global pricing/config stored in the DB — no deploy needed to change these.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label={settings.rum_addon_price_cents?.label || 'RUM add-on price per active site ($/mo)'}>
              <input type="number" min="0" step="0.01" value={rumAddon} onChange={e => setRumAddon(e.target.value)} className={`${inp} w-48`} />
            </Field>
            <button onClick={saveSettings} disabled={savingSettings} className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50">
              {savingSettings ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </div>
      )}

      {/* Editor modal */}
      {draft && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
          <div className="fixed inset-0 bg-black/50" onClick={() => setDraft(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">{draft.id ? 'Edit plan' : 'New plan'}</h2>
              <button onClick={() => setDraft(null)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Name"><input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={inp} /></Field>
                <Field label="Key (slug)"><input value={draft.key} disabled={!!draft.id} onChange={e => setDraft({ ...draft, key: e.target.value })} className={`${inp} ${draft.id ? 'bg-slate-50 text-slate-400' : ''}`} placeholder="starter" /></Field>
              </div>
              <Field label="Description"><input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} className={inp} /></Field>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Monthly price ($)"><input type="number" min="0" step="0.01" value={draft.priceDollars} onChange={e => setDraft({ ...draft, priceDollars: e.target.value })} className={inp} /></Field>
                <Field label="Yearly price ($) — 0 = yearly not offered"><input type="number" min="0" step="0.01" value={draft.priceYearlyDollars} onChange={e => setDraft({ ...draft, priceYearlyDollars: e.target.value })} className={inp} /></Field>
              </div>
              <p className="-mt-3 text-xs text-slate-400">Subscribers choose monthly or yearly. Overage (extra pages) is always billed monthly.</p>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Features</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {catalog.features.map(f => (
                    <label key={f.key} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={!!draft.features[f.key]} onChange={e => setDraft({ ...draft, features: { ...draft.features, [f.key]: e.target.checked } })} className="accent-primary" />
                      <span className="text-sm text-slate-700">{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Limits <span className="font-normal normal-case text-slate-400">(−1 = unlimited)</span></p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {catalog.limits.map(l => (
                    <Field key={l.key} label={`${l.label}${l.period !== 'none' ? ` / ${l.period}` : ''}`}>
                      <input type="number" step="1" value={draft.limits[l.key] ?? '0'} onChange={e => setDraft({ ...draft, limits: { ...draft.limits, [l.key]: e.target.value } })} className={inp} />
                    </Field>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={draft.page_overage_enabled} onChange={e => setDraft({ ...draft, page_overage_enabled: e.target.checked })} className="accent-primary" />
                  <span className="text-sm font-medium text-slate-800">Allow extra pages (overage)</span>
                </label>
                {draft.page_overage_enabled && (
                  <div className="mt-3">
                    <Field label="Price per extra page ($)"><input type="number" min="0" step="0.001" value={draft.extraPageDollars} onChange={e => setDraft({ ...draft, extraPageDollars: e.target.value })} className={inp} /></Field>
                  </div>
                )}
              </div>

              {err && <p className="text-sm text-red-600">{err}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button onClick={() => setDraft(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
              <button onClick={save} disabled={saving || !draft.name || !draft.key} className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50">{saving ? 'Saving…' : 'Save plan'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inp = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary'
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>{children}</label>
}
