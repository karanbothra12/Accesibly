'use client'

import { useRef, useState } from 'react'

export type Point = { x: string; y: number | null }

// Interactive responsive SVG line/bar chart — points, hover crosshair + tooltip,
// works with a single data point too. No charting dependency.
export default function MiniChart({
  title,
  points,
  type = 'line',
  color = '#3b82f6',
  format = (v: number) => String(Math.round(v)),
  formatX,
  dark = false,
}: {
  title: string
  points: Point[]
  type?: 'line' | 'bar'
  color?: string
  format?: (v: number) => string
  formatX?: (x: string) => string
  dark?: boolean
}) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  const W = 600, H = 180
  const pad = { top: 14, right: 16, bottom: 28, left: 46 }
  const chartW = W - pad.left - pad.right
  const chartH = H - pad.top - pad.bottom

  const hasData = points.some(p => p.y != null)
  const maxV = Math.max(...points.map(p => (p.y == null ? 0 : p.y)), 1)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => maxV * f)

  const xAt = (i: number) => pad.left + (points.length <= 1 ? chartW / 2 : (i / (points.length - 1)) * chartW)
  const yAt = (v: number) => pad.top + chartH - (v / maxV) * chartH

  const defaultFormatX = (x: string) => {
    const d = new Date(x)
    return isNaN(d.getTime()) ? x : `${d.getMonth() + 1}/${d.getDate()}`
  }
  const fx = formatX || defaultFormatX
  const gradId = `g-${title.replace(/[^a-z0-9]/gi, '')}`

  const grid = dark ? 'rgba(255,255,255,.12)' : '#e2e8f0'
  const axisText = dark ? 'rgba(255,255,255,.55)' : '#94a3b8'

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.y == null ? 0 : p.y)}`).join(' ')
  const areaPath = hasData ? `${linePath} L${xAt(points.length - 1)},${pad.top + chartH} L${xAt(0)},${pad.top + chartH} Z` : ''

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg || points.length === 0) return
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const loc = pt.matrixTransform(ctm.inverse())
    let best = 0, bd = Infinity
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(xAt(i) - loc.x)
      if (d < bd) { bd = d; best = i }
    }
    setHover(best)
  }

  return (
    <div className={
      !title ? 'p-0'
        : dark ? 'rounded-2xl border p-4 bg-white/5 border-white/10'
          : 'rounded-2xl border p-4 bg-white border-slate-200/70 card-elev'
    }>
      {title ? <h3 className={`text-sm font-semibold mb-2 ${dark ? 'text-white' : 'text-slate-800'}`}>{title}</h3> : null}
      {!hasData ? (
        <div className={`h-[160px] flex items-center justify-center text-xs ${dark ? 'text-white/50' : 'text-slate-400'}`}>No data in this range</div>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ height: 160, cursor: 'crosshair', touchAction: 'none' }}
          role="img"
          aria-label={title}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={dark ? 0.35 : 0.18} />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.left} y1={yAt(t)} x2={pad.left + chartW} y2={yAt(t)} stroke={grid} strokeWidth="1" />
              <text x={pad.left - 6} y={yAt(t) + 4} textAnchor="end" fontSize="10" fill={axisText}>{format(t)}</text>
            </g>
          ))}

          {points.map((p, i) => {
            if (points.length > 8 && i % Math.ceil(points.length / 6) !== 0 && i !== points.length - 1) return null
            return <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={axisText}>{fx(p.x)}</text>
          })}

          {type === 'bar' ? (
            points.map((p, i) => {
              const bw = Math.max(3, (chartW / points.length) * 0.62)
              const v = p.y == null ? 0 : p.y
              return <rect key={i} x={xAt(i) - bw / 2} y={yAt(v)} width={bw} height={pad.top + chartH - yAt(v)} rx="2"
                fill={color} opacity={hover === i ? 1 : 0.82} />
            })
          ) : (
            <>
              <path d={areaPath} fill={`url(#${gradId})`} />
              <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {points.map((p, i) => p.y == null ? null : (
                <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r={points.length > 40 ? 2 : 3} fill={dark ? '#0b1120' : '#fff'} stroke={color} strokeWidth="2" />
              ))}
            </>
          )}

          {/* Hover crosshair + tooltip */}
          {hover != null && points[hover] && (() => {
            const p = points[hover]
            const v = p.y == null ? 0 : p.y
            const cx = xAt(hover), cy = yAt(v)
            const l1 = fx(p.x)
            const l2 = p.y == null ? '—' : format(p.y)
            const tw = Math.max(l1.length, l2.length) * 6.4 + 18
            const th = 36
            let tx = cx - tw / 2
            tx = Math.max(pad.left, Math.min(tx, pad.left + chartW - tw))
            let ty = cy - th - 12
            if (ty < pad.top) ty = cy + 14
            return (
              <g pointerEvents="none">
                <line x1={cx} y1={pad.top} x2={cx} y2={pad.top + chartH} stroke={dark ? 'rgba(255,255,255,.35)' : '#cbd5e1'} strokeWidth="1" strokeDasharray="3 3" />
                <circle cx={cx} cy={cy} r="5" fill={color} stroke="#fff" strokeWidth="2" />
                <rect x={tx} y={ty} width={tw} height={th} rx="6" fill="#0f172a" />
                <text x={tx + tw / 2} y={ty + 15} textAnchor="middle" fontSize="10" fill="#94a3b8">{l1}</text>
                <text x={tx + tw / 2} y={ty + 28} textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">{l2}</text>
              </g>
            )
          })()}
        </svg>
      )}
    </div>
  )
}
