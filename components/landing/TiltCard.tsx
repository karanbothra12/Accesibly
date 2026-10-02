'use client'

import { useRef } from 'react'

// 3D tilt-on-hover with a moving glare. Progressive enhancement: does nothing
// on touch / reduced-motion (the card still renders normally).
export default function TiltCard({ children, className = '', max = 8 }: { children: React.ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement | null>(null)

  function onMove(e: React.PointerEvent) {
    const el = ref.current
    if (!el || window.matchMedia?.('(pointer: coarse)').matches) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.transform = `perspective(900px) rotateY(${(px - 0.5) * max * 2}deg) rotateX(${-(py - 0.5) * max * 2}deg) translateZ(0)`
    el.style.setProperty('--gx', `${px * 100}%`)
    el.style.setProperty('--gy', `${py * 100}%`)
  }
  function reset() {
    const el = ref.current
    if (el) el.style.transform = 'perspective(900px) rotateX(0) rotateY(0)'
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={`tilt-card transition-transform duration-200 ease-out ${className}`}
    >
      {children}
    </div>
  )
}
