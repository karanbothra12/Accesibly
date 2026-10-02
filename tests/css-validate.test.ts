import { describe, it, expect } from 'vitest'
import { parseCssValidation } from '@/lib/css-validate'

// Mirrors the JSON the W3C CSS Validator (Jigsaw) emits with output=json.
describe('parseCssValidation', () => {
  it('reports a clean stylesheet as valid', () => {
    const r = parseCssValidation({ cssvalidation: { validity: true, result: { errorcount: 0, warningcount: 0 }, errors: [], warnings: [] } })
    expect(r.ok).toBe(true)
    expect(r.errors).toBe(0)
    expect(r.messages).toHaveLength(0)
  })

  it('classifies errors and warnings with source/line/context', () => {
    const r = parseCssValidation({
      cssvalidation: {
        validity: false,
        result: { errorcount: 1, warningcount: 1 },
        errors: [{ source: 'https://x/app.css', line: 42, context: '.btn', message: 'Parse Error   {{{' }],
        warnings: [{ source: 'https://x/app.css', line: 7, level: 0, message: 'Same colors for color and background-color' }],
      },
    })
    expect(r.errors).toBe(1)
    expect(r.warnings).toBe(1)
    expect(r.ok).toBe(false)
    expect(r.messages[0].severity).toBe('error')
    expect(r.messages[0].line).toBe(42)
    expect(r.messages[0].context).toBe('.btn')
    expect(r.messages[0].message).toBe('Parse Error {{{') // whitespace collapsed
    expect(r.messages[1].severity).toBe('warning')
  })

  it('falls back to array lengths when result counts are absent', () => {
    const r = parseCssValidation({ cssvalidation: { errors: [{ message: 'a' }, { message: 'b' }], warnings: [] } })
    expect(r.errors).toBe(2)
    expect(r.warnings).toBe(0)
  })

  it('flags a missing cssvalidation payload as a validator error', () => {
    const r = parseCssValidation({})
    expect(r.validatorError).toBeTruthy()
    expect(r.ok).toBe(false)
  })
})
