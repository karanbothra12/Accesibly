'use client'

import { useState, FormEvent } from 'react'

export default function SettingsForm({ initialName, email }: { initialName: string; email: string }) {
  const [fullName, setFullName] = useState(initialName)
  const [nameMsg, setNameMsg] = useState('')
  const [nameSaving, setNameSaving] = useState(false)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  async function saveName(e: FormEvent) {
    e.preventDefault()
    setNameMsg('')
    setNameSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName }),
      })
      const data = await res.json()
      if (!res.ok) setNameMsg(data.error || 'Failed')
      else setNameMsg('Name updated!')
    } catch {
      setNameMsg('Network error')
    } finally {
      setNameSaving(false)
    }
  }

  async function savePw(e: FormEvent) {
    e.preventDefault()
    setPwMsg('')
    if (newPw.length < 8) { setPwMsg('New password must be at least 8 characters'); return }
    setPwSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      })
      const data = await res.json()
      if (!res.ok) setPwMsg(data.error || 'Failed')
      else {
        setPwMsg('Password changed!')
        setCurrentPw('')
        setNewPw('')
      }
    } catch {
      setPwMsg('Network error')
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Profile card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Profile</h2>
        <form onSubmit={saveName} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Email address</label>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-sm text-slate-500 cursor-not-allowed"
            />
            <p className="text-xs text-slate-400 mt-1">Email cannot be changed.</p>
          </div>
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-slate-700 mb-1.5">Full name</label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={nameSaving || fullName.trim() === initialName}
              className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50
                         text-white text-sm font-medium rounded-lg transition-colors"
            >
              {nameSaving ? 'Saving…' : 'Save name'}
            </button>
            {nameMsg && (
              <span className={`text-sm ${nameMsg.includes('!') ? 'text-green-600' : 'text-red-600'}`}>
                {nameMsg}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Password card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Change password</h2>
        <form onSubmit={savePw} className="space-y-4">
          <div>
            <label htmlFor="currentPw" className="block text-sm font-medium text-slate-700 mb-1.5">Current password</label>
            <input
              id="currentPw"
              type="password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
          <div>
            <label htmlFor="newPw" className="block text-sm font-medium text-slate-700 mb-1.5">New password</label>
            <input
              id="newPw"
              type="password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pwSaving || !currentPw || !newPw}
              className="px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50
                         text-white text-sm font-medium rounded-lg transition-colors"
            >
              {pwSaving ? 'Updating…' : 'Update password'}
            </button>
            {pwMsg && (
              <span className={`text-sm ${pwMsg.includes('!') ? 'text-green-600' : 'text-red-600'}`}>
                {pwMsg}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
