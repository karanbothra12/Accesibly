import { query } from '@/lib/db'

// ── ISP / Country / ASN performance analytics ─────────────────────────────────
// Phase 2. Aggregates synthetic_results by a network dimension with avg/median/p95
// latency + availability + sample counts. We surface sample size and a confidence
// label, and gate out groups below a minimum sample count so we never rank an ISP
// on insufficient data. Measured from Accessly agents only (synthetic, not RUM).

export type Dimension = 'isp' | 'country' | 'asn'
const PERIOD_HOURS: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }

// Map the public dimension to a safe SQL column (never interpolate user input).
const DIM_SQL: Record<Dimension, string> = { isp: 'isp', country: 'country_code', asn: 'asn' }

export type AnalyticsRow = {
  key: string
  isp: string | null
  asn: number | null
  country: string | null
  samples: number
  availability: number
  avgTotal: number | null
  medianTotal: number | null
  p95Total: number | null
  avgDns: number | null
  avgTcp: number | null
  avgTls: number | null
  avgTtfb: number | null
  confidence: 'low' | 'medium' | 'high'
}

function confidenceOf(samples: number): 'low' | 'medium' | 'high' {
  if (samples >= 100) return 'high'
  if (samples >= 30) return 'medium'
  return 'low'
}

export async function dimensionBreakdown(opts: {
  merchantId: number
  dimension: Dimension
  period?: string
  websiteId?: number | null
  minSamples?: number
  allMerchants?: boolean // superadmin
}): Promise<AnalyticsRow[]> {
  const hours = PERIOD_HOURS[opts.period || '7d'] ?? 168
  const minSamples = opts.minSamples ?? 5
  const col = DIM_SQL[opts.dimension]

  const where: string[] = [`sr.measured_at >= NOW() - make_interval(hours => $1)`]
  const params: unknown[] = [hours]
  if (!opts.allMerchants) { params.push(opts.merchantId); where.push(`mw.merchant_id = $${params.length}`) }
  if (opts.websiteId) { params.push(opts.websiteId); where.push(`sr.website_id = $${params.length}`) }
  params.push(minSamples)
  const minIdx = params.length

  const rows = await query<{
    key: string; isp: string | null; asn: number | null; country: string | null
    samples: string; up: string; avg_total: number | null; median_total: number | null; p95_total: number | null
    avg_dns: number | null; avg_tcp: number | null; avg_tls: number | null; avg_ttfb: number | null
  }>(
    `SELECT COALESCE(sr.${col}::text, 'Unknown') AS key,
            MAX(sr.isp) AS isp, MAX(sr.asn) AS asn, MAX(sr.country_code) AS country,
            COUNT(*) AS samples,
            COUNT(*) FILTER (WHERE sr.available) AS up,
            AVG(sr.total_ms) AS avg_total,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sr.total_ms) AS median_total,
            PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY sr.total_ms) AS p95_total,
            AVG(sr.dns_ms) avg_dns, AVG(sr.tcp_ms) avg_tcp, AVG(sr.tls_ms) avg_tls, AVG(sr.ttfb_ms) avg_ttfb
     FROM synthetic_results sr JOIN monitored_websites mw ON mw.id = sr.website_id
     WHERE ${where.join(' AND ')}
     GROUP BY sr.${col}
     HAVING COUNT(*) >= $${minIdx}
     ORDER BY avg_total ASC NULLS LAST`,
    params
  )

  return rows.map(r => {
    const samples = Number(r.samples)
    return {
      key: r.key,
      isp: r.isp, asn: r.asn, country: r.country,
      samples,
      availability: samples ? (Number(r.up) / samples) * 100 : 0,
      avgTotal: r.avg_total, medianTotal: r.median_total, p95Total: r.p95_total,
      avgDns: r.avg_dns, avgTcp: r.avg_tcp, avgTls: r.avg_tls, avgTtfb: r.avg_ttfb,
      confidence: confidenceOf(samples),
    }
  })
}
