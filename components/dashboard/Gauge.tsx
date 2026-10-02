import Sparkline from './Sparkline'

// Core Web Vitals score dial: a ring colored by Google's good / needs-improvement
// / poor thresholds, the p75 value in the center, a rating pill, and a sparkline.
export default function Gauge({
  label, value, thresholds, format, spark = [], sparkColorByRating = true,
}: {
  label: string
  value: number | null
  thresholds: [number, number] // [good ≤, needs-improvement ≤]; above = poor
  format: (v: number) => string
  spark?: number[]
  sparkColorByRating?: boolean
}) {
  const rating = value == null ? 'none' : value <= thresholds[0] ? 'good' : value <= thresholds[1] ? 'ni' : 'poor'
  const color = rating === 'good' ? '#10b981' : rating === 'ni' ? '#f59e0b' : rating === 'poor' ? '#ef4444' : '#cbd5e1'
  const ratingLabel = rating === 'good' ? 'Good' : rating === 'ni' ? 'Needs work' : rating === 'poor' ? 'Poor' : 'No data'
  const pill = rating === 'good' ? 'bg-emerald-50 text-emerald-700' : rating === 'ni' ? 'bg-amber-50 text-amber-700' : rating === 'poor' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'

  const cap = thresholds[1] * 1.5
  const frac = value == null ? 0 : Math.max(0.02, Math.min(value / cap, 1))
  const R = 52, C = 2 * Math.PI * R

  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 card-elev card-hover flex flex-col items-center">
      <div className="w-full flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${pill}`}>{ratingLabel}</span>
      </div>
      <div className="relative my-1">
        <svg viewBox="0 0 140 140" className="w-[128px] h-[128px]">
          <circle cx="70" cy="70" r={R} fill="none" stroke="#eef2f7" strokeWidth="12" />
          <circle
            cx="70" cy="70" r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
            strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 70 70)"
            style={{ transition: 'stroke-dasharray .6s ease, stroke .3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tracking-tight text-slate-900">{value == null ? '—' : format(value)}</span>
          <span className="text-[10px] text-slate-400 mt-0.5">p75</span>
        </div>
      </div>
      <div className="w-full mt-1 h-8">
        {spark.length > 1 && <Sparkline points={spark} color={sparkColorByRating ? color : '#94a3b8'} />}
      </div>
    </div>
  )
}
