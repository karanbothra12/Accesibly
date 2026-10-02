import { describe, it, expect } from 'vitest'
import { parseVnu } from '@/lib/html-validate'

// Mirrors the JSON the W3C Nu Html Checker (vnu) emits with ?out=json.
describe('parseVnu', () => {
  it('reports a clean document as valid with no messages', () => {
    const r = parseVnu({ messages: [] })
    expect(r.ok).toBe(true)
    expect(r.errors).toBe(0)
    expect(r.warnings).toBe(0)
    expect(r.messages).toHaveLength(0)
  })

  it('classifies errors, warnings and info by vnu type/subType', () => {
    const r = parseVnu({
      messages: [
        { type: 'error', message: 'Stray end tag "div".', lastLine: 12, lastColumn: 6, extract: '</div>' },
        { type: 'info', subType: 'warning', message: 'Consider adding a "lang" attribute.', lastLine: 1 },
        { type: 'info', message: 'The character encoding was declared.' },
      ],
    })
    expect(r.errors).toBe(1)
    expect(r.warnings).toBe(1)
    expect(r.info).toBe(1)
    expect(r.ok).toBe(false)
    // Errors sort ahead of warnings/info.
    expect(r.messages[0].severity).toBe('error')
    expect(r.messages[0].line).toBe(12)
    expect(r.messages[0].column).toBe(6)
    expect(r.messages[0].extract).toBe('</div>')
  })

  it('marks fatal parse errors', () => {
    const r = parseVnu({ messages: [{ type: 'error', subType: 'fatal', message: 'Cannot recover after last error.' }] })
    expect(r.errors).toBe(1)
    expect(r.messages[0].fatal).toBe(true)
  })

  it('surfaces non-document errors as a validatorError rather than a spec error', () => {
    const r = parseVnu({ messages: [{ type: 'non-document-error', subType: 'io', message: 'Connection reset.' }] })
    expect(r.errors).toBe(0)
    expect(r.validatorError).toContain('Connection reset')
  })

  it('falls back to firstLine/firstColumn when last positions are absent', () => {
    const r = parseVnu({ messages: [{ type: 'error', message: 'x', firstLine: 3, firstColumn: 9 }] })
    expect(r.messages[0].line).toBe(3)
    expect(r.messages[0].column).toBe(9)
  })

  it('handles a missing/empty payload without throwing', () => {
    expect(parseVnu(null).errors).toBe(0)
    expect(parseVnu(undefined).ok).toBe(true)
    expect(parseVnu({}).messages).toHaveLength(0)
  })
})
