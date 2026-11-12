'use client'

import { useCallback, useEffect, useState } from 'react'
import { StatCard, Card, CardHeader } from '@/components/dashboard/ui'
import MiniChart, { type Point } from '@/components/dashboard/MiniChart'
import Waterfall from '@/components/monitoring/Waterfall'

type Website = {
  id: number; name: string; url: string; description: string | null
  frequency_minutes: number; expected_status: number; timeout_ms: number
  enabled: boolean; verified: boolean; verification_token: string; verification_method: string | null
  agent_ids: number[]; last_checked_at: string | null; created_at: string; origin_host: string | null
}
type Ent = { available: boolean; websiteLimit: number; minFrequency: number; frequencies: number[] }
type ResultRow = {
  id: number; measured_at: string; available: boolean; status_code: number | null
  error_type: string | null; error_detail: string | null
  dns_ms: number | null; tcp_ms: number | null; tls_ms: number | null; ttfb_ms: number | null
  download_ms: number | null; total_ms: number | null; response_size: number | null; resolved_ip: string | null
  cdn_vendor: string | null; cache_status: string | null; edge_pop: string | null
  origin_total_ms: number | null; origin_ttfb_ms: number | null; origin_available: boolean | null
  agent_id: number | null; agent_name: string | null; agent_kind: string | null
  agent_country: string | null; agent_city: string | null
}
type Summary = {
  checks: number; availability: number | null; avgTotal: number | null; p95Total: number | null
  avgDns: number | null; avgTcp: number | null; avgTls: number | null; avgTtfb: number | null
  cacheHitRate: number | null; avgOriginTtfb: number | null; avgOriginTotal: number | null
}
type CdnRow = { vendor: string | null; pop: string | null; count: number }

// Colored pill for a normalized cache status.
function CachePill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-300">—</span>
  const map: Record<string, string> = {
    hit: 'bg-emerald-50 text-emerald-700', miss: 'bg-rose-50 text-rose-700',
    dynamic: 'bg-slate-100 text-slate-600', bypass: 'bg-amber-50 text-amber-700',
    stale: 'bg-amber-50 text-amber-700', expired: 'bg-amber-50 text-amber-700', revalidated: 'bg-emerald-50 text-emerald-700',
  }
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${map[status] ?? 'bg-slate-100 text-slate-600'}`}>{status}</span>
}

const ms = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)} ms`)
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(v >= 99.95 ? 0 : 2)}%`)

export default function WebsitesManager({ initial, superadmin = false }: { initial: { websites: Website[] } & Ent; superadmin?: boolean }) {
  const [ent, setEnt] = useState<Ent>(initial)
  const [websites, setWebsites] = useState<Website[]>(initial.websites)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [originHost, setOriginHost] = useState('')
  const [freq, setFreq] = useState<number>(initial.frequencies[0] || 5)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const reload = useCallback(async () => {
    const r = await fetch('/api/internet-monitoring/websites')
    if (r.ok) { const d = await r.json(); setWebsites(d.websites); setEnt(d) }
  }, [])

  async function add() {
    if (!name.trim() || !url.trim()) return
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/internet-monitoring/websites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), frequency_minutes: freq, origin_host: originHost.trim() || undefined }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.message || d.error || 'Failed'); return }
      setName(''); setUrl(''); setOriginHost(''); await reload()
    } finally { setBusy(false) }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const r = await fetch('/api/internet-monitoring/websites', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.message || d.error || 'Failed'); return false }
    await reload(); return true
  }

  async function remove(id: number) {
    if (!confirm('Delete this monitored website and all its measurements?')) return
    await fetch(`/api/internet-monitoring/websites?id=${id}`, { method: 'DELETE' })
    await reload()
  }

  if (!ent.available) {
    return (
      <Card className="px-6 py-12 text-center">
        <p className="text-slate-500 text-sm">Internet Performance Monitoring isn’t included in your current plan.</p>
        <a href="/dashboard/billing" className="inline-block mt-3 text-sm font-semibold text-primary hover:underline">View plans →</a>
      </Card>
    )
  }

  const atLimit = ent.websiteLimit !== -1 && websites.length >= ent.websiteLimit

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Add a website to monitor" />
        <div className="p-5 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Marketing site"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary" />
          </div>
          <div className="flex-[2] min-w-[220px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">URL</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary" />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Frequency</label>
            <select value={freq} onChange={e => setFreq(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary">
              {ent.frequencies.map(f => <option key={f} value={f}>Every {f} min</option>)}
            </select>
          </div>
          <button onClick={add} disabled={busy || atLimit || !name.trim() || !url.trim()}
            className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {busy ? 'Adding…' : 'Add'}
          </button>
          <div className="w-full">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Origin host <span className="normal-case font-normal text-slate-400">— optional, for edge-vs-origin comparison</span></label>
            <input value={originHost} onChange={e => setOriginHost(e.target.value)} placeholder="origin.example.com (a host that serves the site directly, bypassing the CDN)"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary" />
          </div>
        </div>
        {atLimit && <p className="px-5 pb-4 text-xs text-amber-600">Plan limit reached ({ent.websiteLimit} website{ent.websiteLimit === 1 ? '' : 's'}).</p>}
        {error && <p className="px-5 pb-4 text-xs text-red-600">{error}</p>}
      </Card>

      {websites.length === 0 ? (
        <Card className="px-6 py-12 text-center text-slate-400 text-sm">No monitored websites yet. Add one above, then verify ownership to start monitoring.</Card>
      ) : (
        <div className="space-y-4">
          {websites.map(w => (
            <WebsiteRow key={w.id} w={w} expanded={expanded === w.id} superadmin={superadmin}
              onToggleExpand={() => setExpanded(expanded === w.id ? null : w.id)}
              onPatch={patch} onRemove={remove} onChanged={reload} />
          ))}
        </div>
      )}
    </div>
  )
}

function WebsiteRow({ w, expanded, superadmin, onToggleExpand, onPatch, onRemove, onChanged }: {
  w: Website; expanded: boolean; superadmin: boolean; onToggleExpand: () => void
  onPatch: (id: number, b: Record<string, unknown>) => Promise<boolean>
  onRemove: (id: number) => void; onChanged: () => void
}) {
  const statusBadge = !w.verified
    ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Unverified</span>
    : w.enabled
      ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Monitoring</span>
      : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">Paused</span>

  return (
    <Card>
      <div className="p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 truncate">{w.name}</h3>
            {statusBadge}
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">{w.url} · every {w.frequency_minutes} min · {w.last_checked_at ? `last checked ${new Date(w.last_checked_at).toLocaleString()}` : 'never checked'}</p>
        </div>
        <div className="flex items-center gap-2">
          {w.verified ? (
            <button onClick={() => onPatch(w.id, { enabled: !w.enabled })}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
              {w.enabled ? 'Pause' : 'Resume'}
            </button>
          ) : null}
          <button onClick={onToggleExpand} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">
            {expanded ? 'Hide' : w.verified ? 'Results' : 'Verify'}
          </button>
          <button onClick={() => onRemove(w.id)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50">Delete</button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-slate-100 p-5">
          {w.verified ? <ResultsPanel websiteId={w.id} /> : <VerifyPanel website={w} superadmin={superadmin} onVerified={onChanged} />}
        </div>
      )}
    </Card>
  )
}

function VerifyPanel({ website, superadmin, onVerified }: { website: Website; superadmin: boolean; onVerified: () => void }) {
  const [info, setInfo] = useState<{ host: string | null; dns: { name: string | null; value: string }; meta: { tag: string } } | null>(null)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    fetch(`/api/internet-monitoring/websites/${website.id}/verify`).then(r => r.json()).then(setInfo).catch(() => {})
  }, [website.id])

  async function verify(method: 'dns-txt' | 'meta' | 'admin') {
    setChecking(true); setMsg('')
    try {
      const r = await fetch(`/api/internet-monitoring/websites/${website.id}/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method }),
      })
      const d = await r.json()
      if (d.verified) { onVerified() } else { setMsg(d.message || 'Not found yet.') }
    } finally { setChecking(false) }
  }

  if (!info) return <p className="text-sm text-slate-400">Loading verification steps…</p>
  return (
    <div className="space-y-4 text-sm">
      {superadmin && (
        <div className="rounded-xl border border-primary/30 bg-primary-lt/40 p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-slate-700">Admin shortcut — skip DNS/meta and start monitoring now (no head tag or TXT record needed).</p>
          <button onClick={() => verify('admin')} disabled={checking} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 font-medium">{checking ? 'Verifying…' : 'Mark verified (I own this)'}</button>
        </div>
      )}
      <p className="text-slate-600">Verify you control <span className="font-semibold">{info.host}</span> before monitoring begins. Use either method:</p>
      <div className="rounded-xl border border-slate-200 p-4">
        <p className="font-semibold text-slate-800 mb-1">Option A — DNS TXT record</p>
        <p className="text-xs text-slate-500 mb-2">Add this TXT record to your DNS, then click Verify (propagation can take a few minutes).</p>
        <code className="block text-xs bg-slate-50 rounded p-2 break-all">{info.dns.name} &nbsp;TXT&nbsp; {info.dns.value}</code>
        <button onClick={() => verify('dns-txt')} disabled={checking} className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50">{checking ? 'Checking…' : 'Verify via DNS'}</button>
      </div>
      <div className="rounded-xl border border-slate-200 p-4">
        <p className="font-semibold text-slate-800 mb-1">Option B — Homepage meta tag</p>
        <p className="text-xs text-slate-500 mb-2">Add this tag to your homepage <code>&lt;head&gt;</code>, then click Verify.</p>
        <code className="block text-xs bg-slate-50 rounded p-2 break-all">{info.meta.tag}</code>
        <button onClick={() => verify('meta')} disabled={checking} className="mt-3 text-xs px-3 py-1.5 rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50">{checking ? 'Checking…' : 'Verify via meta tag'}</button>
      </div>
      {msg && <p className="text-amber-600 text-xs">{msg}</p>}
    </div>
  )
}

function ResultsPanel({ websiteId }: { websiteId: number }) {
  const [period, setPeriod] = useState('24h')
  const [data, setData] = useState<{ summary: Summary; results: ResultRow[]; cdn?: CdnRow[] } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const r = await fetch(`/api/internet-monitoring/websites/${websiteId}/results?period=${period}`)
    if (r.ok) setData(await r.json())
    setLoading(false)
  }, [websiteId, period])

  useEffect(() => { let alive = true; (async () => { if (alive) await load() })(); return () => { alive = false } }, [load])
  // Live auto-refresh while viewing (checks land asynchronously from the worker/agents).
  useEffect(() => { const t = setInterval(() => { load() }, 20000); return () => clearInterval(t) }, [load])

  if (loading && !data) return <p className="text-sm text-slate-400">Loading measurements…</p>
  const s = data?.summary
  const rows = data?.results ?? []
  const latest = rows[0]
  // Oldest → newest for the chart.
  const chart: Point[] = [...rows].reverse().filter(r => r.total_ms != null).map(r => ({ x: r.measured_at, y: r.total_ms! }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />Live · synthetic checks from Accessly agents</p>
        <select value={period} onChange={e => setPeriod(e.target.value)} className="text-xs px-2 py-1 rounded-lg border border-slate-200 bg-white">
          <option value="24h">Last 24h</option><option value="7d">Last 7d</option><option value="30d">Last 30d</option>
        </select>
      </div>
      {!s || s.checks === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">No measurements yet. The worker runs due checks on its next cycle.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Availability" value={pct(s.availability)} tint="tint-emerald" valueClass={(s.availability ?? 0) >= 99 ? 'text-emerald-600' : 'text-amber-600'} />
            <StatCard label="Avg response" value={ms(s.avgTotal)} />
            <StatCard label="P95 response" value={ms(s.p95Total)} />
            <StatCard label="Checks" value={String(s.checks)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Avg DNS" value={ms(s.avgDns)} />
            <StatCard label="Avg TCP" value={ms(s.avgTcp)} />
            <StatCard label="Avg TLS" value={ms(s.avgTls)} />
            <StatCard label="Avg TTFB" value={ms(s.avgTtfb)} />
          </div>
          {/* ── CDN & edge (Phase 6) ─────────────────────────────────────── */}
          {(latest?.cdn_vendor || s.cacheHitRate != null || s.avgOriginTtfb != null) && (
            <Card className="p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500">CDN &amp; edge</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="CDN" value={latest?.cdn_vendor ?? '—'} tint="tint-violet" />
                <StatCard label="Cache hit rate" value={s.cacheHitRate == null ? '—' : pct(s.cacheHitRate)}
                  valueClass={(s.cacheHitRate ?? 0) >= 80 ? 'text-emerald-600' : (s.cacheHitRate ?? 101) < 50 ? 'text-rose-600' : 'text-amber-600'} />
                <StatCard label="Edge PoP (latest)" value={latest?.edge_pop ?? '—'} />
                <StatCard label="Cache (latest)" value={latest?.cache_status ?? '—'} />
              </div>
              {s.avgOriginTtfb != null && (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <p className="text-[11px] font-semibold text-slate-500 mb-2">Edge vs origin (avg TTFB)</p>
                  <div className="flex items-center gap-4 text-xs">
                    <span>Edge: <b className="text-slate-800 tabular-nums">{ms(s.avgTtfb)}</b></span>
                    <span>Origin: <b className="text-slate-800 tabular-nums">{ms(s.avgOriginTtfb)}</b></span>
                    {s.avgTtfb != null && s.avgOriginTtfb != null && s.avgOriginTtfb > 0 && (
                      <span className="text-emerald-600 font-medium">
                        CDN saves ~{Math.max(0, Math.round(s.avgOriginTtfb - s.avgTtfb))}ms
                        {s.avgOriginTtfb > s.avgTtfb ? ` (${Math.round((1 - s.avgTtfb / s.avgOriginTtfb) * 100)}% faster)` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )}
              {data?.cdn && data.cdn.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {data.cdn.filter(c => c.pop).slice(0, 10).map((c, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[10px] font-medium">
                      {c.pop} · {c.count}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}
          {latest && latest.available && (
            <Card className="p-4">
              <p className="text-xs font-semibold text-slate-500 mb-2">Latest check — connection waterfall <span className="font-normal text-slate-400">({new Date(latest.measured_at).toLocaleTimeString()})</span></p>
              <Waterfall phases={{ dns: latest.dns_ms, tcp: latest.tcp_ms, tls: latest.tls_ms, ttfb: latest.ttfb_ms, download: latest.download_ms }} />
            </Card>
          )}
          <Card className="p-4">
            <MiniChart title="Total response time" points={chart} color="#6366f1" format={v => `${Math.round(v)}ms`} formatX={x => new Date(x).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} />
          </Card>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">Agent</th><th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">DNS</th><th className="py-2 pr-3 font-medium">TCP</th><th className="py-2 pr-3 font-medium">TLS</th>
                  <th className="py-2 pr-3 font-medium">TTFB</th><th className="py-2 pr-3 font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">CDN</th><th className="py-2 pr-3 font-medium">Cache</th><th className="py-2 pr-3 font-medium">PoP</th>
                  <th className="py-2 pr-3 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 60).map(r => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{new Date(r.measured_at).toLocaleString()}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {r.agent_name
                        ? <span title={[r.agent_city, r.agent_country].filter(Boolean).join(', ')}>
                            <span className="font-medium text-slate-700">{r.agent_name}</span>
                            {r.agent_country && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{r.agent_country}</span>}
                          </span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-2 pr-3">{r.available
                      ? <span className="text-emerald-600 font-medium">{r.status_code ?? 'up'}</span>
                      : <span className="text-rose-600 font-medium" title={r.error_detail ?? ''}>{r.error_type ?? 'down'}{r.status_code ? ` ${r.status_code}` : ''}</span>}</td>
                    <td className="py-2 pr-3 text-slate-600">{ms(r.dns_ms)}</td><td className="py-2 pr-3 text-slate-600">{ms(r.tcp_ms)}</td>
                    <td className="py-2 pr-3 text-slate-600">{ms(r.tls_ms)}</td><td className="py-2 pr-3 text-slate-600">{ms(r.ttfb_ms)}</td>
                    <td className="py-2 pr-3 text-slate-800 font-medium">{ms(r.total_ms)}</td>
                    <td className="py-2 pr-3 text-slate-600">{r.cdn_vendor ?? '—'}</td>
                    <td className="py-2 pr-3"><CachePill status={r.cache_status} /></td>
                    <td className="py-2 pr-3 text-slate-500">{r.edge_pop ?? '—'}</td>
                    <td className="py-2 pr-3 text-slate-400 font-mono">{r.resolved_ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
