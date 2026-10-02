import React from 'react'

// Shared dashboard UI primitives — modern, soft, indigo/violet themed.

export function PageHeader({
  title, subtitle, eyebrow, icon, actions,
}: {
  title: string
  subtitle?: string
  eyebrow?: string
  icon?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3.5">
        {icon && (
          <span className="mt-0.5 w-11 h-11 rounded-2xl bg-gradient-to-br from-primary to-violet text-white flex items-center justify-center text-xl shadow-lg shadow-primary/25 shrink-0" aria-hidden>
            {icon}
          </span>
        )}
        <div>
          {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-widest text-primary mb-1">{eyebrow}</p>}
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="text-slate-500 text-sm mt-1">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

function Spark({ points, color = 'var(--color-primary)' }: { points: number[]; color?: string }) {
  if (!points || points.length < 2) return null
  const max = Math.max(...points, 1), min = Math.min(...points, 0)
  const range = max - min || 1
  const w = 100, h = 30
  const d = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / range) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8 mt-2" aria-hidden>
      <polyline points={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function StatCard({
  label, value, sub, icon, tint = 'tint-indigo', valueClass = 'text-slate-900', delta, spark,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  icon?: string
  tint?: string
  valueClass?: string
  delta?: number
  spark?: number[]
}) {
  return (
    <div className="group relative ui-card ui-card-hover p-5 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        {icon && <span className={`w-11 h-11 rounded-2xl flex items-center justify-center text-lg ${tint}`} aria-hidden>{icon}</span>}
        {typeof delta === 'number' && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${delta >= 0 ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
      <p className={`text-[28px] leading-tight font-bold tracking-tight mt-0.5 ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
      {spark && <Spark points={spark} />}
    </div>
  )
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`ui-card ${className}`}>{children}</div>
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {action}
    </div>
  )
}
