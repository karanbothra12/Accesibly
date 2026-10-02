'use client'

import { useEffect } from 'react'

// Captures uncaught browser errors + unhandled promise rejections and reports
// them to /api/client-error (deduped + throttled) for the SuperAdmin console.
export default function ErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>()
    let sent = 0

    function report(kind: string, message: string, stack?: string) {
      try {
        if (!message || sent >= 20) return
        const key = kind + '|' + message + '|' + (stack || '').slice(0, 120)
        if (seen.has(key)) return
        seen.add(key); sent++
        const body = JSON.stringify({ kind, message: message.slice(0, 1000), stack: (stack || '').slice(0, 6000), path: location.pathname })
        if (navigator.sendBeacon) navigator.sendBeacon('/api/client-error', body)
        else fetch('/api/client-error', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain' }, body }).catch(() => {})
      } catch { /* ignore */ }
    }

    function onError(e: ErrorEvent) {
      report('error', e.message || 'Script error', e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`)
    }
    function onRejection(e: PromiseRejectionEvent) {
      const r = e.reason
      report('unhandledrejection', r?.message || String(r), r?.stack)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
