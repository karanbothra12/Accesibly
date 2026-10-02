// ── Accessibility standards / legislation mapping ─────────────────
// Virtually every accessibility LAW adopts WCAG 2.x Level A/AA as its technical
// standard. We run one WCAG engine (axe-core) and map its results to each law so
// merchants can view "compliance" against the standard for their country.
//
// This is a labelling layer over the automated WCAG results — it reflects the
// machine-testable subset only, not a legal conformance guarantee.

export type WcagVersion = '2.0' | '2.1' | '2.2'

export interface Standard {
  key: string
  name: string          // full name shown in the report
  short: string         // chip label
  region: string        // for the country/region selector
  wcagVersion: WcagVersion
  level: 'AA'           // all listed laws require Level A + AA
  note: string
}

// Ordered for the selector. Global guidelines first, then laws by region.
export const STANDARDS: Standard[] = [
  { key: 'wcag22aa',  name: 'WCAG 2.2 Level AA',            short: 'WCAG 2.2 AA', region: 'Global',         wcagVersion: '2.2', level: 'AA', note: 'Latest W3C guidelines (superset of 2.1).' },
  { key: 'wcag21aa',  name: 'WCAG 2.1 Level AA',            short: 'WCAG 2.1 AA', region: 'Global',         wcagVersion: '2.1', level: 'AA', note: 'The baseline most laws reference.' },
  { key: 'ada',       name: 'ADA (Title III)',              short: 'ADA',         region: 'United States',  wcagVersion: '2.1', level: 'AA', note: 'US courts/DOJ treat WCAG 2.1 AA as the benchmark.' },
  { key: 'section508',name: 'Section 508',                  short: '508',         region: 'United States',  wcagVersion: '2.0', level: 'AA', note: 'US federal — Revised 508 incorporates WCAG 2.0 AA.' },
  { key: 'eaa',       name: 'European Accessibility Act',   short: 'EAA',         region: 'European Union', wcagVersion: '2.1', level: 'AA', note: 'EAA conformance is met via EN 301 549 (WCAG 2.1 AA).' },
  { key: 'en301549',  name: 'EN 301 549',                   short: 'EN 301 549',  region: 'European Union', wcagVersion: '2.1', level: 'AA', note: 'EU harmonised standard (WCAG 2.1 AA).' },
  { key: 'bitv',      name: 'BITV 2.0',                     short: 'BITV',        region: 'Germany',        wcagVersion: '2.1', level: 'AA', note: 'German public-sector standard (EN 301 549).' },
  { key: 'rgaa',      name: 'RGAA',                         short: 'RGAA',        region: 'France',         wcagVersion: '2.1', level: 'AA', note: 'French standard aligned to WCAG 2.1 AA.' },
  { key: 'uk',        name: 'UK (Equality Act / PSBAR)',    short: 'UK',          region: 'United Kingdom', wcagVersion: '2.1', level: 'AA', note: 'UK public-sector regs require WCAG 2.1 AA.' },
  { key: 'aoda',      name: 'AODA',                         short: 'AODA',        region: 'Canada (Ontario)', wcagVersion: '2.0', level: 'AA', note: 'Ontario — WCAG 2.0 AA (excl. captions/audio-desc.).' },
  { key: 'aca',       name: 'Accessible Canada Act',        short: 'ACA',         region: 'Canada',         wcagVersion: '2.1', level: 'AA', note: 'Canada federal — EN 301 549 / WCAG 2.1 AA.' },
  { key: 'dda',       name: 'DDA / WCAG (Australia)',       short: 'DDA',         region: 'Australia',      wcagVersion: '2.1', level: 'AA', note: 'Australian government mandates WCAG 2.1 AA.' },
]

export function getStandard(key: string): Standard | undefined {
  return STANDARDS.find(s => s.key === key)
}

// axe encodes each rule's WCAG mapping in its tags: wcag2a/wcag2aa (2.0),
// wcag21a/wcag21aa (2.1), wcag22aa (2.2). AAA, best-practice and experimental
// tags are NOT law-required and are excluded from law compliance.
function inScopeTags(version: WcagVersion): Set<string> {
  const t = new Set<string>(['wcag2a', 'wcag2aa'])            // 2.0 A+AA
  if (version === '2.1' || version === '2.2') { t.add('wcag21a'); t.add('wcag21aa') }
  if (version === '2.2') { t.add('wcag22aa') }
  return t
}

export function violationInScope(tags: string[] | undefined, std: Standard): boolean {
  if (!tags || tags.length === 0) return false
  const allowed = inScopeTags(std.wcagVersion)
  return tags.some(t => allowed.has(t))
}

export interface StandardSummary {
  key: string
  name: string
  short: string
  region: string
  version: WcagVersion
  failingRules: number   // distinct axe rules in scope that failed
  compliant: boolean     // no automated failures in scope
  note: string
}

type Violation = { id?: string; tags?: string[] }

// Summarize a job's violations against every standard. `violations` is the flat
// list of failing axe rules across all audited pages (duplicates by rule id are
// collapsed per standard, so a rule failing on many pages counts once).
export function summarizeStandards(violations: Violation[]): StandardSummary[] {
  return STANDARDS.map(std => {
    const failing = new Set<string>()
    for (const v of violations) {
      if (violationInScope(v.tags, std)) failing.add(v.id || JSON.stringify(v.tags))
    }
    return {
      key: std.key, name: std.name, short: std.short, region: std.region,
      version: std.wcagVersion, failingRules: failing.size, compliant: failing.size === 0,
      note: std.note,
    }
  })
}
