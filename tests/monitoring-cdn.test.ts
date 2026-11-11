import { describe, it, expect } from 'vitest'
import { detectCdn, parseCacheStatus, parsePop, popCity, analyzeCdn } from '@/lib/monitoring/cdn'

describe('detectCdn', () => {
  it('identifies Cloudflare by cf-ray / server', () => {
    expect(detectCdn({ 'cf-ray': '7d8e1f2a3b4c5d6e-BOM', server: 'cloudflare' })).toBe('Cloudflare')
    expect(detectCdn({ server: 'cloudflare' })).toBe('Cloudflare')
  })
  it('identifies CloudFront', () => {
    expect(detectCdn({ 'x-amz-cf-pop': 'BOM51-C1', 'x-amz-cf-id': 'abc', via: '1.1 x.cloudfront.net (CloudFront)' })).toBe('CloudFront')
  })
  it('identifies Fastly by x-served-by/x-timer', () => {
    expect(detectCdn({ 'x-served-by': 'cache-bom4726-BOM', 'x-timer': 'S1,VS0', 'x-cache': 'HIT' })).toBe('Fastly')
  })
  it('identifies Incapsula/Imperva', () => {
    expect(detectCdn({ 'x-iinfo': '1-234-0 NNNN', 'x-cdn': 'Incapsula' })).toBe('Incapsula')
  })
  it('identifies Akamai, Vercel, Netlify', () => {
    expect(detectCdn({ server: 'AkamaiGHost', 'akamai-grn': '0.1' })).toBe('Akamai')
    expect(detectCdn({ 'x-vercel-cache': 'HIT', 'x-vercel-id': 'bom1::abc' })).toBe('Vercel')
    expect(detectCdn({ 'x-nf-request-id': 'abc', server: 'Netlify' })).toBe('Netlify')
  })
  it('returns null when no CDN fingerprint present', () => {
    expect(detectCdn({ server: 'nginx', 'content-type': 'text/html' })).toBeNull()
  })
  it('CloudFront/Cloudflare take precedence over a generic x-cache', () => {
    expect(detectCdn({ 'cf-ray': 'x-BOM', 'x-cache': 'HIT' })).toBe('Cloudflare')
  })
})

describe('parseCacheStatus', () => {
  it('normalizes Cloudflare statuses', () => {
    expect(parseCacheStatus({ 'cf-cache-status': 'HIT' })).toBe('hit')
    expect(parseCacheStatus({ 'cf-cache-status': 'MISS' })).toBe('miss')
    expect(parseCacheStatus({ 'cf-cache-status': 'DYNAMIC' })).toBe('dynamic')
    expect(parseCacheStatus({ 'cf-cache-status': 'REVALIDATED' })).toBe('hit')
  })
  it('normalizes CloudFront and Akamai x-cache phrasing', () => {
    expect(parseCacheStatus({ 'x-cache': 'Hit from cloudfront' })).toBe('hit')
    expect(parseCacheStatus({ 'x-cache': 'Miss from cloudfront' })).toBe('miss')
    expect(parseCacheStatus({ 'x-cache': 'TCP_HIT' })).toBe('hit')
    expect(parseCacheStatus({ 'x-cache': 'TCP_MISS' })).toBe('miss')
  })
  it('normalizes Vercel', () => {
    expect(parseCacheStatus({ 'x-vercel-cache': 'STALE' })).toBe('stale')
    expect(parseCacheStatus({ 'x-vercel-cache': 'PRERENDER' })).toBe('hit')
  })
  it('falls back to Age / Cache-Control heuristics', () => {
    expect(parseCacheStatus({ age: '120' })).toBe('hit')
    expect(parseCacheStatus({ 'cache-control': 'no-store' })).toBe('dynamic')
    expect(parseCacheStatus({ 'content-type': 'text/html' })).toBeNull()
  })
})

describe('parsePop / popCity', () => {
  it('extracts PoP from CloudFront, Cloudflare, Fastly', () => {
    expect(parsePop({ 'x-amz-cf-pop': 'BOM51-C1' })).toBe('BOM51-C1')
    expect(parsePop({ 'cf-ray': '7d8e1f2a3b4c5d6e-BOM' })).toBe('BOM')
    expect(parsePop({ 'x-served-by': 'cache-bom4726-BOM' })).toBe('BOM')
  })
  it('takes the edge-most node from a chained x-served-by', () => {
    expect(parsePop({ 'x-served-by': 'cache-iad-kiad7000033-IAD, cache-bom4726-BOM' })).toBe('BOM')
  })
  it('maps IATA codes to cities, tolerating vendor suffixes', () => {
    expect(popCity('BOM')).toBe('Mumbai')
    expect(popCity('BOM51-C1')).toBe('Mumbai')
    expect(popCity('cache-lhr-abc')).toBe('London')
    expect(popCity('ZZZ')).toBeNull()
    expect(popCity(null)).toBeNull()
  })
})

describe('analyzeCdn (integration of the three)', () => {
  it('produces a full CdnInfo for a Fastly HIT in Mumbai', () => {
    const info = analyzeCdn({ 'x-served-by': 'cache-bom4726-BOM', 'x-cache': 'HIT', age: '42', 'x-timer': 'S1,VS0' })
    expect(info).toEqual({ vendor: 'Fastly', cacheStatus: 'hit', pop: 'BOM', popCity: 'Mumbai' })
  })
  it('handles a plain origin with no CDN', () => {
    const info = analyzeCdn({ server: 'nginx', 'cache-control': 'no-store' })
    expect(info).toEqual({ vendor: null, cacheStatus: 'dynamic', pop: null, popCity: null })
  })
})
