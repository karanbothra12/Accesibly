import { describe, it, expect } from 'vitest'
import { classifyLink } from '@/lib/linkcheck'

describe('classifyLink', () => {
  it('treats a 200 as not broken', () => {
    const r = classifyLink(200, true, false)
    expect(r.broken).toBe(false)
    expect(r.severity).toBe('ok')
  })

  it('flags a same-origin 404 as an error', () => {
    const r = classifyLink(404, true, false)
    expect(r.broken).toBe(true)
    expect(r.severity).toBe('error')
  })

  it('flags a same-origin 500 as an error', () => {
    expect(classifyLink(500, true, false).severity).toBe('error')
  })

  it('flags an external 404 as a warning, not an error', () => {
    const r = classifyLink(404, false, false)
    expect(r.broken).toBe(true)
    expect(r.severity).toBe('warning')
  })

  it('notes that external 403/429 are often bot-blocking (false positives)', () => {
    const r403 = classifyLink(403, false, false)
    expect(r403.severity).toBe('warning')
    expect(r403.reason.toLowerCase()).toContain('bot-blocking')
    expect(classifyLink(429, false, false).reason.toLowerCase()).toContain('bot-blocking')
  })

  it('treats a network error as broken (error internal, warning external)', () => {
    expect(classifyLink(null, true, true).severity).toBe('error')
    expect(classifyLink(null, false, true).severity).toBe('warning')
  })

  it('does not flag 3xx as broken (redirects are followed)', () => {
    // checkLink follows redirects, so a final 200 arrives here; a bare 301 is not >=400.
    expect(classifyLink(301, true, false).broken).toBe(false)
  })
})
