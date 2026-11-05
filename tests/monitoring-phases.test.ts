import { describe, it, expect } from 'vitest'
import { parseIpinfoOrg, classifyNetwork, truncateIp } from '@/lib/monitoring/geoip'
import { parsePing, parseTraceroute } from '@/lib/monitoring/diagnostics'
import { causeHypothesis } from '@/lib/monitoring/incidents'

describe('geoip helpers (Phase 2)', () => {
  it('parses an IPinfo org string into ASN + name', () => {
    expect(parseIpinfoOrg('AS13335 Cloudflare, Inc.')).toEqual({ asn: 13335, org: 'Cloudflare, Inc.' })
    expect(parseIpinfoOrg('Reliance Jio Infocomm')).toEqual({ asn: null, org: 'Reliance Jio Infocomm' })
    expect(parseIpinfoOrg(null)).toEqual({ asn: null, org: null })
  })
  it('classifies datacenter vs unknown without guessing', () => {
    expect(classifyNetwork('Amazon.com, Inc.')).toBe('datacenter')
    expect(classifyNetwork('DigitalOcean, LLC')).toBe('datacenter')
    expect(classifyNetwork('Bharti Airtel')).toBe('unknown')     // not guessed as residential
    expect(classifyNetwork(null, 'hosting')).toBe('datacenter')   // ipinfo type wins
    expect(classifyNetwork('Some ISP', 'isp')).toBe('residential')
  })
  it('truncates IPs for privacy (no full visitor IP kept)', () => {
    expect(truncateIp('203.0.113.45')).toBe('203.0.113.0')
    expect(truncateIp('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::')
    expect(truncateIp('')).toBeNull()
    expect(truncateIp(null)).toBeNull()
  })
})

describe('diagnostics parsers (Phase 4)', () => {
  it('parses ping loss + avg rtt', () => {
    const out = `PING example.com (93.184.216.34): 56 data bytes
4 packets transmitted, 4 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 10.1/12.5/15.0/1.2 ms`
    const r = parsePing(out)
    expect(r.lossPct).toBe(0)
    expect(r.rttAvgMs).toBe(12.5)
    expect(r.transmitted).toBe(4)
  })
  it('parses traceroute hops', () => {
    const out = ` 1  10.0.0.1  1.2 ms
 2  *
 3  93.184.216.34  11.9 ms`
    const { hops } = parseTraceroute(out)
    expect(hops.length).toBe(3)
    expect(hops[0]).toEqual({ hop: 1, host: '10.0.0.1', rttMs: 1.2 })
    expect(hops[1].host).toBe('*')
    expect(hops[2].rttMs).toBe(11.9)
  })
})

describe('incident cause hypothesis (Phase 4)', () => {
  it('maps error phase to an evidence-based hypothesis, never a certainty', () => {
    expect(causeHypothesis('dns')).toMatch(/DNS/)
    expect(causeHypothesis('tcp')).toMatch(/network|routing|reachability/i)
    expect(causeHypothesis('ssl')).toMatch(/TLS|certificate/i)
    expect(causeHypothesis('http')).toMatch(/origin|application/i)
    expect(causeHypothesis(null)).toMatch(/inconclusive/i)
  })
})
