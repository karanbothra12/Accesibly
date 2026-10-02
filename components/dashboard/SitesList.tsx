'use client'

import { useState } from 'react'

type Site = {
  id: number
  domain: string
  site_key: string
  is_active: boolean
  rum_enabled: boolean
  widget_position?: string
  widget_hidden?: boolean
  created_at: string
}

const POSITIONS: { value: string; label: string }[] = [
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'top-left', label: 'Top left' },
]

export default function SitesList({ initialSites }: { initialSites: Site[] }) {
  const [sites, setSites] = useState<Site[]>(initialSites)
  const [adding, setAdding] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [addError, setAddError] = useState('')
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [copiedKey, setCopiedKey] = useState<number | null>(null)

  async function handleAdd() {
    if (!newDomain.trim()) return
    setAddError('')
    setAdding(true)
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: newDomain }),
      })
      const data = await res.json()
      if (!res.ok) { setAddError(data.error || 'Failed to add site'); return }
      setSites(prev => [data.site, ...prev])
      setNewDomain('')
    } catch {
      setAddError('Network error')
    } finally {
      setAdding(false)
    }
  }

  async function toggleActive(site: Site) {
    setLoadingId(site.id)
    try {
      const res = await fetch('/api/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, is_active: !site.is_active }),
      })
      const data = await res.json()
      if (res.ok) {
        setSites(prev => prev.map(s => s.id === site.id ? data.site : s))
      }
    } finally {
      setLoadingId(null)
    }
  }

  async function toggleRum(site: Site) {
    setLoadingId(site.id)
    try {
      const res = await fetch('/api/sites', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, rum_enabled: !site.rum_enabled }),
      })
      const data = await res.json()
      if (res.ok) setSites(prev => prev.map(s => s.id === site.id ? data.site : s))
    } finally {
      setLoadingId(null)
    }
  }

  async function setPosition(site: Site, widget_position: string) {
    setLoadingId(site.id)
    try {
      const res = await fetch('/api/sites', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, widget_position }),
      })
      const data = await res.json()
      if (res.ok) setSites(prev => prev.map(s => s.id === site.id ? data.site : s))
    } finally { setLoadingId(null) }
  }

  async function toggleHidden(site: Site) {
    setLoadingId(site.id)
    try {
      const res = await fetch('/api/sites', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: site.id, widget_hidden: !site.widget_hidden }),
      })
      const data = await res.json()
      if (res.ok) setSites(prev => prev.map(s => s.id === site.id ? data.site : s))
    } finally { setLoadingId(null) }
  }

  async function deleteSite(id: number) {
    if (!confirm('Delete this site? All associated data will be removed.')) return
    setLoadingId(id)
    try {
      const res = await fetch('/api/sites', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) setSites(prev => prev.filter(s => s.id !== id))
    } finally {
      setLoadingId(null)
    }
  }

  function copyKey(id: number, key: string) {
    navigator.clipboard.writeText(key)
    setCopiedKey(id)
    setTimeout(() => setCopiedKey(null), 1800)
  }

  const cdnUrl = process.env.NEXT_PUBLIC_WIDGET_CDN_URL || '/widget.min.js'

  return (
    <div className="ui-card">
      {/* Add site row */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex gap-2">
          <input
            type="text"
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="example.com"
            className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary placeholder:text-slate-400"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newDomain.trim()}
            className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50
                       text-white text-sm font-medium rounded-lg transition-colors"
          >
            {adding ? 'Adding…' : '+ Add site'}
          </button>
        </div>
        {addError && <p className="text-red-600 text-xs mt-2">{addError}</p>}
      </div>

      {/* Site rows */}
      {sites.length === 0 ? (
        <div className="px-6 py-12 text-center text-slate-400 text-sm">
          No sites yet. Add your first domain above.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {sites.map(site => (
            <li key={site.id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-slate-900 text-sm truncate">{site.domain}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                      ${site.is_active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {site.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                      ${site.rum_enabled ? 'bg-primary-lt text-primary' : 'bg-slate-100 text-slate-400'}`}>
                      {site.rum_enabled ? 'RUM add-on' : 'RUM off'}
                    </span>
                  </div>

                  {/* Embed snippet — one tag; RUM loads automatically when the add-on is on */}
                  <details className="group">
                    <summary className="text-xs text-primary cursor-pointer hover:underline select-none">
                      View embed snippet
                    </summary>
                    <div className="mt-2 bg-slate-50 rounded-lg p-3 font-mono text-xs text-slate-700 overflow-x-auto">
                      {`<script src="${cdnUrl}?site_key=${site.site_key}" defer></script>`}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">
                      One tag for everything. {site.rum_enabled
                        ? 'Monitoring (RUM) loads automatically for this site.'
                        : 'Enable the RUM add-on to also collect performance monitoring.'}
                    </p>
                  </details>

                  <button
                    onClick={() => copyKey(site.id, site.site_key)}
                    className="mt-1 text-xs text-slate-400 hover:text-slate-600"
                  >
                    {copiedKey === site.id ? '✓ Copied site key' : `Key: ${site.site_key.slice(0, 8)}…`}
                  </button>

                  {/* Widget placement */}
                  <div className="mt-3 flex flex-wrap items-center gap-2.5 pt-3 border-t border-slate-100">
                    <span className="text-xs font-medium text-slate-500">Widget button:</span>
                    <select
                      value={site.widget_position ?? 'bottom-right'}
                      onChange={e => setPosition(site, e.target.value)}
                      disabled={loadingId === site.id || site.widget_hidden}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                    >
                      {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                    <button
                      onClick={() => toggleHidden(site)}
                      disabled={loadingId === site.id}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border disabled:opacity-50 transition-colors
                        ${site.widget_hidden ? 'border-rose-200 text-rose-600 bg-rose-50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {site.widget_hidden ? 'Hidden — show it' : 'Hide icon'}
                    </button>
                    <span className="text-[11px] text-slate-400">Changes apply within ~1 min on your site.</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleRum(site)}
                    disabled={loadingId === site.id}
                    title="Toggle the paid RUM monitoring add-on for this site"
                    className={`text-xs px-3 py-1.5 rounded-md border disabled:opacity-50 transition-colors
                      ${site.rum_enabled
                        ? 'border-primary/30 text-primary hover:bg-primary-lt'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    {site.rum_enabled ? 'Disable RUM' : 'Enable RUM'}
                  </button>
                  <button
                    onClick={() => toggleActive(site)}
                    disabled={loadingId === site.id}
                    className="text-xs px-3 py-1.5 rounded-md border border-slate-200 text-slate-600
                               hover:bg-slate-50 disabled:opacity-50 transition-colors"
                  >
                    {site.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => deleteSite(site.id)}
                    disabled={loadingId === site.id}
                    className="text-xs px-3 py-1.5 rounded-md border border-red-100 text-red-500
                               hover:bg-red-50 disabled:opacity-50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
