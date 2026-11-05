'use client'

// Per-check connection waterfall: a proportional stacked bar of the request phases
// (DNS → TCP → TLS → TTFB → download), the classic view for localizing latency.
type Phases = { dns: number | null; tcp: number | null; tls: number | null; ttfb: number | null; download: number | null }

const ORDER = ['dns', 'tcp', 'tls', 'ttfb', 'download'] as const
const COLORS: Record<string, string> = { dns: '#8b5cf6', tcp: '#6366f1', tls: '#0ea5e9', ttfb: '#f59e0b', download: '#10b981' }
const LABELS: Record<string, string> = { dns: 'DNS', tcp: 'TCP', tls: 'TLS', ttfb: 'TTFB', download: 'Download' }

export default function Waterfall({ phases }: { phases: Phases }) {
  const segs = ORDER.map(k => ({ k, v: phases[k] ?? 0 }))
  const total = segs.reduce((a, s) => a + s.v, 0) || 1
  return (
    <div>
      <div className="flex h-7 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
        {segs.map(s => s.v > 0 ? (
          <div key={s.k} style={{ width: `${(s.v / total) * 100}%`, background: COLORS[s.k] }}
            title={`${LABELS[s.k]}: ${Math.round(s.v)} ms`} />
        ) : null)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px]">
        {segs.map(s => (
          <span key={s.k} className="flex items-center gap-1 text-slate-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[s.k] }} />
            {LABELS[s.k]} <span className="font-medium text-slate-700">{s.v ? Math.round(s.v) + ' ms' : '—'}</span>
          </span>
        ))}
        <span className="flex items-center gap-1 text-slate-500 ml-auto">Total <span className="font-semibold text-slate-800">{Math.round(total)} ms</span></span>
      </div>
    </div>
  )
}
