'use client'

type DayRow = { day: string; pageviews: number; widgetOpens: number }

export default function AnalyticsPanel({ daily, title = 'Pageviews & Widget Opens' }: { daily: DayRow[]; title?: string }) {
  if (daily.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center shadow-sm">
        <p className="text-slate-400 text-sm">No pageview data yet. Add a site and embed the widget to start tracking.</p>
      </div>
    )
  }

  const maxPv = Math.max(...daily.map(d => d.pageviews), 1)
  const W = 600
  const H = 160
  const pad = { top: 12, right: 16, bottom: 24, left: 40 }
  const chartW = W - pad.left - pad.right
  const chartH = H - pad.top - pad.bottom

  const xStep = chartW / Math.max(daily.length - 1, 1)

  function yPos(val: number) {
    return pad.top + chartH - (val / maxPv) * chartH
  }

  function toPath(vals: number[]) {
    return vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${pad.left + i * xStep},${yPos(v)}`)
      .join(' ')
  }

  function toArea(vals: number[]) {
    const base = pad.top + chartH
    const line = vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${pad.left + i * xStep},${yPos(v)}`)
      .join(' ')
    const last = pad.left + (vals.length - 1) * xStep
    return `${line} L${last},${base} L${pad.left},${base} Z`
  }

  const pvPath = toPath(daily.map(d => d.pageviews))
  const pvArea = toArea(daily.map(d => d.pageviews))
  const woPath = toPath(daily.map(d => d.widgetOpens))

  // Y axis ticks
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxPv * f))

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-primary inline-block rounded" />Pageviews
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-violet inline-block rounded" />Widget opens
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 160 }}
        aria-label="Pageviews and widget opens chart"
      >
        <defs>
          <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366F1" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#6366F1" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {ticks.map(t => {
          const y = yPos(t)
          return (
            <g key={t}>
              <line x1={pad.left} y1={y} x2={pad.left + chartW} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
                {t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}
              </text>
            </g>
          )
        })}

        {/* X axis labels — show every nth label */}
        {daily.map((d, i) => {
          if (daily.length > 7 && i % 3 !== 0) return null
          const label = d.day.slice(5) // MM-DD
          return (
            <text
              key={i}
              x={pad.left + i * xStep}
              y={H - 4}
              textAnchor="middle"
              fontSize="10"
              fill="#94a3b8"
            >
              {label}
            </text>
          )
        })}

        {/* Pageview area + line */}
        <path d={pvArea} fill="url(#pvGrad)" />
        <path d={pvPath} fill="none" stroke="#6366F1" strokeWidth="2" strokeLinejoin="round" />

        {/* Widget opens line */}
        <path d={woPath} fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinejoin="round" strokeDasharray="4 2" />

        {/* Dots on last data point */}
        {daily.length > 0 && (() => {
          const last = daily[daily.length - 1]
          const lx = pad.left + (daily.length - 1) * xStep
          return (
            <>
              <circle cx={lx} cy={yPos(last.pageviews)} r="3" fill="#6366F1" />
              <circle cx={lx} cy={yPos(last.widgetOpens)} r="3" fill="#8B5CF6" />
            </>
          )
        })()}
      </svg>
    </div>
  )
}
