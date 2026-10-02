'use client'

import { useEffect, useRef, useState } from 'react'

// Cinematic chrome: a top scroll-progress beam + a cursor spotlight that lights
// the page as you move. rAF-throttled; disabled for touch / reduced-motion.
export default function LandingFX() {
  const [progress, setProgress] = useState(0)
  const glowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const fine = window.matchMedia?.('(pointer: fine)').matches

    let raf = 0
    const target = { x: window.innerWidth / 2, y: -300 }

    function onScroll() {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setProgress(max > 0 ? (el.scrollTop / max) * 100 : 0)
    }
    function onMove(e: PointerEvent) { target.x = e.clientX; target.y = e.clientY }
    function loop() {
      const g = glowRef.current
      if (g) { g.style.transform = `translate(${target.x}px, ${target.y}px)` }
      raf = requestAnimationFrame(loop)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    if (fine && !reduce) {
      window.addEventListener('pointermove', onMove, { passive: true })
      raf = requestAnimationFrame(loop)
    }
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <>
      {/* Scroll progress beam */}
      <div className="fixed top-0 inset-x-0 z-[60] h-[3px] bg-transparent">
        <div
          className="h-full bg-gradient-to-r from-primary via-violet to-primary shadow-[0_0_12px_rgba(99,102,241,.8)] transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      </div>
      {/* Cursor spotlight (desktop only) */}
      <div
        ref={glowRef}
        aria-hidden
        className="hidden lg:block pointer-events-none fixed -left-64 -top-64 z-[1] w-[32rem] h-[32rem] rounded-full will-change-transform"
        style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.12), transparent 60%)' }}
      />
    </>
  )
}
