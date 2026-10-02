'use client'

import { useState } from 'react'

const PALETTE = ['#C9A227', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b', '#14b8a6']

// Interactive donut: hover a segment (or legend row) to highlight it and show its
// share in the center. Used for browser / device / OS breakdowns.
export default function Donut({
  title, items,
}: {
  title: string
  items: { label: string; views: number }[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const total = items.reduce((s, i) => s + i.views, 0)
  const R = 60, SW = 22, C = 2 * Math.PI * R
  // Precompute each segment's arc length and start offset (no render-time mutation).
  const segs = items.map(it => (it.views / (total || 1)) * C)
  const offsets = segs.map((_, i) => segs.slice(0, i).reduce((a, b) => a + b, 0))

  const center = hover != null && items[hover]
    ? { big: `${Math.round((items[hover].views / (total || 1)) * 100)}%`, small: items[hover].label }
    : { big: total.toLocaleString(), small: 'total' }

  return (
    <div className="ui-card">
      <div className="px-5 py-4 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-900">{title}</h3></div>
      {total === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400">No data</p>
      ) : (
        <div className="p-5 flex items-center gap-5">
          <div className="relative shrink-0">
            <svg viewBox="0 0 160 160" className="w-[136px] h-[136px]" onMouseLeave={() => setHover(null)}>
              <circle cx="80" cy="80" r={R} fill="none" stroke="#eef2f7" strokeWidth={SW} />
              {items.map((it, i) => {
                const seg = segs[i]
                const off = offsets[i]
                const active = hover === i
                return (
                  <circle
                    key={it.label}
                    cx="80" cy="80" r={R} fill="none"
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={active ? SW + 5 : SW}
                    strokeDasharray={`${seg - 1.5} ${C - seg + 1.5}`}
                    strokeDashoffset={-off}
                    transform="rotate(-90 80 80)"
                    style={{ transition: 'stroke-width .15s ease', cursor: 'pointer', opacity: hover == null || active ? 1 : 0.45 }}
                    onMouseEnter={() => setHover(i)}
                  />
                )
              })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-bold text-slate-900">{center.big}</span>
              <span className="text-[10px] text-slate-400 capitalize truncate max-w-[80px]">{center.small}</span>
            </div>
          </div>
          <ul className="flex-1 min-w-0 space-y-1.5">
            {items.slice(0, 6).map((it, i) => (
              <li
                key={it.label}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={`flex items-center gap-2 text-sm rounded-md px-2 py-1 cursor-default transition-colors ${hover === i ? 'bg-slate-50' : ''}`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="text-slate-600 truncate flex-1">{it.label}</span>
                <span className="text-slate-900 font-semibold">{Math.round((it.views / (total || 1)) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
