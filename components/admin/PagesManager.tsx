'use client'

import { useEffect, useState } from 'react'

type Page = {
  id: number; slug: string; title: string
  seo_title: string | null; seo_description: string | null
  body: string; is_published: boolean; updated_at: string
}
type Draft = {
  id?: number; slug: string; title: string; seo_title: string; seo_description: string; body: string; is_published: boolean
}

const inp = 'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary'

export default function PagesManager() {
  const [pages, setPages] = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    const r = await fetch('/api/admin/pages')
    if (r.ok) { const d = await r.json(); setPages(d.pages); setLoading(false) }
  }
  useEffect(() => {
    let alive = true
    ;(async () => {
      const r = await fetch('/api/admin/pages')
      if (!r.ok || !alive) return
      const d = await r.json()
      if (!alive) return
      setPages(d.pages); setLoading(false)
    })()
    return () => { alive = false }
  }, [])

  const newDraft = (): Draft => ({ slug: '', title: '', seo_title: '', seo_description: '', body: '', is_published: true })
  const editDraft = (p: Page): Draft => ({
    id: p.id, slug: p.slug, title: p.title, seo_title: p.seo_title || '', seo_description: p.seo_description || '', body: p.body, is_published: p.is_published,
  })

  async function save() {
    if (!draft) return
    setErr(''); setSaving(true)
    try {
      const r = await fetch('/api/admin/pages', {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Save failed'); return }
      setDraft(null); await load()
    } finally { setSaving(false) }
  }

  async function remove(p: Page) {
    if (!confirm(`Delete the "${p.title}" page? This cannot be undone.`)) return
    const r = await fetch('/api/admin/pages', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id }) })
    if (r.ok) load()
  }

  async function togglePublish(p: Page) {
    const r = await fetch('/api/admin/pages', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, is_published: !p.is_published }) })
    if (r.ok) load()
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Content Pages</h1>
          <p className="text-slate-500 text-sm mt-1">Create and edit public pages (Terms, Privacy, etc.) — content, title &amp; SEO, all from here. They render at <code className="text-primary">/p/&lt;slug&gt;</code>.</p>
        </div>
        <button onClick={() => setDraft(newDraft())} className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-dark shadow-sm shadow-primary/25 transition-colors">+ New page</button>
      </div>

      {loading ? (
        <div className="ui-card px-6 py-16 text-center text-slate-400 text-sm">Loading…</div>
      ) : pages.length === 0 ? (
        <div className="ui-card px-6 py-16 text-center text-slate-400 text-sm">No pages yet. Create your first one.</div>
      ) : (
        <div className="ui-card divide-y divide-slate-100">
          {pages.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{p.title}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.is_published ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{p.is_published ? 'Published' : 'Draft'}</span>
                </div>
                <a href={`/p/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline font-mono">/p/{p.slug} ↗</a>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => togglePublish(p)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">{p.is_published ? 'Unpublish' : 'Publish'}</button>
                <button onClick={() => setDraft(editDraft(p))} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50">Edit</button>
                <button onClick={() => remove(p)} className="text-xs px-3 py-1.5 rounded-lg border border-rose-100 text-rose-500 hover:bg-rose-50">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Editor modal */}
      {draft && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setDraft(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-900">{draft.id ? 'Edit page' : 'New page'}</h2>
              <button onClick={() => setDraft(null)} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Title"><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} className={inp} placeholder="Terms of Service" /></Field>
                <Field label="Slug (URL) — /p/…"><input value={draft.slug} onChange={e => setDraft({ ...draft, slug: e.target.value })} className={inp} placeholder="terms" /></Field>
              </div>
              <Field label="SEO title (browser tab & search result)"><input value={draft.seo_title} onChange={e => setDraft({ ...draft, seo_title: e.target.value })} className={inp} placeholder="Terms of Service · Accessly" /></Field>
              <Field label="SEO meta description">
                <textarea value={draft.seo_description} onChange={e => setDraft({ ...draft, seo_description: e.target.value })} className={`${inp} h-20 resize-y`} placeholder="Short summary shown in search results (≤ 160 chars recommended)." />
                <span className="text-[11px] text-slate-400">{draft.seo_description.length} chars</span>
              </Field>
              <Field label="Body (HTML)">
                <textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} className={`${inp} h-72 resize-y font-mono text-xs`} placeholder="<h2>Section</h2><p>Your content…</p>" />
                <span className="text-[11px] text-slate-400">Use HTML: &lt;h2&gt;, &lt;p&gt;, &lt;ul&gt;&lt;li&gt;, &lt;a href&gt;, &lt;strong&gt;. Headings &amp; links are styled automatically.</span>
              </Field>
              <label className="flex items-center gap-2.5 text-sm text-slate-700">
                <input type="checkbox" checked={draft.is_published} onChange={e => setDraft({ ...draft, is_published: e.target.checked })} className="accent-primary" />
                Published (visible to the public)
              </label>
              {err && <p className="text-sm text-rose-600">{err}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">
              <button onClick={() => setDraft(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900">Cancel</button>
              <button onClick={save} disabled={saving || !draft.title} className="px-5 py-2 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary-dark disabled:opacity-50">{saving ? 'Saving…' : 'Save page'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>{children}</label>
}
