'use client'

import { useEffect, useRef } from 'react'

// Interactive constellation: drifting nodes that link to each other and to the
// cursor. Pure canvas, DPR-aware, rAF-driven, pauses when hidden / reduced-motion.
export default function ParticleField({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const context = canvasEl.getContext('2d')
    if (!context) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // Non-null aliases so TS keeps the narrowing inside the closures below.
    const canvas = canvasEl
    const ctx = context

    let raf = 0
    let w = 0, h = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const parent = canvas.parentElement as HTMLElement
    type P = { x: number; y: number; vx: number; vy: number; r: number }
    let pts: P[] = []
    const mouse = { x: -9999, y: -9999 }

    function resize() {
      const rect = parent.getBoundingClientRect()
      w = rect.width; h = rect.height
      canvas.width = w * dpr; canvas.height = h * dpr
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.min(90, Math.max(28, Math.round((w * h) / 16000)))
      pts = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
        r: Math.random() * 1.6 + 0.6,
      }))
    }

    function step() {
      ctx.clearRect(0, 0, w, h)
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0 || p.x > w) p.vx *= -1
        if (p.y < 0 || p.y > h) p.vy *= -1
        // gentle pull toward the cursor
        const dxm = mouse.x - p.x, dym = mouse.y - p.y
        const dm = Math.hypot(dxm, dym)
        if (dm < 180) { p.x += (dxm / dm) * 0.4; p.y += (dym / dm) * 0.4 }
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(129,140,248,0.9)'
        ctx.fill()
      }
      // links
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d < 130) {
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
            ctx.strokeStyle = `rgba(139,92,246,${0.16 * (1 - d / 130)})`
            ctx.lineWidth = 1; ctx.stroke()
          }
        }
        // link to cursor
        const a = pts[i]
        const dc = Math.hypot(a.x - mouse.x, a.y - mouse.y)
        if (dc < 200) {
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y)
          ctx.strokeStyle = `rgba(99,102,241,${0.4 * (1 - dc / 200)})`
          ctx.lineWidth = 1; ctx.stroke()
        }
      }
      raf = requestAnimationFrame(step)
    }

    function onMove(e: PointerEvent) {
      const rect = parent.getBoundingClientRect()
      mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top
    }
    function onLeave() { mouse.x = -9999; mouse.y = -9999 }
    function onVisibility() {
      cancelAnimationFrame(raf)
      if (!document.hidden) raf = requestAnimationFrame(step)
    }

    resize()
    raf = requestAnimationFrame(step)
    window.addEventListener('resize', resize)
    parent.addEventListener('pointermove', onMove)
    parent.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      parent.removeEventListener('pointermove', onMove)
      parent.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden className={`pointer-events-none absolute inset-0 ${className}`} />
}
