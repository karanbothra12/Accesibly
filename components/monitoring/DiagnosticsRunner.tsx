'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader } from '@/components/dashboard/ui'

type Site = { id: number; name: string; url: string }
type Hop = { hop: number; host: string; rttMs: number | null; city?: string | null; country?: string | null; isp?: string | null; asn?: number | null; private?: boolean }
type Diag = { id: number; kind: string; target: string; success: boolean; summary: Record<string, unknown> | null; error: string | null; measured_at: string }

function HopTable({ hops }: { hops: Hop[] }) {
  return (
    <div className="overflow-x-auto mt-1">
      <table className="w-full text-[11px]">
        <thead><tr className="text-left text-slate-400 border-b border-slate-100">
          <th className="py-1 pr-3 font-medium">#</th><th className="py-1 pr-3 font-medium">IP</th><th className="py-1 pr-3 font-medium">RTT</th><th className="py-1 pr-3 font-medium">Location</th><th className="py-1 pr-3 font-medium">Network</th>
        </tr></thead>
        <tbody>{hops.map((h, i) => {
          const noResp = h.host === '*' || !/^\d/.test(h.host)
          const loc = h.private ? 'private/internal' : [h.city, h.country].filter(Boolean).join(', ')
          const net = h.private ? '' : [h.isp, h.asn ? `AS${h.asn}` : ''].filter(Boolean).join(' · ')
          return (
            <tr key={i} className="border-b border-slate-50">
              <td className="py-1 pr-3 text-slate-400">{h.hop}</td>
              <td className="py-1 pr-3 font-mono text-slate-700">{noResp ? '*' : h.host}</td>
              <td className="py-1 pr-3 text-slate-600">{h.rttMs != null ? `${Math.round(h.rttMs)} ms` : '—'}</td>
              <td className="py-1 pr-3 text-slate-600">{noResp ? <span className="text-slate-300">no response</span> : (loc || '—')}</td>
              <td className="py-1 pr-3 text-slate-500">{net || (h.private ? '—' : '')}</td>
            </tr>
          )
        })}</tbody>
      </table>
    </div>
  )
}

export default function DiagnosticsRunner({ sites }: { sites: Site[] }) {
  const [siteId, setSiteId] = useState<string>(sites[0] ? String(sites[0].id) : '')
  const [rows, setRows] = useState<Diag[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!siteId) return
    const r = await fetch(`/api/internet-monitoring/diagnostics?website_id=${siteId}`)
    if (r.ok) { const d = await r.json(); setRows(d.diagnostics) }
  }, [siteId])
  useEffect(() => { let alive = true; (async () => { if (alive) await load() })(); return () => { alive = false } }, [load])

  async function run(kind: string) {
    if (!siteId) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/internet-monitoring/diagnostics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ website_id: Number(siteId), kind }),
      })
      const d = await r.json()
      setMsg(d.message || d.error || 'Queued')
      setTimeout(load, 3000) // results appear after the worker runs it
    } finally { setBusy(false) }
  }

  if (sites.length === 0) return <Card className="px-6 py-10 text-center text-sm text-slate-400">Add and verify a website first.</Card>

  return (
    <div className="space-y-5">
      <Card className="p-4 flex flex-wrap items-center gap-3">
        <select value={siteId} onChange={e => setSiteId(e.target.value)} className="text-sm px-3 py-2 rounded-xl border border-slate-200 bg-white">
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={() => run('ping')} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50">Ping</button>
        <button onClick={() => run('traceroute')} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50">Traceroute</button>
        <button onClick={() => run('dns')} disabled={busy} className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50">DNS lookup</button>
        <button onClick={load} className="text-sm px-3 py-2 rounded-lg text-primary hover:underline">Refresh</button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </Card>

      <Card>
        <CardHeader title="Recent diagnostics" />
        {rows.length === 0 ? <p className="px-6 py-8 text-center text-sm text-slate-400">No diagnostics yet. Run one above — it executes on the worker/agent and appears here.</p>
          : (
            <ul className="divide-y divide-slate-100">
              {rows.map(d => (
                <li key={d.id} className="px-5 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-800">{d.kind} · {d.target}</span>
                    <span className={`text-[11px] font-semibold ${d.success ? 'text-emerald-600' : 'text-rose-600'}`}>{d.success ? 'OK' : 'failed'}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">{new Date(d.measured_at).toLocaleString()}</p>
                  {d.error && <p className="text-xs text-amber-600 mt-1">{d.error}</p>}
                  {d.kind === 'traceroute' && Array.isArray((d.summary as { hops?: Hop[] })?.hops)
                    ? <HopTable hops={(d.summary as { hops: Hop[] }).hops} />
                    : d.summary != null && <pre className="text-[11px] text-slate-600 bg-slate-50 rounded p-2 mt-1 overflow-x-auto">{JSON.stringify(d.summary, null, 1)}</pre>}
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  )
}
