'use client'

import { useState } from 'react'
import MiniChart, { type Point } from '@/components/dashboard/MiniChart'

// Homepage product showcase — the real interactive dashboard chart (points +
// hover tooltip) with sample data and switchable metrics. `days` comes from the
// server so SSR and client render identical x-axis labels (no hydration drift).
const METRICS = [
  {
    key: 'views', label: 'Page views', type: 'bar' as const, color: '#6366F1',
    format: (v: number) => Math.round(v).toLocaleString(),
    data: [820, 910, 875, 1040, 1120, 990, 760, 1180, 1260, 1210, 1340, 1290, 1410, 1380],
    stat: (d: number[]) => d[d.length - 1].toLocaleString(),
  },
  {
    key: 'load', label: 'Page load', type: 'line' as const, color: '#0ea5e9',
    format: (v: number) => `${(v / 1000).toFixed(2)} s`,
    data: [2900, 2750, 2680, 2810, 2520, 2400, 2460, 2300, 2210, 2180, 2050, 2120, 1980, 1940],
    stat: (d: number[]) => `${(d[d.length - 1] / 1000).toFixed(2)} s`,
  },
  {
    key: 'lcp', label: 'LCP', type: 'line' as const, color: '#3b82f6',
    format: (v: number) => `${(v / 1000).toFixed(2)} s`,
    data: [2600, 2540, 2480, 2510, 2350, 2280, 2320, 2200, 2120, 2080, 1990, 2040, 1910, 1880],
    stat: (d: number[]) => `${(d[d.length - 1] / 1000).toFixed(2)} s`,
  },
]

export default function LiveChartDemo({ days }: { days: string[] }) {
  const [active, setActive] = useState('views')
  const m = METRICS.find(x => x.key === active) || METRICS[0]
  const points: Point[] = days.map((d, i) => ({ x: d, y: m.data[i] ?? null }))
  const first = m.data[0], last = m.data[m.data.length - 1]
  const deltaPct = Math.round(((last - first) / first) * 100)
  const goodDown = m.key !== 'views' // for perf metrics, down is good
  const positive = m.key === 'views' ? deltaPct >= 0 : deltaPct <= 0

  return (
    <div className="rounded-3xl border border-slate-200 shadow-xl bg-white overflow-hidden">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 pt-5 pb-4 border-b border-slate-100">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{m.label} · last 14 days</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-3xl font-bold text-slate-900">{m.stat(m.data)}</span>
            <span className={`text-sm font-semibold ${positive ? 'text-emerald-600' : 'text-red-500'}`}>
              {deltaPct > 0 ? '+' : ''}{deltaPct}%{goodDown ? ' faster' : ''}
            </span>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          {METRICS.map(x => (
            <button
              key={x.key}
              onClick={() => setActive(x.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${active === x.key ? 'bg-white shadow-sm text-slate-900 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {/* chart */}
      <div className="p-3">
        <MiniChart title="" points={points} type={m.type} color={m.color} format={m.format} />
        <p className="text-center text-xs text-slate-400 pb-1">Hover the chart to inspect any point</p>
      </div>
    </div>
  )
}
