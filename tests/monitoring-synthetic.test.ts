import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// The synthetic engine connects to a pinned IP and enforces a port allowlist +
// private-IP block. For these tests we exercise it against a real local HTTP
// server, so we opt into private targets (same switch used for local dev).
process.env.ALLOW_PRIVATE_TARGETS = '1'

// Imported AFTER the env is set so the module's allowPrivate() sees it.
const { runHttpCheck } = await import('@/lib/monitoring/synthetic')

let server: http.Server
let base: string

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('hello world') }
    else if (req.url === '/boom') { res.writeHead(500); res.end('nope') }
    else if (req.url === '/redir') { res.writeHead(302, { Location: '/ok' }); res.end() }
    else { res.writeHead(404); res.end('missing') }
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

afterAll(() => new Promise<void>(r => server.close(() => r())))

describe('runHttpCheck', () => {
  it('reports an available 200 with a timing breakdown', async () => {
    const r = await runHttpCheck(`${base}/ok`)
    expect(r.available).toBe(true)
    expect(r.statusCode).toBe(200)
    expect(r.errorType).toBeNull()
    expect(r.tcpMs).not.toBeNull()
    expect(r.ttfbMs).not.toBeNull()
    expect(r.totalMs).not.toBeNull()
    expect(r.tlsMs).toBeNull() // plain http has no TLS phase
    expect(r.responseSize).toBe('hello world'.length)
    expect(r.resolvedIp).toBe('127.0.0.1')
  })

  it('marks a 500 as unavailable with an http error', async () => {
    const r = await runHttpCheck(`${base}/boom`)
    expect(r.available).toBe(false)
    expect(r.statusCode).toBe(500)
    expect(r.errorType).toBe('http')
  })

  it('honours an explicit expectedStatus', async () => {
    const ok = await runHttpCheck(`${base}/ok`, { expectedStatus: 200 })
    expect(ok.available).toBe(true)
    const mismatch = await runHttpCheck(`${base}/ok`, { expectedStatus: 204 })
    expect(mismatch.available).toBe(false)
    expect(mismatch.errorType).toBe('http')
  })

  it('follows redirects and records redirect time', async () => {
    const r = await runHttpCheck(`${base}/redir`)
    expect(r.available).toBe(true)
    expect(r.statusCode).toBe(200)
    expect(r.redirectMs).not.toBeNull()
  })

  it('classifies a refused connection as a tcp error', async () => {
    // Nothing listening on this port → connection refused.
    const r = await runHttpCheck('http://127.0.0.1:1/')
    expect(r.available).toBe(false)
    expect(r.errorType).toBe('tcp')
  })
})
