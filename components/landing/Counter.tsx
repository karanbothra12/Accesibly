'use client'

import { useEffect, useRef, useState } from 'react'

// Counts up from 0 to `to` with an ease-out curve when scrolled into view.
export default function Counter({
  to,
  prefix = '',
  suffix = '',
  decimals = 0,
  duration = 1400,
}: {
  to: number
  prefix?: string
  suffix?: string
  decimals?: number
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [val, setVal] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          if (reduce) {
            setVal(to)
            return
          }
          const start = performance.now()
          const step = (now: number) => {
            const p = Math.min((now - start) / duration, 1)
            setVal(to * (1 - Math.pow(1 - p, 3)))
            if (p < 1) requestAnimationFrame(step)
          }
          requestAnimationFrame(step)
        }
      },
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [to, duration])

  return (
    <span ref={ref}>
      {prefix}
      {val.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  )
}
