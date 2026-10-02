'use client'

import { useEffect, useState } from 'react'
import MiniChart, { type Point } from './MiniChart'
import Gauge from './Gauge'
import Donut from './Donut'
import Sparkline from './Sparkline'
import UrlDetailModal from './UrlDetailModal'

type Site = { id: number; domain: string }

type Series = { bucket: string; pageViews: number; lcp: number | null; fcp: number | null; ttfb: number | null; inp: number | null; cls: number | null; loadTime: number | null }

type Stats = {
  empty?: boolean
  overview: {
    pageViews: number; sessions: number
    avgLoad: number | null; p75Load: number | null; p95Load: number | null
    avgTtfb: number | null; avgLcp: number | null; p75Lcp: number | null; p95Lcp: number | null
    avgFcp: number | null; avgInp: number | null; avgCls: number | null
    p75Inp: number | null; p75Cls: number | null; p75Fcp: number | null; p75Ttfb: number | null
    spaRoutes: number; spaFcp: number | null
    jsErrors: number; ajaxTotal: number; ajaxErrors: number; ajaxErrorRate: number
  }
  series: Series[]
  errorSeries: { bucket: string; errors: number }[]
  ajaxSeries: { bucket: string; total: number; errors: number }[]
  byPath: { path: string; views: number; avgLoad: number | null; avgLcp: number | null }[]
  byBrowser: { label: string; views: number }[]
  byDevice: { label: string; views: number }[]
  byOs: { label: string; views: number }[]
  slowestPages: { path: string; views: number; p75Load: number | null }[]
  topErrors: { message: string; type: string; count: number; lastSeen: string }[]
  slowestAjax: { url: string; method: string; calls: number; avgMs: number | null; p95Ms: number | null; errors: number }[]
  urlVitals: { path: string; pageViews: number; lcp: number | null; inp: number | null; cls: number | null; loadTime: number | null }[]
  byBrowserVersion: { browser: string; version: string; pageViews: number; lcp: number | null; inp: number | null; cls: number | null }[]
  byCountry: { country: string; pageViews: number; lcp: number | null; inp: number | null; cls: number | null }[]
  byCity: { city: string; country: string; pageViews: number; lcp: number | null; inp: number | null }[]
  byConnection: { connection: string; pageViews: number; lcp: number | null; inp: number | null }[]
  distributions: { lcp: Dist; inp: Dist; cls: Dist }
}
type Dist = { good: number; ni: number; poor: number }
type View = 'overview' | 'webvitals' | 'segments'

const PERIODS: [string, string][] = [['24h', 'Last 24h'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days']]
const ms = (v: number | null) => v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`
const sec = (v: number | null) => v == null ? '—' : `${(v / 1000).toFixed(2)} s`

type ExpKey = 'pageViews' | 'loadTime' | 'lcp' | 'fcp' | 'ttfb' | 'inp' | 'cls' | 'jsErrors' | 'ajaxErrors'
const EXPLORER: { key: ExpKey; label: string; type: 'line' | 'bar'; color: string; fmt: (v: number) => string; src: 'series' | 'error' | 'ajax'; sel?: (r: Series) => number | null }[] = [
  { key: 'pageViews', label: 'Page views', type: 'bar', color: '#C9A227', fmt: v => Math.round(v).toLocaleString(), src: 'series', sel: r => r.pageViews },
  { key: 'loadTime', label: 'Load time', type: 'line', color: '#0ea5e9', fmt: ms, src: 'series', sel: r => r.loadTime },
  { key: 'lcp', label: 'LCP', type: 'line', color: '#3b82f6', fmt: ms, src: 'series', sel: r => r.lcp },
  { key: 'fcp', label: 'FCP', type: 'line', color: '#8b5cf6', fmt: ms, src: 'series', sel: r => r.fcp },
  { key: 'ttfb', label: 'TTFB', type: 'line', color: '#10b981', fmt: ms, src: 'series', sel: r => r.ttfb },
  { key: 'inp', label: 'INP', type: 'line', color: '#f59e0b', fmt: ms, src: 'series', sel: r => r.inp },
  { key: 'cls', label: 'CLS', type: 'line', color: '#ec4899', fmt: v => v.toFixed(3), src: 'series', sel: r => r.cls },
  { key: 'jsErrors', label: 'JS errors', type: 'bar', color: '#ef4444', fmt: v => Math.round(v).toString(), src: 'error' },
  { key: 'ajaxErrors', label: 'AJAX errors', type: 'bar', color: '#f97316', fmt: v => Math.round(v).toString(), src: 'ajax' },
]

export default function RumDashboard({ sites, lockedSiteId }: { sites: Site[]; lockedSiteId?: number }) {
  const [period, setPeriod] = useState('7d')
  const [siteId, setSiteId] = useState(lockedSiteId ? String(lockedSiteId) : '')
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<ExpKey>('pageViews')
  const [view, setView] = useState<View>('overview')
  const [openUrl, setOpenUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const qs = new URLSearchParams({ period })
      if (siteId) qs.set('site_id', siteId)
      const res = await fetch(`/api/rum/stats?${qs}`)
      if (!res.ok || cancelled) return
      const json = await res.json()
      if (!cancelled) { setData(json); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [period, siteId])

  const fx = (x: string) => {
    const d = new Date(x)
    if (isNaN(d.getTime())) return x
    return period === '24h' ? `${String(d.getHours()).padStart(2, '0')}:00` : `${d.getMonth() + 1}/${d.getDate()}`
  }

  const o = data?.overview
  const series = data?.series || []
  const sparkOf = (sel: (r: Series) => number | null) => series.map(r => sel(r) ?? 0)

  const exp = EXPLORER.find(e => e.key === metric)!
  const expPoints: Point[] = exp.src === 'series'
    ? series.map(r => ({ x: r.bucket, y: exp.sel!(r) }))
    : exp.src === 'error'
      ? (data?.errorSeries || []).map(r => ({ x: r.bucket, y: r.errors }))
      : (data?.ajaxSeries || []).map(r => ({ x: r.bucket, y: r.errors }))

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 p-0.5 bg-white card-elev">
          {PERIODS.map(([v, l]) => (
            <button key={v} onClick={() => { setPeriod(v); setLoading(true) }}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${period === v ? 'bg-slate-900 text-white font-medium' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
          ))}
        </div>
        {!lockedSiteId && (
          <select value={siteId} onChange={e => { setSiteId(e.target.value); setLoading(true) }}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white card-elev focus:outline-none focus:ring-2 focus:ring-primary">
            <option value="">All sites</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
          </select>
        )}
        <span className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pulse-ring" />
          {loading ? 'Syncing…' : 'Live'}
        </span>
      </div>

      {sites.length === 0 ? (
        <Empty text="Add a site and enable the RUM add-on to start collecting data." />
      ) : !o || data?.empty ? (
        <Empty text="No monitoring data yet. Enable RUM on a site (Sites → Enable RUM) and install the widget." />
      ) : (
        <>
          {/* Sub-tabs */}
          <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
            {(['overview', 'webvitals', 'segments'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 whitespace-nowrap transition-colors
                  ${view === v ? 'border-primary text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {v === 'overview' ? 'Overview' : v === 'webvitals' ? 'Web Vitals' : 'Segments'}
              </button>
            ))}
          </div>

          {view === 'overview' && (
          <div className="space-y-6">
          {/* Core Web Vitals */}
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              Core Web Vitals <span className="text-xs font-normal text-slate-400">· 75th percentile</span>
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
              <Gauge label="LCP" value={o.p75Lcp} thresholds={[2500, 4000]} format={sec} spark={sparkOf(r => r.lcp)} />
              <Gauge label="INP" value={o.p75Inp} thresholds={[200, 500]} format={ms} spark={sparkOf(r => r.inp)} />
              <Gauge label="CLS" value={o.p75Cls} thresholds={[0.1, 0.25]} format={v => v.toFixed(3)} spark={sparkOf(r => r.cls)} />
              <Gauge label="FCP" value={o.p75Fcp} thresholds={[1800, 3000]} format={sec} spark={sparkOf(r => r.fcp)} />
              <Gauge label="TTFB" value={o.p75Ttfb} thresholds={[800, 1800]} format={ms} spark={sparkOf(r => r.ttfb)} />
            </div>
          </div>

          {/* KPI cards with sparklines */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
            <Kpi label="Page views" value={o.pageViews.toLocaleString()} color="#C9A227" spark={sparkOf(r => r.pageViews)} />
            <Kpi label="Unique sessions" value={o.sessions.toLocaleString()} color="#3b82f6" spark={sparkOf(r => r.pageViews).map(v => v * 0.6)} />
            <Kpi label="Avg page load" value={ms(o.avgLoad)} color="#0ea5e9" spark={sparkOf(r => r.loadTime)} />
            <Kpi label="JS errors" value={o.jsErrors.toLocaleString()} color="#ef4444" valueClass={o.jsErrors > 0 ? 'text-red-600' : ''} spark={(data.errorSeries || []).map(r => r.errors)} />
            <Kpi label="AJAX error rate" value={`${o.ajaxErrorRate}%`} color="#f97316" valueClass={o.ajaxErrorRate > 0 ? 'text-orange-600' : ''} spark={(data.ajaxSeries || []).map(r => r.total ? (r.errors / r.total) * 100 : 0)} />
            <Kpi label="SPA route render (p75)" value={ms(o.spaFcp)} color="#8b5cf6" spark={[]} />
            <Kpi label="SPA route changes" value={o.spaRoutes.toLocaleString()} color="#8b5cf6" spark={[]} />
          </div>

          {/* Interactive metric explorer */}
          <div className="ui-card">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Metric explorer</h2>
              <div className="flex flex-wrap gap-1.5">
                {EXPLORER.map(e => (
                  <button key={e.key} onClick={() => setMetric(e.key)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${metric === e.key ? 'text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                    style={metric === e.key ? { background: e.color } : undefined}>
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4">
              <div className="[&_svg]:!h-[280px]">
                <MiniChart title="" points={expPoints} type={exp.type} color={exp.color} format={exp.fmt} formatX={fx} />
              </div>
            </div>
          </div>

          {/* Breakdowns — donuts */}
          <div className="grid md:grid-cols-3 gap-4">
            <Donut title="Browser" items={data.byBrowser} />
            <Donut title="Device" items={data.byDevice} />
            <Donut title="Operating system" items={data.byOs} />
          </div>

          {/* Tables */}
          <div className="grid lg:grid-cols-2 gap-4">
            <Panel title="Performance by page">
              <Table head={['Page', 'Views', 'Avg load', 'Avg LCP']} rows={data.byPath.map(r => [trunc(r.path), r.views.toLocaleString(), ms(r.avgLoad), ms(r.avgLcp)])} />
            </Panel>
            <Panel title="Slowest pages (p75 load)">
              <Table head={['Page', 'Views', 'p75 load']} rows={data.slowestPages.map(r => [trunc(r.path), r.views.toLocaleString(), ms(r.p75Load)])} />
            </Panel>
            <Panel title="Most common JS errors">
              <Table head={['Error', 'Type', 'Count']} rows={data.topErrors.map(r => [trunc(String(r.message), 46), String(r.type ?? ''), String(r.count)])} />
            </Panel>
            <Panel title="Slowest AJAX requests">
              <Table head={['Endpoint', 'Method', 'Calls', 'Avg', 'p95', 'Err']} rows={data.slowestAjax.map(r => [trunc(r.url, 34), r.method, String(r.calls), ms(r.avgMs), ms(r.p95Ms), String(r.errors)])} />
            </Panel>
          </div>
          </div>
          )}

          {view === 'webvitals' && <WebVitalsView data={data} onOpenUrl={setOpenUrl} />}
          {view === 'segments' && <SegmentsView data={data} />}
        </>
      )}

      {openUrl && <UrlDetailModal siteId={siteId} path={openUrl} period={period} onClose={() => setOpenUrl(null)} />}
    </div>
  )
}

// ── Web Vitals: sortable per-URL table + rating distributions ──
function WebVitalsView({ data, onOpenUrl }: { data: Stats; onOpenUrl: (p: string) => void }) {
  const [sort, setSort] = useState<{ key: 'pageViews' | 'lcp' | 'inp' | 'cls' | 'loadTime'; dir: 1 | -1 }>({ key: 'pageViews', dir: -1 })
  const rows = [...data.urlVitals].sort((a, b) => {
    const av = a[sort.key] ?? -Infinity, bv = b[sort.key] ?? -Infinity
    return (av === bv ? 0 : av > bv ? 1 : -1) * sort.dir
  })
  const setKey = (key: typeof sort.key) => setSort(s => s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) } : { key, dir: -1 })
  const arrow = (key: typeof sort.key) => sort.key === key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''
  // Plain render helper (not a component) so it isn't recreated as a component each render.
  const th = (k: typeof sort.key, label: string, num?: boolean) => (
    <th key={k} className={`px-4 py-2.5 font-medium cursor-pointer select-none hover:text-slate-700 whitespace-nowrap ${num ? 'text-right' : 'text-left'}`} onClick={() => setKey(k)}>{label}{arrow(k)}</th>
  )

  return (
    <div className="space-y-6">
      {/* CWV distributions */}
      <div className="grid md:grid-cols-3 gap-4">
        <DistCard title="Largest Contentful Paint" sub="Loading" d={data.distributions.lcp} p75={ms(data.overview.p75Lcp)} thr={[2500, 4000]} val={data.overview.p75Lcp} />
        <DistCard title="Interaction to Next Paint" sub="Responsiveness" d={data.distributions.inp} p75={ms(data.overview.p75Inp)} thr={[200, 500]} val={data.overview.p75Inp} />
        <DistCard title="Cumulative Layout Shift" sub="Visual stability" d={data.distributions.cls} p75={(data.overview.p75Cls ?? 0).toFixed(3)} thr={[0.1, 0.25]} val={data.overview.p75Cls} />
      </div>

      {/* Page URLs */}
      <div className="ui-card">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Page URLs — Web Vitals (p75)</h3>
          <span className="text-xs text-slate-400">click a URL for detail · click a column to sort</span>
        </div>
        {rows.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-400">No data</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-xs text-slate-400 uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium text-left">Page URL</th>
                {th('lcp', 'LCP', true)}{th('inp', 'INP', true)}{th('cls', 'CLS', true)}{th('loadTime', 'Load', true)}{th('pageViews', 'Views', true)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} onClick={() => onOpenUrl(r.path)} className="text-slate-700 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-2.5 font-mono text-xs text-primary max-w-[280px] truncate">{r.path}</td>
                    <td className={`px-4 py-2.5 text-right whitespace-nowrap ${rate(r.lcp, [2500, 4000])}`}>{ms(r.lcp)}</td>
                    <td className={`px-4 py-2.5 text-right whitespace-nowrap ${rate(r.inp, [200, 500])}`}>{ms(r.inp)}</td>
                    <td className={`px-4 py-2.5 text-right whitespace-nowrap ${rate(r.cls, [0.1, 0.25])}`}>{r.cls == null ? '—' : r.cls.toFixed(3)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-slate-600">{ms(r.loadTime)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium">{r.pageViews.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function DistCard({ title, sub, d, p75, thr, val }: { title: string; sub: string; d: Dist; p75: string; thr: number[]; val: number | null }) {
  const total = d.good + d.ni + d.poor || 1
  const pct = (x: number) => `${Math.round((x / total) * 100)}%`
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-5 card-elev">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="text-xs text-slate-400">{sub}</p>
      <p className={`text-2xl font-bold mt-2 ${rate(val, thr)}`}>{p75} <span className="text-xs font-medium text-slate-400">p75</span></p>
      <div className="mt-3 flex h-2 rounded-full overflow-hidden bg-slate-100">
        <span className="bg-emerald-500" style={{ width: pct(d.good) }} />
        <span className="bg-amber-500" style={{ width: pct(d.ni) }} />
        <span className="bg-red-500" style={{ width: pct(d.poor) }} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-slate-500">
        <span className="text-emerald-600">Good {pct(d.good)}</span>
        <span className="text-amber-600">NI {pct(d.ni)}</span>
        <span className="text-red-600">Poor {pct(d.poor)}</span>
      </div>
    </div>
  )
}

// ── Segments: browser+version / device / OS / geography / network ──
function SegmentsView({ data }: { data: Stats }) {
  const vitalsHead = ['LCP', 'INP', 'CLS', 'Views']
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <SegPanel title="Browser & version" head={['Browser', ...vitalsHead]}
        rows={data.byBrowserVersion.map(r => [`${r.browser} ${r.version}`, ms(r.lcp), ms(r.inp), r.cls == null ? '—' : r.cls.toFixed(3), r.pageViews.toLocaleString()])} />
      <SegPanel title="Geography — countries" head={['Country', ...vitalsHead]}
        rows={data.byCountry.map(r => [String(r.country), ms(r.lcp), ms(r.inp), r.cls == null ? '—' : r.cls.toFixed(3), r.pageViews.toLocaleString()])} />
      <SegPanel title="Geography — top cities" head={['City', 'Country', 'LCP', 'INP', 'Views']}
        rows={data.byCity.map(r => [String(r.city), String(r.country), ms(r.lcp), ms(r.inp), r.pageViews.toLocaleString()])} />
      <SegPanel title="Device" head={['Device', 'Views']} rows={data.byDevice.map(r => [String(r.label), r.views.toLocaleString()])} />
      <SegPanel title="Operating system" head={['OS', 'Views']} rows={data.byOs.map(r => [String(r.label), r.views.toLocaleString()])} />
      <SegPanel title="Network connection" head={['Connection', 'LCP', 'INP', 'Views']}
        rows={data.byConnection.map(r => [String(r.connection), ms(r.lcp), ms(r.inp), r.pageViews.toLocaleString()])} />
    </div>
  )
}

function SegPanel({ title, head, rows, pageSize = 10 }: { title: string; head: string[]; rows: (string | number)[][]; pageSize?: number }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const p = Math.min(page, pages - 1)
  const slice = rows.slice(p * pageSize, p * pageSize + pageSize)
  return (
    <div className="ui-card flex flex-col">
      <div className="px-5 py-4 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-900">{title}</h3></div>
      {rows.length === 0 ? <p className="px-5 py-8 text-center text-sm text-slate-400">No data</p> : (
        <>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-400 uppercase tracking-wide">
                {head.map((h, i) => <th key={i} className={`px-4 py-2.5 font-medium ${i === 0 ? 'text-left' : 'text-right whitespace-nowrap'}`}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {slice.map((r, i) => (
                  <tr key={p * pageSize + i} className="text-slate-700 hover:bg-slate-50">
                    {r.map((c, j) => <td key={j} className={`px-4 py-2.5 ${j === 0 ? 'text-slate-700 max-w-[220px] truncate' : 'text-right whitespace-nowrap'}`}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={p} pages={pages} total={rows.length} pageSize={pageSize} onPage={setPage} />
        </>
      )}
    </div>
  )
}

// Client-side pager footer — renders one page of rows at a time (never all at once).
function Pager({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (n: number) => void }) {
  if (pages <= 1) return null
  const from = page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  const btn = 'px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-colors'
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-xs text-slate-500">
      <span>Showing <span className="font-medium text-slate-700">{from}–{to}</span> of {total}</span>
      <div className="flex items-center gap-1.5">
        <button className={btn} disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</button>
        <span className="px-1 tabular-nums">{page + 1} / {pages}</span>
        <button className={btn} disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  )
}

function rate(v: number | null, thr: number[]) {
  return v == null ? 'text-slate-500' : v <= thr[0] ? 'text-emerald-600' : v <= thr[1] ? 'text-amber-600' : 'text-red-600'
}

function trunc(s: string, n = 40) { return s && s.length > n ? s.slice(0, n) + '…' : s }

function Kpi({ label, value, color, spark, valueClass = 'text-slate-900' }: { label: string; value: string; color: string; spark: number[]; valueClass?: string }) {
  const first = spark.find(v => v > 0) ?? spark[0] ?? 0
  const last = spark[spark.length - 1] ?? 0
  const delta = first ? Math.round(((last - first) / first) * 100) : 0
  return (
    <div className="bg-white rounded-2xl border border-slate-200/70 p-4 card-elev card-hover">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
        {Number.isFinite(delta) && delta !== 0 && (
          <span className={`text-[10px] font-semibold ${delta > 0 ? 'text-slate-500' : 'text-slate-500'}`}>{delta > 0 ? '↑' : '↓'}{Math.abs(delta)}%</span>
        )}
      </div>
      <p className={`text-2xl font-bold tracking-tight mt-1 ${valueClass}`}>{value}</p>
      <div className="h-8 mt-1">{spark.length > 1 && <Sparkline points={spark} color={color} />}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ui-card">
      <div className="px-5 py-4 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-900">{title}</h3></div>
      <div className="p-2">{children}</div>
    </div>
  )
}

function Table({ head, rows, pageSize = 10 }: { head: string[]; rows: (string | number)[][]; pageSize?: number }) {
  const [page, setPage] = useState(0)
  if (rows.length === 0) return <p className="px-3 py-6 text-center text-sm text-slate-400">No data</p>
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const p = Math.min(page, pages - 1)
  const slice = rows.slice(p * pageSize, p * pageSize + pageSize)
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
            {head.map((h, i) => <th key={i} className={`px-3 py-2 font-medium ${i === 0 ? '' : 'whitespace-nowrap'}`}>{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {slice.map((r, i) => (
              <tr key={p * pageSize + i} className="text-slate-700 hover:bg-slate-50/70">
                {r.map((c, j) => <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-mono text-xs text-slate-600 max-w-[200px] truncate' : 'whitespace-nowrap'}`}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={p} pages={pages} total={rows.length} pageSize={pageSize} onPage={setPage} />
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="ui-card px-6 py-16 text-center text-slate-400 text-sm">{text}</div>
}
