'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, StatCard } from '@/components/dashboard/ui'

type Row = {
  key: string; isp: string | null; asn: number | null; country: string | null
  samples: number; availability: number
  avgTotal: number | null; medianTotal: number | null; p95Total: number | null
  avgDns: number | null; avgTcp: number | null; avgTls: number | null; avgTtfb: number | null
  confidence: 'low' | 'medium' | 'high'
}
type Site = { id: number; name: string }

const ms = (v: number | null) => (v == null ? '—' : `${Math.round(v)} ms`)
const CONF: Record<string, string> = { low: 'bg-slate-100 text-slate-500', medium: 'bg-amber-100 text-amber-700', high: 'bg-emerald-100 text-emerald-700' }

export default function AnalyticsView({ dimension, label, sites }: { dimension: 'isp' | 'country' | 'asn'; label: string; sites: Site[] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [period, setPeriod] = useState('7d')
  const [siteId, setSiteId] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const q = new URLSearchParams({ dimension, period })
    if (siteId) q.set('website_id', siteId)
    const r = await fetch(`/api/internet-monitoring/analytics?${q}`)
    if (r.ok) { const d = await r.json(); setRows(d.rows) }
    setLoading(false)
  }, [dimension, period, siteId])
  useEffect(() => { let alive = true; (async () => { if (alive) await load() })(); return () => { alive = false } }, [load])

  const nameOf = (r: Row) => dimension === 'asn' ? (r.asn ? `AS${r.asn}${r.isp ? ` · ${r.isp}` : ''}` : 'Unknown')
    : dimension === 'country' ? (r.country || 'Unknown') : (r.isp || 'Unknown')

  const toggle = (k: string) => setSelected(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const compared = rows.filter(r => selected.has(r.key))
  const fastest = rows[0], slowest = rows[rows.length - 1]

  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <select value={period} onChange={e => setPeriod(e.target.value)} className="text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white">
          <option value="24h">Last 24h</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
        </select>
        <select value={siteId} onChange={e => setSiteId(e.target.value)} className="text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white">
          <option value="">All websites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="text-xs text-slate-400">Synthetic measurements · groups below 5 samples are hidden.</span>
      </Card>

      {!loading && rows.length >= 2 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatCard label={`Fastest ${label}`} value={fastest ? nameOf(fastest) : '—'} sub={fastest ? `${ms(fastest.avgTotal)} avg · ${fastest.samples} samples` : ''} tint="tint-emerald" valueClass="text-emerald-600 text-lg" />
          <StatCard label={`Slowest ${label}`} value={slowest ? nameOf(slowest) : '—'} sub={slowest ? `${ms(slowest.avgTotal)} avg · ${slowest.samples} samples` : ''} tint="tint-rose" valueClass="text-rose-600 text-lg" />
        </div>
      )}

      {compared.length >= 2 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Comparison ({compared.length} selected)</h3>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-slate-400 border-b border-slate-100">
              <th className="py-1.5 pr-3 font-medium">{label}</th><th className="py-1.5 pr-3 font-medium">Avail</th><th className="py-1.5 pr-3 font-medium">Avg</th><th className="py-1.5 pr-3 font-medium">Median</th><th className="py-1.5 pr-3 font-medium">P95</th><th className="py-1.5 pr-3 font-medium">TTFB</th><th className="py-1.5 pr-3 font-medium">Samples</th>
            </tr></thead>
            <tbody>{compared.map(r => (
              <tr key={r.key} className="border-b border-slate-50">
                <td className="py-1.5 pr-3 font-medium text-slate-800">{nameOf(r)}</td>
                <td className="py-1.5 pr-3">{r.availability.toFixed(1)}%</td>
                <td className="py-1.5 pr-3 font-medium">{ms(r.avgTotal)}</td><td className="py-1.5 pr-3">{ms(r.medianTotal)}</td>
                <td className="py-1.5 pr-3">{ms(r.p95Total)}</td><td className="py-1.5 pr-3">{ms(r.avgTtfb)}</td><td className="py-1.5 pr-3 text-slate-400">{r.samples}</td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      )}

      <Card>
        <div className="px-5 py-3.5 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-900">{label} performance</h3></div>
        {loading ? <p className="px-6 py-8 text-center text-sm text-slate-400">Loading…</p>
          : rows.length === 0 ? <p className="px-6 py-10 text-center text-sm text-slate-400">No measurements yet with enough samples. Monitoring data accrues as checks run — ISP/ASN appear once agents with known networks report in.</p>
          : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-slate-400 border-b border-slate-100">
                <th className="py-2.5 px-5 font-medium"><span className="sr-only">compare</span></th>
                <th className="py-2.5 pr-3 font-medium">{label}</th><th className="py-2.5 pr-3 font-medium">Avail</th>
                <th className="py-2.5 pr-3 font-medium">Avg</th><th className="py-2.5 pr-3 font-medium">Median</th><th className="py-2.5 pr-3 font-medium">P95</th>
                <th className="py-2.5 pr-3 font-medium">DNS</th><th className="py-2.5 pr-3 font-medium">TTFB</th>
                <th className="py-2.5 pr-3 font-medium">Samples</th><th className="py-2.5 pr-3 font-medium">Conf.</th>
              </tr></thead>
              <tbody>{rows.map(r => (
                <tr key={r.key} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2.5 px-5"><input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)} /></td>
                  <td className="py-2.5 pr-3 font-medium text-slate-800">{nameOf(r)}</td>
                  <td className="py-2.5 pr-3"><span className={(r.availability >= 99 ? 'text-emerald-600' : 'text-amber-600') + ' font-medium'}>{r.availability.toFixed(1)}%</span></td>
                  <td className="py-2.5 pr-3 font-medium text-slate-800">{ms(r.avgTotal)}</td>
                  <td className="py-2.5 pr-3 text-slate-600">{ms(r.medianTotal)}</td><td className="py-2.5 pr-3 text-slate-600">{ms(r.p95Total)}</td>
                  <td className="py-2.5 pr-3 text-slate-500">{ms(r.avgDns)}</td><td className="py-2.5 pr-3 text-slate-500">{ms(r.avgTtfb)}</td>
                  <td className="py-2.5 pr-3 text-slate-400">{r.samples}</td>
                  <td className="py-2.5 pr-3"><span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${CONF[r.confidence]}`}>{r.confidence}</span></td>
                </tr>))}</tbody>
            </table></div>
          )}
      </Card>
    </div>
  )
}
