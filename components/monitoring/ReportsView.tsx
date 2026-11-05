'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader } from '@/components/dashboard/ui'

type Site = { id: number; name: string }
type Row = { key: string; isp: string | null; availability: number; avgTotal: number | null; p95Total: number | null; samples: number }

const ms = (v: number | null) => (v == null ? '—' : `${Math.round(v)} ms`)
const nameOf = (r: Row) => r.isp || r.key || 'Unknown'

function Board({ title, rows, metric }: { title: string; rows: Row[]; metric: (r: Row) => string }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? <p className="px-5 py-6 text-center text-xs text-slate-400">Not enough data yet.</p>
        : <ol className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <li key={r.key} className="px-5 py-2.5 flex items-center justify-between text-sm">
                <span className="text-slate-700"><span className="text-slate-400 mr-2">{i + 1}.</span>{nameOf(r)} <span className="text-[11px] text-slate-400">({r.samples} samples)</span></span>
                <span className="font-medium text-slate-900">{metric(r)}</span>
              </li>
            ))}
          </ol>}
    </Card>
  )
}

export default function ReportsView({ sites }: { sites: Site[] }) {
  const [period, setPeriod] = useState('30d')
  const [isps, setIsps] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const r = await fetch(`/api/internet-monitoring/analytics?dimension=isp&period=${period}`)
    if (r.ok) { const d = await r.json(); setIsps(d.rows) }
    setLoading(false)
  }, [period])
  useEffect(() => { let alive = true; (async () => { if (alive) await load() })(); return () => { alive = false } }, [load])

  const byLatency = [...isps].filter(r => r.avgTotal != null)
  const fastest = byLatency.slice(0, 5)
  const slowest = [...byLatency].reverse().slice(0, 5)
  const worstAvail = [...isps].sort((a, b) => a.availability - b.availability).slice(0, 5)

  return (
    <div className="space-y-6">
      <Card className="p-4 flex items-center gap-3">
        <span className="text-sm text-slate-500">Period</span>
        <select value={period} onChange={e => setPeriod(e.target.value)} className="text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white">
          <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option>
        </select>
      </Card>

      {loading ? <Card className="px-6 py-8 text-center text-sm text-slate-400">Loading…</Card> : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Board title="🏆 Fastest ISPs" rows={fastest} metric={r => ms(r.avgTotal)} />
          <Board title="🐢 Slowest ISPs" rows={slowest} metric={r => ms(r.avgTotal)} />
          <Board title="⚠️ Lowest availability" rows={worstAvail} metric={r => `${r.availability.toFixed(1)}%`} />
        </div>
      )}

      <Card>
        <CardHeader title="Export raw measurements (CSV)" />
        {sites.length === 0 ? <p className="px-5 py-6 text-center text-xs text-slate-400">No websites yet.</p>
          : <ul className="divide-y divide-slate-100">
              {sites.map(s => (
                <li key={s.id} className="px-5 py-3 flex items-center justify-between text-sm">
                  <span className="text-slate-700">{s.name}</span>
                  <a href={`/api/internet-monitoring/reports/export?website_id=${s.id}&period=${period}`} className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50">⬇ CSV ({period})</a>
                </li>
              ))}
            </ul>}
      </Card>
      <p className="text-[11px] text-slate-400">Leaderboards require a minimum sample count and show sample sizes — they never rank an ISP on thin data, and reflect only networks your agents actually run on.</p>
    </div>
  )
}
