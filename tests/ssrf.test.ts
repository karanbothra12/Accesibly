import { describe, it, expect, afterEach, vi } from 'vitest'
import { isPrivateIp, assertSafeUrl, UnsafeUrlError } from '@/lib/ssrf'

describe('isPrivateIp', () => {
  it('flags private / loopback / link-local / metadata ranges', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })
  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2001:4860:4860::8888']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe('assertSafeUrl (production)', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('rejects non-http protocols', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertSafeUrl('ftp://example.com')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('rejects literal private IPs and metadata', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertSafeUrl('http://127.0.0.1:8104')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertSafeUrl('http://10.0.0.1/internal')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('rejects internal hostnames', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    await expect(assertSafeUrl('http://localhost:3000')).rejects.toBeInstanceOf(UnsafeUrlError)
    await expect(assertSafeUrl('http://db.internal')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('allows private targets in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    await expect(assertSafeUrl('http://localhost:8104')).resolves.toBeUndefined()
  })
})
