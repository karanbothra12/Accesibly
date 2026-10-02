import { describe, it, expect } from 'vitest'
import { hasNewWindowWarning, findDuplicateIds } from '@/lib/failure-techniques'

describe('hasNewWindowWarning (F22)', () => {
  it('flags links with NO new-window warning (returns false)', () => {
    expect(hasNewWindowWarning('About Us')).toBe(false)
    expect(hasNewWindowWarning('800 3688742')).toBe(false)
    expect(hasNewWindowWarning('The Edit')).toBe(false)
    expect(hasNewWindowWarning('')).toBe(false)
  })
  it('recognises an English new-window warning (returns true → not flagged)', () => {
    expect(hasNewWindowWarning('Return Policy (opens in a new window)')).toBe(true)
    expect(hasNewWindowWarning('Contact Us - new tab')).toBe(true)
    expect(hasNewWindowWarning('Download report external link')).toBe(true)
  })
  it('recognises warnings in other languages (locale sites)', () => {
    expect(hasNewWindowWarning('Nous contacter (nouvelle fenêtre)')).toBe(true) // fr
    expect(hasNewWindowWarning('Kontakt (neues Fenster)')).toBe(true) // de
    expect(hasNewWindowWarning('Contáctenos (nueva ventana)')).toBe(true) // es
    expect(hasNewWindowWarning('Contattaci (nuova finestra)')).toBe(true) // it
  })
})

describe('findDuplicateIds (F77)', () => {
  it('returns ids that occur more than once, with counts', () => {
    expect(findDuplicateIds(['a', 'b', 'a', 'c', 'a', 'b'])).toEqual([
      { id: 'a', count: 3 },
      { id: 'b', count: 2 },
    ])
  })
  it('returns nothing when all ids are unique', () => {
    expect(findDuplicateIds(['header', 'main', 'footer'])).toEqual([])
  })
  it('ignores empty / whitespace ids', () => {
    expect(findDuplicateIds(['', '  ', '', 'x'])).toEqual([])
  })
  it('handles an empty document', () => {
    expect(findDuplicateIds([])).toEqual([])
  })
})
