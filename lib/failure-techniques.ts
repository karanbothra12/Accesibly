// ── W3C "failure technique" checks that axe-core does not implement ───────────
// axe covers WCAG A/AA well but omits a few documented failure techniques. These
// pure helpers make the pass/fail DECISIONS in Node so they are unit-testable;
// the DOM collection lives in lib/audit.ts (inside page.evaluate), which hands
// these functions the raw strings/ids it gathered.

// F22 (SC 3.2.5 Change on Request, AAA): a link that opens a new window/tab must
// warn the user. We treat a warning as present when the link's accessible text
// (visible text + aria-label + title + aria-describedby text) mentions a new
// window/tab in any common phrasing. Multilingual so Angara's locale sites
// (uk-en, fr, de, es, …) aren't false-flagged when they DO warn in-language.
const NEW_WINDOW_HINT =
  /new window|new tab|opens in|opens a new|external link|nouvelle fen[eê]tre|nouvel onglet|neues fenster|neuer tab|nueva ventana|nueva pesta[nñ]a|nuova finestra|nuova scheda/i

export function hasNewWindowWarning(accessibleText: string): boolean {
  return NEW_WINDOW_HINT.test(accessibleText || '')
}

// F77 (SC 4.1.1 — plain duplicate ids): axe only enables `duplicate-id-aria`
// (ids referenced by ARIA/labels). Plain duplicate ids go uncaught, so we group
// every id and report those occurring more than once.
export function findDuplicateIds(ids: string[]): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>()
  for (const raw of ids) {
    const id = (raw || '').trim()
    if (!id) continue
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  const dups: Array<{ id: string; count: number }> = []
  for (const [id, count] of counts) if (count > 1) dups.push({ id, count })
  return dups
}

// F96 (SC 2.5.3 Label in Name, Level A / Section 508): when a control's accessible
// name is OVERRIDDEN (aria-label / aria-labelledby), it must still CONTAIN the
// visible label text — otherwise speech-input users who say the visible label can't
// activate it. axe's label-content-name-mismatch is conservative and often reports
// these only as "needs review" (incomplete), which the audit doesn't surface, so we
// make the F96 decision here. Returns true when a visible label exists but is NOT
// contained in the accessible name (the failure condition).
function normalizeLabel(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ') // drop punctuation / symbols / emoji
    .replace(/\s+/g, ' ')
    .trim()
}

export function hasLabelInNameMismatch(visibleText: string, accessibleName: string): boolean {
  const v = normalizeLabel(visibleText)
  const a = normalizeLabel(accessibleName)
  // Need both a visible label and an accessible name. normalizeLabel strips symbols/
  // emoji, so a purely iconographic label (e.g. "★", "🔍") normalizes to "" and is
  // skipped here — but a NUMERIC label like a price ("$1,059 - $10,000+") is kept and
  // checked, matching PowerMapper (a price on a product link IS a visible label).
  if (!v || !a) return false
  return !a.includes(v) // F96: visible label not contained in the accessible name
}

// WCAG 1.3.5 Identify Input Purpose (Level AA): fields collecting information ABOUT
// THE USER must expose that purpose via an HTML autocomplete token (technique H98).
// axe only checks autocomplete values that are present (autocomplete-valid); it can't
// flag a MISSING one. We infer the likely purpose from the field's name/id/label/
// placeholder and flag user-info fields that don't already carry a valid token.

// The standard HTML autocomplete field-name tokens (subset relevant to user info).
const VALID_AUTOCOMPLETE = new Set([
  'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'honorific-suffix',
  'nickname', 'username', 'new-password', 'current-password', 'one-time-code', 'email', 'impp', 'url',
  'organization-title', 'organization', 'street-address', 'address-line1', 'address-line2', 'address-line3',
  'address-level1', 'address-level2', 'address-level3', 'address-level4', 'country', 'country-name',
  'postal-code', 'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number', 'cc-exp',
  'cc-exp-month', 'cc-exp-year', 'cc-csc', 'cc-type', 'language', 'bday', 'bday-day', 'bday-month',
  'bday-year', 'sex', 'tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'photo',
])

// Keyword → expected token. Ordered specific-first; the generic "name" rule is last
// so given/family/user/card names win. \b anchors avoid matching mid-word substrings.
const PURPOSE_HINTS: Array<{ re: RegExp; token: string }> = [
  { re: /\be[-\s]?mail\b/i, token: 'email' },
  { re: /(first|given|fore)[-\s_]?name|\bfname\b|givenname/i, token: 'given-name' },
  { re: /(last|family|sur)[-\s_]?name|\blname\b|surname/i, token: 'family-name' },
  { re: /user[-\s_]?name|user[-\s_]?id|\blogin\b/i, token: 'username' },
  { re: /\bphone\b|\btel\b|mobile|contact[-\s_]?number/i, token: 'tel' },
  { re: /zip|postal|post[-\s_]?code|pin[-\s_]?code|pincode/i, token: 'postal-code' },
  { re: /\bcountry\b/i, token: 'country-name' },
  { re: /company|organi[sz]ation|business[-\s_]?name/i, token: 'organization' },
  { re: /\bcity\b|\btown\b/i, token: 'address-level2' },
  { re: /\bstate\b|province|\bregion\b/i, token: 'address-level1' },
  { re: /street|address[-\s_]?line|\baddress\b|\baddr\b/i, token: 'street-address' },
  { re: /birth|\bdob\b|\bbday\b/i, token: 'bday' },
  { re: /card[-\s_]?number|cc[-\s_]?number|credit[-\s_]?card/i, token: 'cc-number' },
  { re: /\bcvv\b|\bcvc\b|security[-\s_]?code|card[-\s_]?code/i, token: 'cc-csc' },
  { re: /cardholder|\bcc[-\s_]?name\b/i, token: 'cc-name' },
  { re: /full[-\s_]?name|your[-\s_]?name|\bname\b/i, token: 'name' },
]

export function autocompleteHasValidPurpose(autocomplete: string): boolean {
  return (autocomplete || '').toLowerCase().trim().split(/\s+/).some(t => VALID_AUTOCOMPLETE.has(t))
}

// Returns the expected autocomplete token when a field appears to collect user info
// but does not already expose a valid purpose; null otherwise (= no 1.3.5 issue).
export function inputPurposeIssue(field: { autocomplete: string; hint: string }): string | null {
  if (autocompleteHasValidPurpose(field.autocomplete)) return null
  for (const h of PURPOSE_HINTS) if (h.re.test(field.hint || '')) return h.token
  return null
}
