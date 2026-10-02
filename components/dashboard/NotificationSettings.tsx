'use client'

import { useEffect, useState } from 'react'

type Prefs = { audit_done: boolean; limit_reached: boolean; recipient: string | null }

export default function NotificationSettings() {
  const [enabled, setEnabled] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>({ audit_done: true, limit_reached: true, recipient: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/notifications')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d) { setEnabled(d.enabled); setPrefs({ ...d.prefs, recipient: d.prefs.recipient ?? '' }); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function save() {
    setSaving(true); setSaved(false)
    try {
      const r = await fetch('/api/notifications', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(prefs),
      })
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
    } finally { setSaving(false) }
  }

  if (loading) return <div className="mt-6 h-40 rounded-2xl bg-slate-100 animate-pulse" />

  return (
    <div className="mt-6 ui-card p-6">
      <h2 className="text-sm font-semibold text-slate-900">Email notifications</h2>
      {!enabled ? (
        <p className="text-sm text-slate-500 mt-2">
          Email notifications aren&apos;t included in your plan.{' '}
          <a href="/dashboard/billing" className="text-primary hover:underline">Upgrade</a> to enable alerts.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-400 mt-1">Get emailed when things happen. Delivery goes live with billing; until then messages are queued.</p>
          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-2.5 text-sm text-slate-700">
              <input type="checkbox" checked={prefs.audit_done} onChange={e => setPrefs({ ...prefs, audit_done: e.target.checked })} className="accent-primary" />
              When an audit finishes
            </label>
            <label className="flex items-center gap-2.5 text-sm text-slate-700">
              <input type="checkbox" checked={prefs.limit_reached} onChange={e => setPrefs({ ...prefs, limit_reached: e.target.checked })} className="accent-primary" />
              When I hit a usage limit
            </label>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Send to (defaults to your account email)</label>
              <input
                type="email"
                value={prefs.recipient ?? ''}
                onChange={e => setPrefs({ ...prefs, recipient: e.target.value })}
                placeholder="alerts@yourcompany.com"
                className="w-full max-w-sm px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={save} disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-emerald-600 font-medium">Saved ✓</span>}
          </div>
        </>
      )}
    </div>
  )
}
