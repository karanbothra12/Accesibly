'use client'

import { useCallback, useEffect, useState } from 'react'
import { StatCard, Card, CardHeader } from '@/components/dashboard/ui'
import WorldMap from '@/components/monitoring/WorldMap'

type Agent = {
  id: number; agent_key: string; name: string; kind: 'central' | 'remote'
  country_code: string | null; city: string | null; region: string | null; status: string
  latitude: number | null; longitude: number | null
  last_heartbeat_at: string | null; last_success_at: string | null
  jobs_succeeded: number; jobs_failed: number; isp: string | null; asn: number | null; version: string | null; online: boolean
}

export default function AgentsView({ isSuperadmin }: { isSuperadmin: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [city, setCity] = useState('')
  const [newToken, setNewToken] = useState<{ token: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/internet-monitoring/agents')
    if (r.ok) { const d = await r.json(); setAgents(d.agents) }
    setLoading(false)
  }, [])
  useEffect(() => { let alive = true; (async () => { if (alive) await load() })(); return () => { alive = false } }, [load])

  async function addAgent() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const r = await fetch('/api/internet-monitoring/agents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), country_code: country.trim(), city: city.trim() }),
      })
      const d = await r.json()
      if (r.ok) { setNewToken({ token: d.token, name: name.trim() }); setName(''); setCountry(''); setCity(''); await load() }
    } finally { setBusy(false) }
  }

  async function removeAgent(id: number) {
    if (!confirm('Delete this agent? It will no longer be able to submit measurements.')) return
    await fetch(`/api/internet-monitoring/agents?id=${id}`, { method: 'DELETE' })
    await load()
  }

  const online = agents.filter(a => a.online).length

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Agents" value={String(agents.length)} tint="tint-indigo" />
        <StatCard label="Online" value={String(online)} tint="tint-emerald" valueClass={online ? 'text-emerald-600' : 'text-slate-900'} />
        <StatCard label="Offline" value={String(agents.length - online)} />
        <StatCard label="Central" value={String(agents.filter(a => a.kind === 'central').length)} />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-900 mb-3">Agent map</h3>
        <WorldMap agents={agents} />
      </Card>

      <Card className="px-5 py-3 text-xs text-slate-500">
        A cloud VPS is <span className="font-semibold">not</span> a retail ISP. To compare ISPs (e.g. Airtel vs Jio), deploy agents actually homed on those networks — otherwise results reflect data-centre connectivity, which we label as such.
      </Card>

      {isSuperadmin && (
        <Card>
          <CardHeader title="Register a new agent" />
          <div className="p-5 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]"><label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="mumbai-airtel-1" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" /></div>
            <div className="w-24"><label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Country</label>
              <input value={country} onChange={e => setCountry(e.target.value)} placeholder="IN" maxLength={2} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-primary" /></div>
            <div className="min-w-[120px]"><label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">City</label>
              <input value={city} onChange={e => setCity(e.target.value)} placeholder="Mumbai" className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary" /></div>
            <button onClick={addAgent} disabled={busy || !name.trim()} className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-lg">{busy ? 'Creating…' : 'Create'}</button>
          </div>
          {newToken && (
            <div className="mx-5 mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">Agent “{newToken.name}” created. Copy its token now — it won’t be shown again:</p>
              <code className="block text-xs bg-white rounded p-2 mt-2 break-all border border-emerald-200">{newToken.token}</code>
              <p className="text-xs text-emerald-700 mt-2">Set it on the agent container as <code>AGENT_TOKEN</code> plus <code>MONITORING_API_URL</code> pointing at this app.</p>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Agent fleet" />
        {loading ? <p className="px-6 py-8 text-center text-sm text-slate-400">Loading…</p>
          : agents.length === 0 ? <p className="px-6 py-8 text-center text-sm text-slate-400">No agents yet.{isSuperadmin ? ' Register one above, or run the worker with MONITORING_ENABLED=1 to auto-register the central agent.' : ''}</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="py-2.5 px-5 font-medium">Agent</th><th className="py-2.5 pr-3 font-medium">Location</th><th className="py-2.5 pr-3 font-medium">ISP / ASN</th>
                  <th className="py-2.5 pr-3 font-medium">Status</th><th className="py-2.5 pr-3 font-medium">OK / Fail</th><th className="py-2.5 pr-3 font-medium">Last seen</th>{isSuperadmin && <th className="py-2.5 pr-3" />}
                </tr></thead>
                <tbody>
                  {agents.map(a => (
                    <tr key={a.id} className="border-b border-slate-50">
                      <td className="py-2.5 px-5"><span className="font-medium text-slate-800">{a.name}</span> {a.kind === 'central' && <span className="ml-1 text-[10px] uppercase text-primary">central</span>}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{[a.city, a.country_code].filter(Boolean).join(', ') || '—'}</td>
                      <td className="py-2.5 pr-3 text-slate-500">{a.isp || (a.asn ? `AS${a.asn}` : '—')}</td>
                      <td className="py-2.5 pr-3">{a.online ? <span className="text-emerald-600 font-medium">● online</span> : <span className="text-slate-400">○ offline</span>}</td>
                      <td className="py-2.5 pr-3 text-slate-600">{a.jobs_succeeded} / {a.jobs_failed}</td>
                      <td className="py-2.5 pr-3 text-slate-400">{a.last_heartbeat_at ? new Date(a.last_heartbeat_at).toLocaleString() : 'never'}</td>
                      {isSuperadmin && <td className="py-2.5 pr-3">{a.kind === 'remote' && <button onClick={() => removeAgent(a.id)} className="text-rose-600 hover:underline">Delete</button>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
    </div>
  )
}
