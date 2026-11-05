import { describe, it, expect, vi } from 'vitest'
import { hostOf, dnsRecordName, dnsRecordValue } from '@/lib/monitoring/verify'
import { generateAgentToken, hashToken } from '@/lib/monitoring/agents'

describe('verify helpers', () => {
  it('extracts the host and strips www', () => {
    expect(hostOf('https://www.example.com/path')).toBe('example.com')
    expect(hostOf('http://sub.example.co.uk')).toBe('sub.example.co.uk')
    expect(hostOf('not a url')).toBeNull()
  })
  it('builds a stable DNS record name + value', () => {
    expect(dnsRecordName('example.com')).toBe('_accessly-monitor.example.com')
    expect(dnsRecordValue('tok123')).toBe('accessly-monitor=tok123')
  })
})

describe('agent tokens', () => {
  it('generates a prefixed random token', () => {
    const t = generateAgentToken()
    expect(t.startsWith('agt_')).toBe(true)
    expect(t.length).toBeGreaterThan(40)
    expect(generateAgentToken()).not.toBe(t) // random
  })
  it('hashes deterministically (sha256 hex) and never echoes the token', () => {
    const t = 'agt_fixed'
    const h = hashToken(t)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).toBe(hashToken(t))
    expect(h).not.toContain(t)
  })
})

describe('resolveSafeTarget (SSRF guard, production mode)', () => {
  it('rejects private IPs, disallowed ports and non-http schemes when not permissive', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ALLOW_PRIVATE_TARGETS', '')
    const { resolveSafeTarget } = await import('@/lib/monitoring/ssrf-exec')
    await expect(resolveSafeTarget('http://127.0.0.1/')).rejects.toThrow()
    await expect(resolveSafeTarget('http://169.254.169.254/latest/meta-data')).rejects.toThrow() // cloud metadata
    await expect(resolveSafeTarget('http://93.184.216.34:22/')).rejects.toThrow() // disallowed port
    await expect(resolveSafeTarget('ftp://example.com/')).rejects.toThrow() // scheme
    await expect(resolveSafeTarget('http://93.184.216.34/')).resolves.toMatchObject({ ip: '93.184.216.34', port: 80 })
    vi.unstubAllEnvs()
  })
})
