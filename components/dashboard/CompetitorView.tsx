'use client'

import { useCallback, useEffect, useState } from 'react'

type Site = { id: number; domain: string }
type Scorecard = {
  url: string; ok: boolean; statusCode: number | null; error: string | null
  a11yIssues: number; critical: number; serious: number; moderate: number; minor: number
  seoScore: number | null; seoIssues: number | null
}
type Result = { you: Scorecard; competitor: Scorecard }
type Report = {
  id: number; your_url: string; competitor_url: string
  status: 'pending' | 'running' | 'done' | 'failed'; error: string | null
  result: Result | null; created_at: string
}

function scoreColor(s: number | null) {
  if (s == null) return 'text-slate-400'
  return s >= 90 ? 'text-green-600' : s >= 70 ? 'text-amber-600' : 'text-red-600'
}

function Column({ title, card, badge }: { title: string; card: Scorecard; badge?: string }) {
  return (
    <div className="flex-1 rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-900 truncate">{title}</h4>
        {badge && <span className="text-[10px] font-semibold uppercase tracking-wider text-primary bg-primary-lt px-2 py-0.5 rounded-full">{badge}</span>}
      </div>
      <p className="text-xs text-slate-400 truncate mt-0.5">{card.url}</p>
      {card.error ? (
        <p className="text-sm text-red-600 mt-3">Couldn&apos;t audit: {card.error}</p>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className={`text-2xl font-bold ${card.seoScore == null ? 'text-slate-400' : scoreColor(card.seoScore)}`}>{card.seoScore ?? '—'}</p>
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">SEO score</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{card.a11yIssues}</p>
            <p className="text-[11px] text-slate-400 uppercase tracking-wide">A11y issues</p>
          </div>
          <div className="col-span-2 text-xs text-slate-500">
            {card.critical} critical · {card.serious} serious · {card.moderate} moderate · {card.minor} minor
          </div>
        </div>
      )}
    </div>
  )
}

function Scoreboard({ result }: { result: Result }) {
  const seoWin = (result.you.seoScore ?? -1) - (result.competitor.seoScore ?? -1)
  const a11yWin = result.competitor.a11yIssues - result.you.a11yIssues // fewer issues is better
  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-4">
        <Column title="Your site" card={result.you} badge="You" />
        <Column title="Competitor" card={result.competitor} />
      </div>
      {(result.you.ok && result.competitor.ok) && (
        <p className="mt-3 text-sm text-slate-600">
          {seoWin === 0 ? 'SEO scores are tied.' : seoWin > 0 ? `You lead on SEO by ${seoWin} points.` : `Competitor leads on SEO by ${-seoWin} points.`}
          {' '}
          {a11yWin === 0 ? 'Accessibility issues are even.' : a11yWin > 0 ? `You have ${a11yWin} fewer accessibility issues.` : `Competitor has ${-a11yWin} fewer accessibility issues.`}
        </p>
      )}
    </div>
  )
}

export default function CompetitorView({ sites, canPdf = false }: { sites: Site[]; canPdf?: boolean }) {
  const [siteId, setSiteId] = useState<number | null>(sites[0]?.id ?? null)
  const [competitorUrl, setCompetitorUrl] = useState('')
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<Report[]>([])

  const loadHistory = useCallback(async (id: number) => {
    const r = await fetch(`/api/competitor?site_id=${id}`)
    if (r.ok) { const d = await r.json(); setHistory(d.reports as Report[]) }
  }, [])

  useEffect(() => {
    if (!siteId) return
    let alive = true
    ;(async () => { if (alive) await loadHistory(siteId) })()
    return () => { alive = false }
  }, [siteId, loadHistory])

  // Poll while any comparison is still running — the work happens server-side,
  // so this keeps updating even after the user leaves and comes back.
  const hasPending = history.some(r => r.status === 'pending' || r.status === 'running')
  useEffect(() => {
    if (!siteId || !hasPending) return
    const t = setInterval(() => { loadHistory(siteId) }, 4000)
    return () => clearInterval(t)
  }, [siteId, hasPending, loadHistory])

  async function run() {
    if (!siteId || !competitorUrl.trim()) return
    setError(''); setLaunching(true)
    try {
      const r = await fetch('/api/competitor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, competitor_url: competitorUrl.trim() }),
      })
      const d = await r.json()
      if (!r.ok) { setError(d.message || d.error || 'Failed'); return }
      setCompetitorUrl('')
      // Optimistically show the pending row; polling takes over from here.
      setHistory(h => [{ id: d.id, your_url: d.your_url, competitor_url: d.competitor_url, status: 'pending', error: null, result: null, created_at: d.created_at }, ...h])
    } catch {
      setError('Network error')
    } finally {
      setLaunching(false)
    }
  }

  if (sites.length === 0) {
    return <div className="ui-card px-6 py-12 text-center text-slate-400 text-sm">Add a site first, then compare it against a competitor.</div>
  }

  return (
    <div className="space-y-6">
      <div className="ui-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <select value={siteId ?? ''} onChange={e => setSiteId(Number(e.target.value))}
            className="px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary">
            {sites.map(s => <option key={s.id} value={s.id}>{s.domain}</option>)}
          </select>
          <span className="text-slate-400 text-sm">vs.</span>
          <input value={competitorUrl} onChange={e => setCompetitorUrl(e.target.value)} placeholder="https://competitor.com"
            className="flex-1 min-w-[220px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-slate-400" />
          <button onClick={run} disabled={launching || !competitorUrl.trim()}
            className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {launching ? 'Starting…' : 'Compare'}
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">Audits your homepage and the competitor&apos;s for accessibility + technical SEO. Runs in the background (~20–40s) — you can leave this page and come back.</p>
        {error && <p className="text-red-600 text-xs mt-2">{error}</p>}
      </div>

      <div className="ui-card">
        <div className="px-5 py-3.5 border-b border-slate-100"><h3 className="text-sm font-semibold text-slate-900">Comparisons</h3></div>
        {history.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-400">No comparisons yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map(rep => (
              <li key={rep.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-xs text-slate-400 truncate">{new Date(rep.created_at).toLocaleString()} · vs {rep.competitor_url}</p>
                  {rep.status === 'done' && canPdf && (
                    <a href={`/api/competitor/${rep.id}/pdf`} className="shrink-0 text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50">⬇ PDF</a>
                  )}
                </div>
                {rep.status === 'pending' || rep.status === 'running' ? (
                  <p className="text-sm text-slate-500 flex items-center gap-2"><span className="inline-block animate-pulse text-primary">●</span> Comparing both sites…</p>
                ) : rep.status === 'failed' ? (
                  <p className="text-sm text-red-600">Comparison failed{rep.error ? `: ${rep.error}` : ''}.</p>
                ) : rep.result ? (
                  <Scoreboard result={rep.result} />
                ) : (
                  <p className="text-sm text-slate-400">No result.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
