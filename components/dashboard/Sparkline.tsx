// Tiny inline trend line (no axes) for KPI cards and gauges.
export default function Sparkline({
  points, color = '#94a3b8', fill = true,
}: {
  points: (number | null)[]
  color?: string
  fill?: boolean
}) {
  const vals = points.map(p => (p == null ? 0 : p))
  const W = 100, H = 30
  const max = Math.max(...vals, 1)
  const min = Math.min(...vals, 0)
  const range = max - min || 1
  const xAt = (i: number) => (points.length <= 1 ? W / 2 : (i / (points.length - 1)) * W)
  const yAt = (v: number) => H - 2 - ((v - min) / range) * (H - 4)
  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const gid = `sp-${color.replace('#', '')}-${points.length}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-full" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
