import { describe, it, expect } from 'vitest'
import { scoreSecurity, type SecuritySignals } from '@/lib/security-audit'

function signals(over: Partial<SecuritySignals> = {}): SecuritySignals {
  return {
    reachable: true,
    finalUrl: 'https://example.com/',
    statusCode: 200,
    isHttps: true,
    redirectsToHttps: true,
    headers: {
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'permissions-policy': 'geolocation=()',
      'server': null,
      'x-powered-by': null,
    },
    tls: { protocol: 'TLSv1.3', issuer: "Let's Encrypt", validTo: new Date(Date.now() + 60 * 86400000).toISOString(), daysToExpiry: 60 },
    cookies: { total: 0, insecure: 0 },
    ...over,
  }
}
const check = (r: ReturnType<typeof scoreSecurity>, id: string) => r.checks.find(c => c.id === id)!

describe('scoreSecurity', () => {
  it('gives a fully-hardened site a score of 100', () => {
    const r = scoreSecurity(signals())
    expect(r.score).toBe(100)
    expect(r.checks.filter(c => c.weight > 0).every(c => c.status === 'pass')).toBe(true)
  })

  it('fails when HTTPS is unavailable and warns on missing headers', () => {
    const r = scoreSecurity(signals({
      isHttps: false, tls: null,
      headers: { 'strict-transport-security': null, 'content-security-policy': null, 'x-content-type-options': null, 'x-frame-options': null, 'referrer-policy': null, 'permissions-policy': null, 'server': 'nginx/1.25.1', 'x-powered-by': null },
    }))
    expect(check(r, 'https').status).toBe('fail')
    expect(check(r, 'hsts').status).toBe('warn')
    expect(check(r, 'csp').status).toBe('warn')
    expect(check(r, 'disclosure').status).toBe('warn') // version in Server header
    expect(r.score).toBeLessThan(50)
  })

  it('flags an expired certificate as a failing check', () => {
    const r = scoreSecurity(signals({ tls: { protocol: 'TLSv1.2', issuer: 'X', validTo: new Date(Date.now() - 86400000).toISOString(), daysToExpiry: -1 } }))
    expect(check(r, 'tls_cert').status).toBe('fail')
  })

  it('warns on a certificate expiring soon', () => {
    const r = scoreSecurity(signals({ tls: { protocol: 'TLSv1.3', issuer: 'X', validTo: new Date(Date.now() + 5 * 86400000).toISOString(), daysToExpiry: 5 } }))
    expect(check(r, 'tls_cert').status).toBe('warn')
  })

  it('warns when a cookie is missing the Secure flag', () => {
    const r = scoreSecurity(signals({ cookies: { total: 2, insecure: 1 } }))
    expect(check(r, 'cookie_secure').status).toBe('warn')
  })

  it('treats a weak HSTS max-age as a warning', () => {
    const r = scoreSecurity(signals({ headers: { ...signals().headers, 'strict-transport-security': 'max-age=3600' } }))
    expect(check(r, 'hsts').status).toBe('warn')
  })
})
