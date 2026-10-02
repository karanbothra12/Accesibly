'use client'

import { useEffect, useState } from 'react'

type ErrRow = {
  id: number; source: string; level: string; message: string; stack: string | null
  path: string | null; method: string | null; merchant_id: number | null
  meta: Record<string, unknown> | null; resolved: boolean; created_at: string
}
type Counts = { total: string; unresolved: string; server: string; client: string; api: string; job: string }

const SOURCE_STYLE: Record<string, string> = {
  server: 'bg-rose-50 text-rose-700', api: 'bg-amber-50 text-amber-700',
  client: 'bg-indigo-50 text-indigo-700', job: 'bg-violet-50 text-violet-700',
}

export default function ErrorLogView() {
  const [errors, setErrors] = useState<ErrRow[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [filter, setFilter] = useState<'unresolved' | 'all'>('unresolved')
  const [source, setSource] = useState<string>('')
  const [open, setOpen] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const qs = new URLSearchParams({ filter })
    if (source) qs.set('source', source)
    const r = await fetch(`/api/admin/errors?${qs}`)
    if (r.ok) { const d = await r.json(); setErrors(d.errors); setCounts(d.counts); setLoading(false) }
  }
  useEffect(() => {
    let alive = true
    ;(async () => {
      const qs = new URLSearchParams({ filter }); if (source) qs.set('source', source)
      const r = await fetch(`/api/admin/errors?${qs}`)
      if (!r.ok || !alive) return
      const d = await r.json(); if (!alive) return
      setErrors(d.errors); setCounts(d.counts); setLoading(false)
    })()
    return () => { alive = false }
  }, [filter, source])

  async function resolve(id: number, resolved: boolean) {
    await fetch('/api/admin/errors', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, resolved }) })
    load()
  }
  async function resolveAll() {
    if (!confirm('Mark all errors as resolved?')) return
    await fetch('/api/admin/errors', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolveAll: true }) })
    load()
  }
  async function clear(kind: 'resolved' | 'all') {
    if (!confirm(kind === 'all' ? 'Delete ALL error logs?' : 'Delete all resolved errors?')) return
    await fetch('/api/admin/errors', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: kind }) })
    load()
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Error Logs</h1>
          <p className="text-slate-500 text-sm mt-1">Server, API, background-job and client script errors — with stack traces and context.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={resolveAll} className="text-sm px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50">Resolve all</button>
          <button onClick={() => clear('resolved')} className="text-sm px-3 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50">Clear resolved</button>
          <button onClick={() => clear('all')} className="text-sm px-3 py-2 rounded-xl border border-rose-100 text-rose-600 hover:bg-rose-50">Clear all</button>
        </div>
      </div>

      {counts && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <Stat label="Unresolved" value={counts.unresolved} accent="text-rose-600" />
          <Stat label="Server" value={counts.server} />
          <Stat label="API" value={counts.api} />
          <Stat label="Client" value={counts.client} />
          <Stat label="Jobs" value={counts.job} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-white">
          {(['unresolved', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm rounded-lg capitalize ${filter === f ? 'bg-primary text-white font-medium' : 'text-slate-500 hover:text-slate-800'}`}>{f}</button>
          ))}
        </div>
        <select value={source} onChange={e => setSource(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="">All sources</option>
          <option value="server">Server</option>
          <option value="api">API</option>
          <option value="job">Background job</option>
          <option value="client">Client</option>
        </select>
      </div>

      {loading ? (
        <div className="ui-card h-40 animate-pulse" />
      ) : errors.length === 0 ? (
        <div className="ui-card px-6 py-14 text-center">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center text-xl mb-3">✓</div>
          <p className="text-sm font-medium text-slate-700">No {filter === 'unresolved' ? 'unresolved ' : ''}errors 🎉</p>
        </div>
      ) : (
        <div className="ui-card divide-y divide-slate-100">
          {errors.map(e => (
            <div key={e.id} className={`${e.resolved ? 'opacity-60' : ''}`}>
              <button onClick={() => setOpen(open === e.id ? null : e.id)} className="w-full text-left px-5 py-3.5 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                <span className={`shrink-0 mt-0.5 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${SOURCE_STYLE[e.source] || 'bg-slate-100 text-slate-600'}`}>{e.source}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{e.message}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(e.created_at).toLocaleString()}
                    {e.path ? ` · ${e.method ? e.method + ' ' : ''}${e.path}` : ''}
                    {e.merchant_id ? ` · merchant #${e.merchant_id}` : ''}
                  </p>
                </div>
                {e.resolved && <span className="shrink-0 text-[10px] text-emerald-600 font-medium">resolved</span>}
                <span className="shrink-0 text-slate-400 text-xs">{open === e.id ? '▾' : '▸'}</span>
              </button>
              {open === e.id && (
                <div className="px-5 pb-4 space-y-3">
                  {e.stack ? (
                    <pre className="bg-slate-900 text-slate-100 text-[11px] leading-relaxed rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{e.stack}</pre>
                  ) : <p className="text-xs text-slate-400">No stack trace captured.</p>}
                  {e.meta && <pre className="bg-slate-50 text-slate-600 text-[11px] rounded-lg p-3 overflow-x-auto">{JSON.stringify(e.meta, null, 2)}</pre>}
                  <div className="flex gap-2">
                    <button onClick={() => resolve(e.id, !e.resolved)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
                      {e.resolved ? 'Reopen' : 'Mark resolved'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent = 'text-slate-900' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="ui-card p-4">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${accent}`}>{Number(value).toLocaleString()}</p>
    </div>
  )
}
