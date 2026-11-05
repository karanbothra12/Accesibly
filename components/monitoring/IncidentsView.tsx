'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardHeader } from '@/components/dashboard/ui'

type Incident = {
  id: number; website_id: number; website_name: string; url: string
  status: 'open' | 'acknowledged' | 'resolved'; kind: string; cause_hypothesis: string | null
  failure_count: number; last_error: string | null; started_at: string; resolved_at: string | null
}
type Alert = { id: number; website_id: number | null; website_name: string | null; condition: string; threshold: number | null; channel: string; target: string | null; enabled: boolean }
type Site = { id: number; name: string }

const STATUS: Record<string, string> = { open: 'bg-rose-100 text-rose-700', acknowledged: 'bg-amber-100 text-amber-700', resolved: 'bg-emerald-100 text-emerald-700' }

export default function IncidentsView({ sites }: { sites: Site[] }) {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  // new-alert form
  const [condition, setCondition] = useState('down')
  const [channel, setChannel] = useState('email')
  const [websiteId, setWebsiteId] = useState('')
  const [target, setTarget] = useState('')

  const load = useCallback(async () => {
    const [i, a] = await Promise.all([
      fetch(`/api/internet-monitoring/incidents?status=${filter}`).then(r => r.ok ? r.json() : { incidents: [] }),
      fetch('/api/internet-monitoring/alerts').then(r => r.ok ? r.json() : { alerts: [] }),
    ])
    setIncidents(i.incidents); setAlerts(a.alerts)
  }, [filter])
  useEffect(() => { let alive = true; (async () => { if (alive) await load() })(); return () => { alive = false } }, [load])

  async function act(id: number, action: 'acknowledge' | 'resolve') {
    await fetch('/api/internet-monitoring/incidents', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }) })
    await load()
  }
  async function addAlert() {
    await fetch('/api/internet-monitoring/alerts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ condition, channel, website_id: websiteId || null, target: channel === 'webhook' ? target : null }),
    })
    setTarget(''); await load()
  }
  async function delAlert(id: number) { await fetch(`/api/internet-monitoring/alerts?id=${id}`, { method: 'DELETE' }); await load() }

  return (
    <div className="space-y-6">
      <Card>
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Incidents</h3>
          <div className="flex gap-1 text-xs">
            <button onClick={() => setFilter('open')} className={`px-2.5 py-1 rounded-lg ${filter === 'open' ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100'}`}>Open</button>
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1 rounded-lg ${filter === 'all' ? 'bg-primary text-white' : 'text-slate-500 hover:bg-slate-100'}`}>All</button>
          </div>
        </div>
        {incidents.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">{filter === 'open' ? 'No open incidents 🎉' : 'No incidents recorded.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {incidents.map(i => (
              <li key={i.id} className="px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${STATUS[i.status]}`}>{i.status}</span>
                      <span className="text-sm font-medium text-slate-800 truncate">{i.website_name}</span>
                      <span className="text-[10px] uppercase text-slate-400">{i.kind}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">{i.cause_hypothesis}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Started {new Date(i.started_at).toLocaleString()}{i.resolved_at ? ` · resolved ${new Date(i.resolved_at).toLocaleString()}` : ''} · {i.failure_count} consecutive failures{i.last_error ? ` · ${i.last_error}` : ''}</p>
                  </div>
                  {i.status !== 'resolved' && (
                    <div className="flex gap-1.5 shrink-0">
                      {i.status === 'open' && <button onClick={() => act(i.id, 'acknowledge')} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Ack</button>}
                      <button onClick={() => act(i.id, 'resolve')} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50">Resolve</button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Alert rules" />
        <div className="p-5 flex flex-wrap items-end gap-3">
          <div><label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">When</label>
            <select value={condition} onChange={e => setCondition(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white">
              <option value="down">Site down</option><option value="slow">Slow response</option><option value="ssl_expiry">SSL expiring</option><option value="agent_offline">Agent offline</option>
            </select></div>
          <div><label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Website</label>
            <select value={websiteId} onChange={e => setWebsiteId(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white">
              <option value="">All websites</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
          <div><label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Via</label>
            <select value={channel} onChange={e => setChannel(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white">
              <option value="email">Email</option><option value="webhook">Webhook</option>
            </select></div>
          {channel === 'webhook' && <div className="flex-1 min-w-[200px]"><label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Webhook URL</label>
            <input value={target} onChange={e => setTarget(e.target.value)} placeholder="https://hooks…" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" /></div>}
          <button onClick={addAlert} className="px-4 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-lg">Add rule</button>
        </div>
        {alerts.length > 0 && (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {alerts.map(a => (
              <li key={a.id} className="px-5 py-2.5 flex items-center justify-between text-sm">
                <span className="text-slate-700">When <b>{a.condition}</b> on <b>{a.website_name || 'all websites'}</b> → {a.channel}{a.target ? ` (${a.target})` : ''}</span>
                <button onClick={() => delAlert(a.id)} className="text-xs text-rose-600 hover:underline">Remove</button>
              </li>
            ))}
          </ul>
        )}
        <p className="px-5 py-3 text-xs text-slate-400">Email alerts respect your notification settings and send once a provider is configured; webhooks POST a JSON payload on incident open/resolve.</p>
      </Card>
    </div>
  )
}
