'use client'

import { useEffect, useState } from 'react'

type Site = { id: number; domain: string }
type Stats = {
  opens: number; toolClicks: number; uniqueTools: number
  byTool: { tool: string; label: string; count: number }[]
  daily: { day: string; opens: number; clicks: number }[]
}
const PERIODS: { key: string; label: string }[] = [
  { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' },
]

export default function WidgetInsights({ sites, lockedSiteId }: { sites: Site[]; lockedSiteId?: number }) {
  const [siteId, setSiteId] = useState<number | null>(lockedSiteId ?? sites[0]?.id ?? null)
  const [period, setPeriod] = useState('30d')
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!siteId) return
    let alive = true
    ;(async () => {
      const r = await fetch(`/api/widget-stats?site_id=${siteId}&period=${period}`)
      if (!alive) return
      if (r.ok) { const d = await r.json(); if (alive) setData(d) }
      if (alive) setLoading(false)
    })()
    return () => { alive = false }
  }, [siteId, period])

  const maxTool = data ? Math.max(1, ...data.byTool.map(t => t.count)) : 1

  if (sites.length === 0) {
    return <div className="ui-card px-6 py-10 text-center text-sm text-slate-400">Add a site to see widget usage.</div>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-900">Accessibility widget usage</h2>
          <p className="text-sm text-slate-500">How many visitors open the widget and which tools they use — so you can prioritize.</p>
        </div>
        <div className="flex items-center gap-2">
          {!lockedSiteId && sites.length > 1 && (
            <select value={siteId ?? ''} onChange={e => setSiteId(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40">
              {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
            </select>
          )}
          <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-white">
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${period === p.key ? 'bg-primary text-white font-medium' : 'text-slate-500 hover:text-slate-800'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="ui-card h-64 animate-pulse" />
      ) : !data || (data.opens === 0 && data.toolClicks === 0) ? (
        <div className="ui-card px-6 py-14 text-center">
          <div className="w-12 h-12 rounded-2xl tint-indigo mx-auto flex items-center justify-center text-xl mb-3">👀</div>
          <p className="text-sm font-medium text-slate-700">No widget interactions yet</p>
          <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">Once visitors open the accessibility widget on your site and adjust settings, their usage shows up here.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* KPI column */}
          <div className="space-y-4">
            <Kpi icon="👀" tint="tint-indigo" label="Widget opens" value={data.opens.toLocaleString()}
              sub={`avg ${data.opens ? (data.toolClicks / data.opens).toFixed(1) : '0'} tools / open`} />
            <Kpi icon="👆" tint="tint-violet" label="Tool clicks" value={data.toolClicks.toLocaleString()} />
            <Kpi icon="🎨" tint="tint-teal" label="Distinct tools used" value={data.uniqueTools.toLocaleString()} />
          </div>

          {/* Ranked tools */}
          <div className="lg:col-span-2 ui-card p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Most-used tools</h3>
              <span className="text-xs text-slate-400">{data.toolClicks.toLocaleString()} clicks</span>
            </div>
            {data.byTool.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">Visitors opened the widget but didn&apos;t change any settings yet.</p>
            ) : (
              <ul className="space-y-3.5">
                {data.byTool.map((t, i) => {
                  const pct = data.toolClicks ? Math.round((t.count / data.toolClicks) * 100) : 0
                  const barPct = Math.max(4, Math.round((t.count / maxTool) * 100))
                  const top = i < 3
                  return (
                    <li key={t.tool} className="flex items-center gap-3.5">
                      <span className={`w-6 h-6 shrink-0 rounded-lg flex items-center justify-center text-xs font-bold
                        ${top ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2 mb-1.5">
                          <span className="text-sm font-medium text-slate-700 truncate">{t.label}</span>
                          <span className="shrink-0 text-sm tabular-nums"><span className="font-semibold text-slate-900">{t.count.toLocaleString()}</span> <span className="text-slate-400 text-xs">· {pct}%</span></span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`h-full rounded-full ${top ? 'bg-gradient-to-r from-primary to-violet' : 'bg-primary/35'}`} style={{ width: `${barPct}%` }} />
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, tint, label, value, sub }: { icon: string; tint: string; label: string; value: string; sub?: string }) {
  return (
    <div className="ui-card p-5 flex items-center gap-4">
      <span className={`w-12 h-12 shrink-0 rounded-2xl flex items-center justify-center text-xl ${tint}`} aria-hidden>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold tracking-tight text-slate-900 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}
