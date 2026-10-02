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
