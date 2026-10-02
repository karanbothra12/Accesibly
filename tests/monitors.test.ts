import { describe, it, expect } from 'vitest'
import { allowedIntervals, isRegression, regressionSummary, intervalLabel } from '@/lib/monitors'

describe('allowedIntervals', () => {
  it('returns nothing when monitoring is not allowed (0)', () => {
    expect(allowedIntervals(0)).toEqual([])
    expect(allowedIntervals(-1)).toEqual([])
  })
  it('gates cadence by the minimum interval', () => {
    expect(allowedIntervals(1)).toEqual([1, 7, 30])   // daily plan → all
    expect(allowedIntervals(7)).toEqual([7, 30])       // weekly plan → weekly/monthly
    expect(allowedIntervals(30)).toEqual([30])          // monthly only
  })
})

describe('isRegression', () => {
  it('never flags the first run (no baseline)', () => {
    expect(isRegression(null, { issues: 99, score: 10 })).toBe(false)
  })
  it('flags more issues than before', () => {
    expect(isRegression({ issues: 3, score: null }, { issues: 5, score: null })).toBe(true)
  })
  it('flags a dropped score even if issues are equal', () => {
    expect(isRegression({ issues: 3, score: 90 }, { issues: 3, score: 80 })).toBe(true)
  })
  it('does not flag improvements or no-change', () => {
    expect(isRegression({ issues: 5, score: 80 }, { issues: 3, score: 90 })).toBe(false)
    expect(isRegression({ issues: 5, score: 80 }, { issues: 5, score: 80 })).toBe(false)
  })
  it('ignores score when a type has no score (null)', () => {
    expect(isRegression({ issues: 5, score: null }, { issues: 5, score: null })).toBe(false)
  })
})

describe('regressionSummary', () => {
  it('describes what got worse', () => {
    expect(regressionSummary({ issues: 2, score: 90 }, { issues: 5, score: 80 })).toContain('issues rose from 2 to 5')
    expect(regressionSummary({ issues: 2, score: 90 }, { issues: 5, score: 80 })).toContain('score fell from 90 to 80')
  })
})

describe('intervalLabel', () => {
  it('names the standard cadences', () => {
    expect(intervalLabel(1)).toBe('Daily')
    expect(intervalLabel(7)).toBe('Weekly')
    expect(intervalLabel(30)).toBe('Monthly')
  })
})
