import { describe, it, expect } from 'vitest'
import { hasNewWindowWarning, findDuplicateIds, hasLabelInNameMismatch, inputPurposeIssue, autocompleteHasValidPurpose } from '@/lib/failure-techniques'

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

describe('hasLabelInNameMismatch (F96 / WCAG 2.5.3)', () => {
  it('flags when the visible label is NOT contained in the accessible name', () => {
    expect(hasLabelInNameMismatch('Submit', 'Send form')).toBe(true)
    expect(hasLabelInNameMismatch('Search', 'Find products')).toBe(true)
    expect(hasLabelInNameMismatch('Add to cart', 'Buy now')).toBe(true)
  })
  it('passes when the accessible name contains the visible label', () => {
    expect(hasLabelInNameMismatch('Search', 'Search products')).toBe(false)
    expect(hasLabelInNameMismatch('Submit', 'Submit the form')).toBe(false)
    expect(hasLabelInNameMismatch('Play', 'Play video')).toBe(false)
  })
  it('ignores punctuation and casing differences', () => {
    expect(hasLabelInNameMismatch('Read more…', 'read more about shipping')).toBe(false)
    expect(hasLabelInNameMismatch('SIGN IN', 'sign in to your account')).toBe(false)
  })
  it('does not flag when there is no visible label or no accessible name', () => {
    expect(hasLabelInNameMismatch('', 'Close dialog')).toBe(false)
    expect(hasLabelInNameMismatch('Close', '')).toBe(false)
  })
  it('skips icon/number-only visible text (no letters)', () => {
    expect(hasLabelInNameMismatch('★', 'Rate five stars')).toBe(false)
    expect(hasLabelInNameMismatch('123', 'Page one')).toBe(false)
  })
})

describe('inputPurposeIssue (WCAG 1.3.5 Identify Input Purpose)', () => {
  it('flags user-info fields missing autocomplete, suggesting the token', () => {
    expect(inputPurposeIssue({ autocomplete: '', hint: 'email Email address' })).toBe('email')
    expect(inputPurposeIssue({ autocomplete: '', hint: 'fname First name' })).toBe('given-name')
    expect(inputPurposeIssue({ autocomplete: '', hint: 'phone Mobile number' })).toBe('tel')
    expect(inputPurposeIssue({ autocomplete: '', hint: 'zip Postal code' })).toBe('postal-code')
    expect(inputPurposeIssue({ autocomplete: '', hint: 'cc-number Card number' })).toBe('cc-number')
    expect(inputPurposeIssue({ autocomplete: 'off', hint: 'Full Name' })).toBe('name')
  })
  it('does not flag when a valid autocomplete token is already present', () => {
    expect(inputPurposeIssue({ autocomplete: 'email', hint: 'email' })).toBeNull()
    expect(inputPurposeIssue({ autocomplete: 'shipping postal-code', hint: 'zip' })).toBeNull()
    expect(inputPurposeIssue({ autocomplete: 'given-name', hint: 'first name' })).toBeNull()
  })
  it('does not flag non-personal fields (search, coupon, quantity)', () => {
    expect(inputPurposeIssue({ autocomplete: '', hint: 'search Search the store' })).toBeNull()
    expect(inputPurposeIssue({ autocomplete: '', hint: 'coupon Promo code' })).toBeNull()
    expect(inputPurposeIssue({ autocomplete: '', hint: 'qty Quantity' })).toBeNull()
  })
  it('autocompleteHasValidPurpose handles multi-token values', () => {
    expect(autocompleteHasValidPurpose('section-blue shipping tel')).toBe(true)
    expect(autocompleteHasValidPurpose('on')).toBe(false)
    expect(autocompleteHasValidPurpose('')).toBe(false)
  })
})
