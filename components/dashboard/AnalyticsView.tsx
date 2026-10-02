'use client'

import { useEffect, useState } from 'react'
import AnalyticsPanel from './AnalyticsPanel'

type Site = { id: number; domain: string }

type Data = {
  summary: { pageviews: number; widgetOpens: number }
  daily: { day: string; pageviews: number; widgetOpens: number }[]
  topPages: { path: string; views: number }[]
  siteHealth: {
    siteId: number; domain: string; totalPings: number; successPings: number
    avgMs: number | null; uptimePct: number | null
  }[]
}

const PERIODS: [string, string][] = [
  ['24h', 'Last 24h'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
]

export default function AnalyticsView({ sites, lockedSiteId }: { sites: Site[]; lockedSiteId?: number }) {
  const [period, setPeriod] = useState('7d')
  const [siteId, setSiteId] = useState(lockedSiteId ? String(lockedSiteId) : '')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const qs = new URLSearchParams({ period })
      if (siteId) qs.set('site_id', siteId)
      const res = await fetch(`/api/analytics?${qs.toString()}`)
      if (!res.ok || cancelled) return
      const json = (await res.json()) as Data
      if (!cancelled) {
        setData(json)
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [period, siteId])

  const pageviews = data?.summary.pageviews ?? 0
  const widgetOpens = data?.summary.widgetOpens ?? 0
  const openRate = pageviews > 0 ? Math.round((widgetOpens / pageviews) * 1000) / 10 : 0
  const maxViews = Math.max(...(data?.topPages.map(p => p.views) ?? [1]), 1)

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          {PERIODS.map(([val, label]) => (
            <button
              key={val}
              onClick={() => { setPeriod(val); setLoading(true) }}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                period === val ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {!lockedSiteId && (
          <select
            value={siteId}
            onChange={e => { setSiteId(e.target.value); setLoading(true) }}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
          >
            <option value="">All sites</option>
            {sites.map(s => (
              <option key={s.id} value={s.id}>{s.domain}</option>
            ))}
          </select>
        )}
        {loading && <span className="text-xs text-slate-400">Loading…</span>}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Stat label="Pageviews" value={pageviews.toLocaleString()} tint="bg-blue-50 text-blue-600" icon="👁️" />
        <Stat label="Widget opens" value={widgetOpens.toLocaleString()} tint="bg-primary-lt text-primary" icon="♿" />
        <Stat label="Open rate" value={`${openRate}%`} tint="bg-emerald-50 text-emerald-600" icon="↗" />
      </div>

      {/* Chart */}
      <AnalyticsPanel title="Pageviews & widget opens" daily={data?.daily ?? []} />

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top pages */}
        <div className="ui-card">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Top pages</h2>
          </div>
          {!data || data.topPages.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No pageview data yet.</p>
          ) : (
            <ul className="p-3 space-y-1">
              {data.topPages.map(p => (
                <li key={p.path} className="relative rounded-lg px-3 py-2 overflow-hidden">
                  <div className="absolute inset-y-0 left-0 bg-blue-50 rounded-lg" style={{ width: `${(p.views / maxViews) * 100}%` }} />
                  <div className="relative flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700 truncate font-mono">{p.path}</span>
                    <span className="text-sm font-semibold text-slate-900 shrink-0">{p.views.toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Site health */}
        <div className="ui-card">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">Site health</h2>
          </div>
          {!data || data.siteHealth.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No sites to report on.</p>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                  <th className="px-5 py-2.5 font-medium">Site</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">Uptime</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">Avg latency</th>
                  <th className="px-5 py-2.5 font-medium whitespace-nowrap">Pings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.siteHealth.map(h => (
                  <tr key={h.siteId} className="text-slate-700">
                    <td className="px-5 py-2.5 truncate max-w-[160px]">{h.domain}</td>
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      {h.uptimePct === null ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className={`font-medium ${h.uptimePct >= 99 ? 'text-emerald-600' : h.uptimePct >= 90 ? 'text-amber-600' : 'text-red-600'}`}>
                          {h.uptimePct}%
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2.5 whitespace-nowrap">{h.avgMs === null ? <span className="text-slate-400">—</span> : `${h.avgMs} ms`}</td>
                    <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{h.totalPings.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tint, icon }: { label: string; value: string; tint: string; icon: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 card-elev card-hover">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`} aria-hidden>{icon}</span>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}
