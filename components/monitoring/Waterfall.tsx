'use client'

// Proper connection waterfall: each request phase on its own row, positioned at
// the time it STARTS along a shared ms axis (DNS → TCP connect → TLS → waiting/TTFB
// → content download), so you can see the layering and where latency accumulates.
type Phases = { dns: number | null; tcp: number | null; tls: number | null; ttfb: number | null; download: number | null }

const ROWS = [
  { key: 'dns', label: 'DNS lookup', color: '#8b5cf6' },
  { key: 'tcp', label: 'TCP connect', color: '#6366f1' },
  { key: 'tls', label: 'TLS handshake', color: '#0ea5e9' },
  { key: 'ttfb', label: 'Waiting (TTFB)', color: '#f59e0b' },
  { key: 'download', label: 'Content download', color: '#10b981' },
] as const

export default function Waterfall({ phases }: { phases: Phases }) {
  const vals = ROWS.map(r => ({ ...r, ms: Math.max(0, phases[r.key] ?? 0) }))
  const total = vals.reduce((a, v) => a + v.ms, 0) || 1
  // Cumulative start offset for each phase (that's what makes it a waterfall).
  const bars = vals.map((v, i) => ({ ...v, start: vals.slice(0, i).reduce((a, x) => a + x.ms, 0) }))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(total * f))
  const pct = (ms: number) => (ms / total) * 100

  return (
    <div className="text-[11px]">
      {/* time axis */}
      <div className="relative h-4 ml-36 mb-1">
        {ticks.map((t, i) => (
          <span key={i} className="absolute -translate-x-1/2 text-slate-400 tabular-nums" style={{ left: `${(t / total) * 100}%` }}>{t}ms</span>
        ))}
      </div>

      {bars.map(b => {
        const dominant = b.ms / total >= 0.4 // highlight the phase that dominates
        return (
          <div key={b.key} className="flex items-center gap-2 py-[3px]">
            <span className="w-36 shrink-0 text-right pr-1 text-slate-500">
              {b.label} <span className={`tabular-nums ${dominant ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{b.ms > 0 ? `${Math.round(b.ms)}ms` : '—'}</span>
            </span>
            <div className="relative flex-1 h-4 rounded bg-slate-50 border border-slate-100">
              {b.ms > 0 && (
                <div
                  className="absolute top-0 h-full rounded"
                  title={`${b.label}: ${Math.round(b.ms)} ms (starts at ${Math.round(b.start)} ms)`}
                  style={{ left: `${pct(b.start)}%`, width: `${Math.max(pct(b.ms), 1)}%`, background: b.color, boxShadow: dominant ? `0 0 0 1px ${b.color}` : undefined }}
                />
              )}
            </div>
          </div>
        )
      })}

      <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-slate-100">
        <span className="w-36 shrink-0 text-right pr-1 font-semibold text-slate-700">Total time</span>
        <span className="font-bold text-slate-900 tabular-nums">{Math.round(total)} ms</span>
      </div>
    </div>
  )
}
