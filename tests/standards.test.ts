import { describe, it, expect } from 'vitest'
import { summarizeStandards, violationInScope, getStandard, STANDARDS } from '@/lib/standards'

describe('violationInScope', () => {
  it('maps a WCAG 2.0 AA failure to Section 508 (2.0), EN 301 549 (2.1) and WCAG 2.2', () => {
    const tags = ['cat.color', 'wcag2aa', 'wcag143']
    expect(violationInScope(tags, getStandard('section508')!)).toBe(true)
    expect(violationInScope(tags, getStandard('en301549')!)).toBe(true)
    expect(violationInScope(tags, getStandard('wcag22aa')!)).toBe(true)
  })

  it('does NOT count a WCAG 2.1-only failure against a 2.0 standard (Section 508)', () => {
    const tags = ['wcag21aa'] // new in 2.1
    expect(violationInScope(tags, getStandard('section508')!)).toBe(false)
    expect(violationInScope(tags, getStandard('ada')!)).toBe(true) // ADA = 2.1 AA
  })

  it('excludes AAA and best-practice rules from every law', () => {
    for (const std of STANDARDS) {
      expect(violationInScope(['wcag2aaa'], std)).toBe(false)
      expect(violationInScope(['best-practice'], std)).toBe(false)
      expect(violationInScope(['experimental'], std)).toBe(false)
    }
  })
})

describe('summarizeStandards', () => {
  it('marks every standard compliant when there are no violations', () => {
    const s = summarizeStandards([])
    expect(s.length).toBe(STANDARDS.length)
    expect(s.every(x => x.compliant && x.failingRules === 0)).toBe(true)
  })

  it('de-dupes the same rule failing on many pages', () => {
    const vios = [
      { id: 'color-contrast', tags: ['wcag2aa', 'wcag143'] },
      { id: 'color-contrast', tags: ['wcag2aa', 'wcag143'] }, // same rule, another page
      { id: 'link-name', tags: ['wcag2a', 'wcag412'] },
    ]
    const ada = summarizeStandards(vios).find(s => s.key === 'ada')!
    expect(ada.failingRules).toBe(2) // color-contrast + link-name, counted once each
    expect(ada.compliant).toBe(false)
  })

  it('keeps a 2.0-based law clean when only a 2.1 rule fails', () => {
    const vios = [{ id: 'target-size', tags: ['wcag22aa'] }]
    const byKey = Object.fromEntries(summarizeStandards(vios).map(s => [s.key, s]))
    expect(byKey['section508'].compliant).toBe(true)  // 2.0 — not in scope
    expect(byKey['aoda'].compliant).toBe(true)        // 2.0
    expect(byKey['wcag22aa'].compliant).toBe(false)   // 2.2 — in scope
  })
})
