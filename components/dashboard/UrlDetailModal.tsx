'use client'

import { useEffect, useState } from 'react'
import MiniChart, { type Point } from './MiniChart'

type Attr = { label: unknown; pageViews: number; lcp: number | null; inp: number | null; cls: number | null }
type Data = {
  path: string
  summary: { pageViews: number; lcp: number | null; inp: number | null; cls: number | null; loadTime: number | null }
  series: { bucket: string; pageViews: number; lcp: number | null; inp: number | null; cls: number | null }[]
  byDevice: Attr[]; byBrowser: Attr[]; byOs: Attr[]; byCountry: Attr[]; byConnection: Attr[]
}

const ms = (v: number | null) => v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`
const cls = (v: number | null) => v == null ? '—' : v.toFixed(3)
const METRICS = [
  { key: 'lcp' as const, label: 'LCP', color: '#3b82f6', fmt: ms, thr: [2500, 4000] },
  { key: 'inp' as const, label: 'INP', color: '#f59e0b', fmt: ms, thr: [200, 500] },
  { key: 'cls' as const, label: 'CLS', color: '#ec4899', fmt: cls, thr: [0.1, 0.25] },
]
const rate = (v: number | null, thr: number[]) => v == null ? 'text-slate-500' : v <= thr[0] ? 'text-emerald-600' : v <= thr[1] ? 'text-amber-600' : 'text-red-600'

export default function UrlDetailModal({ siteId, path, period, onClose }: { siteId: string; path: string; period: string; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [metric, setMetric] = useState<'lcp' | 'inp' | 'cls'>('lcp')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const qs = new URLSearchParams({ path, period })
      if (siteId) qs.set('site_id', siteId)
      const res = await fetch(`/api/rum/url?${qs}`)
      if (!res.ok || cancelled) return
      const json = await res.json()
      if (!cancelled) setData(json)
    })()
    return () => { cancelled = true }
  }, [siteId, path, period])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const m = METRICS.find(x => x.key === metric)!
  const fx = (x: string) => { const d = new Date(x); return isNaN(d.getTime()) ? x : period === '24h' ? `${String(d.getHours()).padStart(2, '0')}:00` : `${d.getMonth() + 1}/${d.getDate()}` }
  const points: Point[] = (data?.series || []).map(r => ({ x: r.bucket, y: r[metric] }))

  const attrBlocks: { title: string; rows: Attr[] }[] = data ? [
    { title: 'Device', rows: data.byDevice }, { title: 'Browser', rows: data.byBrowser }, { title: 'OS', rows: data.byOs },
    { title: 'Country', rows: data.byCountry }, { title: 'Network', rows: data.byConnection },
  ] : []

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-4">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Web Vitals · URL detail</p>
            <h2 className="text-base font-bold text-slate-900 truncate font-mono">{path}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600" aria-label="Close">✕</button>
        </div>

        {!data ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">Loading…</div>
        ) : (
          <div className="p-6 space-y-6">
            {/* Summary chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Chip label="Page views" value={data.summary.pageViews.toLocaleString()} />
              <Chip label="LCP (p75)" value={ms(data.summary.lcp)} valueClass={rate(data.summary.lcp, [2500, 4000])} />
              <Chip label="INP (p75)" value={ms(data.summary.inp)} valueClass={rate(data.summary.inp, [200, 500])} />
              <Chip label="CLS (p75)" value={cls(data.summary.cls)} valueClass={rate(data.summary.cls, [0.1, 0.25])} />
            </div>

            {/* Metric chart */}
            <div>
              <div className="flex gap-1.5 mb-3">
                {METRICS.map(x => (
                  <button key={x.key} onClick={() => setMetric(x.key)}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${metric === x.key ? 'text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    style={metric === x.key ? { background: x.color } : undefined}>{x.label} over time</button>
                ))}
              </div>
              <MiniChart title="" points={points} color={m.color} format={m.fmt} formatX={fx} />
            </div>

            {/* By attribute */}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">{m.label} by attribute</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {attrBlocks.map(b => (
                  <div key={b.title} className="rounded-xl border border-slate-200/70">
                    <p className="px-3 py-2 text-xs font-semibold text-slate-500 border-b border-slate-100">{b.title}</p>
                    {b.rows.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-slate-400 text-center">No data</p>
                    ) : (
                      <ul className="p-1">
                        {b.rows.slice(0, 5).map((r, i) => (
                          <li key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
                            <span className="text-slate-600 truncate capitalize">{String(r.label)}</span>
                            <span className={`font-semibold shrink-0 ${rate(r[metric], m.thr)}`}>{m.fmt(r[metric])}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ label, value, valueClass = 'text-slate-900' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 p-3">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${valueClass}`}>{value}</p>
    </div>
  )
}
