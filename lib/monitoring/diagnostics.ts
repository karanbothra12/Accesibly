import { execFile } from 'node:child_process'
import dns from 'node:dns/promises'
import { resolveSafeTarget } from '@/lib/monitoring/ssrf-exec'
import { UnsafeUrlError } from '@/lib/ssrf'

// ── Network diagnostics (ping / traceroute / dns) ─────────────────────────────
// Phase 4. Run by an agent on demand to localize slowness. These shell out to
// system tools, which require privileges often only remote agents have — so every
// path degrades gracefully to a clear "unavailable" result rather than failing.
// The target is always re-validated (SSRF) before anything runs.

export type DiagKind = 'ping' | 'traceroute' | 'dns'
export type DiagResult = {
  kind: DiagKind
  target: string
  success: boolean
  summary: Record<string, unknown> | null
  raw: string | null
  error: string | null
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; code: number | null }> {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve({ stdout: stdout || '', code: err && typeof (err as { code?: number }).code === 'number' ? (err as { code: number }).code : (err ? 1 : 0) })
    })
  })
}

// Validate the URL/host is a public, safe target and return just the hostname.
async function safeHost(rawUrl: string): Promise<string> {
  const t = await resolveSafeTarget(rawUrl) // throws UnsafeUrlError if not allowed
  return t.hostname
}

export function parsePing(out: string): { lossPct: number | null; rttAvgMs: number | null; transmitted: number | null; received: number | null } {
  const loss = out.match(/([\d.]+)%\s*packet loss/i)
  const rtt = out.match(/=\s*[\d.]+\/([\d.]+)\/[\d.]+/) // min/avg/max
  const tx = out.match(/(\d+)\s*packets transmitted/i)
  const rx = out.match(/(\d+)\s*(?:packets )?received/i)
  return {
    lossPct: loss ? Number(loss[1]) : null,
    rttAvgMs: rtt ? Number(rtt[1]) : null,
    transmitted: tx ? Number(tx[1]) : null,
    received: rx ? Number(rx[1]) : null,
  }
}

export function parseTraceroute(out: string): { hops: { hop: number; host: string; rttMs: number | null }[] } {
  const hops: { hop: number; host: string; rttMs: number | null }[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/)
    if (!m) continue
    const hop = Number(m[1])
    const rest = m[2].trim()
    const ipM = rest.match(/(\d{1,3}(?:\.\d{1,3}){3}|[\da-f:]+)/i)
    const rttM = rest.match(/([\d.]+)\s*ms/)
    hops.push({ hop, host: ipM ? ipM[1] : (rest.startsWith('*') ? '*' : rest.split(/\s+/)[0]), rttMs: rttM ? Number(rttM[1]) : null })
  }
  return { hops }
}

export async function runDiagnostic(kind: DiagKind, rawUrl: string): Promise<DiagResult> {
  let host: string
  try {
    host = await safeHost(rawUrl)
  } catch (e) {
    return { kind, target: rawUrl, success: false, summary: null, raw: null,
      error: e instanceof UnsafeUrlError ? e.message : 'Could not resolve target' }
  }
  const base: DiagResult = { kind, target: host, success: false, summary: null, raw: null, error: null }

  try {
    if (kind === 'dns') {
      const t0 = performance.now()
      const addrs = await dns.lookup(host, { all: true })
      return { ...base, success: true, summary: { resolveMs: Math.round(performance.now() - t0), addresses: addrs.map(a => a.address) }, raw: addrs.map(a => a.address).join('\n') }
    }
    if (kind === 'ping') {
      const { stdout, code } = await run('ping', ['-c', '4', '-w', '10', host], 15000)
      if (!stdout) return { ...base, error: 'ping unavailable on this agent (tool missing or blocked)' }
      const s = parsePing(stdout)
      return { ...base, success: code === 0 && (s.received ?? 0) > 0, summary: s, raw: stdout.slice(0, 4000) }
    }
    // traceroute
    const { stdout } = await run('traceroute', ['-n', '-m', '20', '-q', '1', '-w', '2', host], 30000)
    if (!stdout) return { ...base, error: 'traceroute unavailable on this agent (tool missing or needs privileges)' }
    const s = parseTraceroute(stdout)
    return { ...base, success: s.hops.length > 0, summary: s, raw: stdout.slice(0, 8000) }
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : String(e) }
  }
}
