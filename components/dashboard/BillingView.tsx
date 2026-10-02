'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader } from './ui'

type Feature = { key: string; label: string; enabled: boolean }
type Limit = {
  key: string
  label: string
  period: string
  unit: string
  value: number
  unlimited: boolean
  used: number | null
  remaining: number | null
}
type Plan = {
  key: string; name: string; description: string | null; currency: string
  priceMonthlyCents: number; priceYearlyCents: number
  yearlyOffered: boolean; yearlySavingsPct: number
  billingInterval: 'monthly' | 'yearly'; overageBilling: 'monthly'
}
type AvailablePlan = {
  key: string; name: string; description: string | null; currency: string
  priceMonthlyCents: number; priceYearlyCents: number
  yearlyOffered: boolean; yearlySavingsPct: number
  features: { key: string; label: string }[]
  current: boolean
}
type Usage = {
  plan: Plan
  features: Feature[]
  limits: Limit[]
  overage: { enabled: boolean; pricePerPage: number }
  availablePlans: AvailablePlan[]
}

function money(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100)
}

function periodLabel(p: string) {
  if (p === 'day') return 'per day'
  if (p === 'month') return 'per month'
  return 'total'
}

function UsageBar({ used, value, unlimited }: { used: number; value: number; unlimited: boolean }) {
  if (unlimited) {
    return (
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full w-full bg-gradient-to-r from-emerald-400/40 to-emerald-500/40" />
      </div>
    )
  }
  const pct = value <= 0 ? 0 : Math.min(100, Math.round((used / value) * 100))
  const tone =
    pct >= 100 ? 'from-rose-500 to-red-600'
      : pct >= 80 ? 'from-amber-400 to-orange-500'
        : 'from-primary to-violet'
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
      <div className={`h-full rounded-full bg-gradient-to-r ${tone} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function BillingView() {
  const [data, setData] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/usage')
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || `Request failed (${r.status})`)
        return r.json()
      })
      .then((d: Usage) => { if (alive) { setData(d); setLoading(false) } })
      .catch(e => { if (alive) { setError(e.message); setLoading(false) } })
    return () => { alive = false }
  }, [])

  async function switchInterval(interval: 'monthly' | 'yearly') {
    if (!data || switching || data.plan.billingInterval === interval) return
    setSwitching(true)
    // Optimistic update; revert on failure.
    const prev = data.plan.billingInterval
    setData({ ...data, plan: { ...data.plan, billingInterval: interval } })
    try {
      const r = await fetch('/api/usage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingInterval: interval }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      setData(cur => cur ? { ...cur, plan: { ...cur.plan, billingInterval: d.billingInterval } } : cur)
    } catch {
      setData(cur => cur ? { ...cur, plan: { ...cur.plan, billingInterval: prev } } : cur)
    } finally {
      setSwitching(false)
    }
  }

  const [changingPlan, setChangingPlan] = useState<string | null>(null)
  async function switchPlan(planKey: string) {
    if (!data || changingPlan || planKey === data.plan.key) return
    if (!confirm(`Switch to the ${planKey} plan? Your limits and features update immediately.`)) return
    setChangingPlan(planKey)
    try {
      const r = await fetch('/api/usage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed')
      // Re-fetch the full usage snapshot so limits/features/plans all refresh.
      const fresh = await fetch('/api/usage').then(x => x.json())
      setData(fresh)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not change plan')
    } finally {
      setChangingPlan(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-32 rounded-2xl bg-slate-100 animate-pulse" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map(i => <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card className="p-6">
        <p className="text-sm text-rose-600">Could not load plan &amp; usage{error ? `: ${error}` : ''}.</p>
      </Card>
    )
  }

  const { plan, features, limits, overage } = data
  const isYearly = plan.billingInterval === 'yearly'
  const priceCents = isYearly ? plan.priceYearlyCents : plan.priceMonthlyCents
  const perLabel = isYearly ? 'per year' : 'per month'
  // What a year costs monthly vs. yearly, to show the saving.
  const yearlyEquivMonthly = plan.priceMonthlyCents * 12

  return (
    <div className="space-y-6">
      {/* Plan summary */}
      <div className="rounded-2xl bg-gradient-to-br from-sidebar to-[#0c1428] text-white p-6 card-elev overflow-hidden relative">
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-primary/10 blur-2xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-1">Current plan</p>
            <h2 className="text-2xl font-bold tracking-tight">{plan.name}</h2>
            {plan.description && <p className="text-slate-300 text-sm mt-1 max-w-md">{plan.description}</p>}
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold tracking-tight">{money(priceCents, plan.currency)}</p>
            <p className="text-xs text-slate-400 mt-0.5">{perLabel}</p>
            {isYearly && yearlyEquivMonthly > plan.priceYearlyCents && (
              <p className="text-[11px] text-emerald-300 mt-0.5">
                vs. {money(yearlyEquivMonthly, plan.currency)} billed monthly
              </p>
            )}
          </div>
        </div>

        {/* Billing cadence toggle */}
        {plan.yearlyOffered && (
          <div className="relative mt-5 flex items-center gap-3 flex-wrap">
            <div className="inline-flex rounded-lg bg-white/10 p-0.5 ring-1 ring-white/10">
              {(['monthly', 'yearly'] as const).map(iv => (
                <button
                  key={iv}
                  onClick={() => switchInterval(iv)}
                  disabled={switching}
                  className={`px-3.5 py-1.5 text-sm rounded-md transition-colors disabled:opacity-60
                    ${plan.billingInterval === iv ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-300 hover:text-white'}`}
                >
                  {iv === 'monthly' ? 'Monthly' : 'Yearly'}
                </button>
              ))}
            </div>
            {plan.yearlySavingsPct > 0 && (
              <span className="text-xs font-medium text-emerald-300">Save {plan.yearlySavingsPct}% paying yearly</span>
            )}
          </div>
        )}
        <p className="relative mt-3 text-[11px] text-slate-400">
          Extra pages beyond your plan limit are billed <span className="text-slate-200 font-medium">monthly</span> as overage, separately from your {isYearly ? 'annual' : 'monthly'} plan fee.
        </p>
      </div>

      {/* Usage limits */}
      <div>
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Usage this period</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {limits.map(l => {
            const used = l.used ?? 0
            const showBar = l.used != null
            return (
              <div key={l.key} className="bg-white rounded-2xl border border-slate-200/70 p-5 card-elev">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{l.label}</p>
                  <span className="text-[10px] font-medium text-slate-400">{periodLabel(l.period)}</span>
                </div>
                <div className="flex items-baseline gap-1.5 mb-3">
                  {l.used != null
                    ? <><span className="text-2xl font-bold tracking-tight text-slate-900">{used}</span>
                      <span className="text-sm text-slate-400">/ {l.unlimited ? '∞' : l.value} {l.unit}</span></>
                    : <><span className="text-2xl font-bold tracking-tight text-slate-900">{l.unlimited ? '∞' : l.value}</span>
                      <span className="text-sm text-slate-400">{l.unit}</span></>}
                </div>
                {showBar && <UsageBar used={used} value={l.value} unlimited={l.unlimited} />}
                {showBar && !l.unlimited && (
                  <p className="text-xs text-slate-400 mt-2">
                    {l.remaining != null && l.remaining <= 0
                      ? <span className="text-rose-600 font-medium">Limit reached</span>
                      : `${l.remaining} remaining`}
                  </p>
                )}
                {l.unlimited && <p className="text-xs text-emerald-600 mt-2 font-medium">Unlimited</p>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Features + Overage */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Plan features" />
          <ul className="divide-y divide-slate-100">
            {features.map(f => (
              <li key={f.key} className="flex items-center justify-between px-5 py-3">
                <span className={`text-sm ${f.enabled ? 'text-slate-800' : 'text-slate-400'}`}>{f.label}</span>
                {f.enabled
                  ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2.5 py-1">✓ Included</span>
                  : <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 bg-slate-50 rounded-full px-2.5 py-1">Not included</span>}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Overage" />
          <div className="p-5">
            {overage.enabled ? (
              <>
                <p className="text-2xl font-bold tracking-tight text-slate-900">
                  {money(Math.round(overage.pricePerPage * 100), plan.currency)}
                  <span className="text-sm font-normal text-slate-400"> / extra page</span>
                </p>
                <p className="text-sm text-slate-500 mt-2">
                  When an audit exceeds your plan&apos;s page limit, you can authorize extra pages per audit at this rate. Overage is <span className="font-medium text-slate-700">billed monthly</span> and your plan limit is never permanently changed.
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                Overage is not enabled on your plan. Audits are capped at your plan&apos;s page limit.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Available plans — self-serve upgrade/downgrade */}
      {data.availablePlans && data.availablePlans.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Available plans</h3>
          <div className={`grid gap-4 ${data.availablePlans.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            {data.availablePlans.map(pl => {
              const isCurrent = pl.current
              return (
                <div key={pl.key} className={`rounded-2xl border p-5 flex flex-col ${isCurrent ? 'border-primary ring-1 ring-primary/20 bg-primary-lt/20' : 'border-slate-200/70 bg-white'} card-elev`}>
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-slate-900">{pl.name}</h4>
                    {isCurrent && <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-white px-2 py-0.5 rounded-full ring-1 ring-primary/20">Current</span>}
                  </div>
                  {pl.description && <p className="text-xs text-slate-500 mt-0.5">{pl.description}</p>}
                  <div className="mt-3">
                    <span className="text-2xl font-bold tracking-tight text-slate-900">{money(pl.priceMonthlyCents, pl.currency)}</span>
                    <span className="text-sm text-slate-400">/mo</span>
                  </div>
                  {pl.yearlyOffered && (
                    <p className="text-[11px] text-slate-500 mt-0.5">or {money(pl.priceYearlyCents, pl.currency)}/yr{pl.yearlySavingsPct > 0 ? ` · save ${pl.yearlySavingsPct}%` : ''}</p>
                  )}
                  <ul className="mt-3 space-y-1.5 flex-1">
                    {pl.features.slice(0, 6).map(f => (
                      <li key={f.key} className="flex items-start gap-1.5 text-xs text-slate-600"><span className="text-emerald-500 mt-0.5">✓</span>{f.label}</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => switchPlan(pl.key)}
                    disabled={isCurrent || changingPlan !== null}
                    className={`mt-4 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60
                      ${isCurrent ? 'bg-slate-100 text-slate-400 cursor-default' : 'bg-primary text-white hover:bg-primary-dark'}`}
                  >
                    {isCurrent ? 'Current plan' : changingPlan === pl.key ? 'Switching…' : 'Switch to this plan'}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-slate-400">Plan changes take effect immediately. Payment is not collected yet — billing integration is coming soon.</p>
        </div>
      )}
    </div>
  )
}
