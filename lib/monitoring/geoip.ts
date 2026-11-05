import { query, queryOne } from '@/lib/db'

// ── IP intelligence (ISP / ASN) with a provider abstraction ───────────────────
// Phase 2. Resolves a public IP to its ISP, ASN, org, country/city and a coarse
// network type. Swappable providers (MaxMind GeoLite2, IPinfo, or none) behind one
// interface, with a DB cache so we don't re-query a provider for every measurement.
// We NEVER fabricate ISP names — if a provider can't resolve it, we return nulls.

export type IpIntel = {
  asn: number | null
  asnOrg: string | null
  isp: string | null
  countryCode: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  networkType: string
  source: string
}

interface GeoProvider {
  name: string
  lookup(ip: string): Promise<IpIntel | null>
}

// Hosting/cloud ASNs → 'datacenter'. Only a confident keyword match classifies;
// everything else is 'unknown' (we don't guess residential vs mobile without data).
const DC_HINTS = /amazon|aws|google|cloudflare|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|fastly|oracle|alibaba|tencent|vultr|leaseweb|contabo|gcore|datacenter|hosting|cloud|server/i
export function classifyNetwork(asnOrg: string | null, ipinfoType?: string): string {
  if (ipinfoType === 'hosting') return 'datacenter'
  if (ipinfoType === 'isp') return 'residential'
  if (ipinfoType === 'business') return 'business'
  if (asnOrg && DC_HINTS.test(asnOrg)) return 'datacenter'
  return 'unknown'
}

// Parse IPinfo's "org" field, e.g. "AS13335 Cloudflare, Inc." → { asn, org }.
export function parseIpinfoOrg(org: string | null | undefined): { asn: number | null; org: string | null } {
  if (!org) return { asn: null, org: null }
  const m = org.match(/^AS(\d+)\s+(.*)$/)
  if (m) return { asn: Number(m[1]), org: m[2].trim() }
  return { asn: null, org: org.trim() }
}

const ipinfoProvider = (token: string): GeoProvider => ({
  name: 'ipinfo',
  async lookup(ip) {
    const res = await fetch(`https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${token}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const d = await res.json() as Record<string, string>
    const { asn, org } = parseIpinfoOrg(d.org)
    const [lat, lon] = (d.loc || '').split(',').map(Number)
    return {
      asn, asnOrg: org, isp: org,
      countryCode: d.country || null, city: d.city || null,
      latitude: Number.isFinite(lat) ? lat : null, longitude: Number.isFinite(lon) ? lon : null,
      networkType: classifyNetwork(org), source: 'ipinfo',
    }
  },
})

// MaxMind GeoLite2 adapter — reads local .mmdb files via the optional `maxmind`
// package. Only active when MAXMIND_ASN_DB is set AND the package is installed.
// Load the optional `maxmind` package at RUNTIME only. Using new Function hides the
// dynamic import from webpack/turbopack static analysis, so the build doesn't try to
// resolve the (optional, uninstalled) package. If it's not installed, this throws and
// we fall back to null — i.e. maxmind support is purely opt-in via `npm i maxmind`.
type MaxmindReader = { get(ip: string): unknown }
type MaxmindModule = { open(path: string): Promise<MaxmindReader> }
const importOptional = new Function('m', 'return import(m)') as (m: string) => Promise<MaxmindModule>

const maxmindProvider = (asnDb: string, cityDb?: string): GeoProvider => ({
  name: 'maxmind',
  async lookup(ip) {
    try {
      const maxmind = await importOptional('maxmind').catch(() => null)
      if (!maxmind) return null
      const asnReader = await maxmind.open(asnDb)
      const asnRec = asnReader.get(ip) as { autonomous_system_number?: number; autonomous_system_organization?: string } | null
      let countryCode: string | null = null, city: string | null = null, lat: number | null = null, lon: number | null = null
      if (cityDb) {
        const cityReader = await maxmind.open(cityDb)
        const c = cityReader.get(ip) as { country?: { iso_code?: string }; city?: { names?: { en?: string } }; location?: { latitude?: number; longitude?: number } } | null
        countryCode = c?.country?.iso_code ?? null
        city = c?.city?.names?.en ?? null
        lat = c?.location?.latitude ?? null
        lon = c?.location?.longitude ?? null
      }
      const org = asnRec?.autonomous_system_organization ?? null
      return {
        asn: asnRec?.autonomous_system_number ?? null, asnOrg: org, isp: org,
        countryCode, city, latitude: lat, longitude: lon,
        networkType: classifyNetwork(org), source: 'maxmind',
      }
    } catch {
      return null
    }
  },
})

export function getProvider(): GeoProvider | null {
  if (process.env.IPINFO_TOKEN) return ipinfoProvider(process.env.IPINFO_TOKEN)
  if (process.env.MAXMIND_ASN_DB) return maxmindProvider(process.env.MAXMIND_ASN_DB, process.env.MAXMIND_CITY_DB)
  return null
}

// Privacy: for RUM we never want to store a visitor's full IP. Truncating IPv4 to
// /24 (zero last octet) and IPv6 to /48 keeps ISP/ASN resolution (which is prefix-
// level) while discarding host identity. Used before enriching visitor traffic.
export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const clean = ip.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(clean)) { const p = clean.split('.'); p[3] = '0'; return p.join('.') }
  if (clean.includes(':')) { const g = clean.split(':'); return g.slice(0, 3).join(':') + '::' } // /48
  return null
}

const CACHE_TTL_DAYS = 14

// Resolve an IP to intelligence, using the DB cache first. Returns null when no
// provider is configured (so callers degrade gracefully to "Unknown").
export async function enrichIp(ip: string | null | undefined): Promise<IpIntel | null> {
  if (!ip) return null
  const cached = await queryOne<IpIntel & { enriched_at: string }>(
    `SELECT asn, asn_org AS "asnOrg", isp, country_code AS "countryCode", city, network_type AS "networkType", source, enriched_at
     FROM ip_intelligence WHERE ip = $1 AND enriched_at > NOW() - make_interval(days => $2)`,
    [ip, CACHE_TTL_DAYS]
  )
  if (cached) return { ...cached, latitude: null, longitude: null }

  const provider = getProvider()
  if (!provider) return null
  let intel: IpIntel | null = null
  try { intel = await provider.lookup(ip) } catch { intel = null }
  if (!intel) return null

  await query(
    `INSERT INTO ip_intelligence (ip, asn, asn_org, isp, country_code, city, network_type, source, enriched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
     ON CONFLICT (ip) DO UPDATE SET asn=EXCLUDED.asn, asn_org=EXCLUDED.asn_org, isp=EXCLUDED.isp,
       country_code=EXCLUDED.country_code, city=EXCLUDED.city, network_type=EXCLUDED.network_type,
       source=EXCLUDED.source, enriched_at=NOW()`,
    [ip, intel.asn, intel.asnOrg, intel.isp, intel.countryCode, intel.city, intel.networkType, intel.source]
  )
  return intel
}
