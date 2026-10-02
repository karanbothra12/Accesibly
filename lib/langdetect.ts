// ── Language detection for WCAG 3.1.2 (Language of Parts) ─────────
// Uses `franc` (trigram model, 187 languages, offline, no native deps) so it
// works for ANY language — not a hardcoded stopword list. Runs in Node on text
// the crawler extracts. Conservative by design (needs enough words and a
// confident, page-different result) to avoid flagging brand names / loanwords.

import { francAll } from 'franc'

// ISO 639-3 (what franc returns) → ISO 639-1 (what a page `lang` usually is),
// for the languages franc-min can produce. Anything unmapped compares by 639-3.
const ISO3_TO_1: Record<string, string> = {
  eng: 'en', fra: 'fr', deu: 'de', spa: 'es', ita: 'it', por: 'pt', nld: 'nl', rus: 'ru',
  ukr: 'uk', pol: 'pl', ces: 'cs', slk: 'sk', ron: 'ro', hun: 'hu', ell: 'el', tur: 'tr',
  swe: 'sv', dan: 'da', nob: 'no', nno: 'no', fin: 'fi', cat: 'ca', bul: 'bg', srp: 'sr',
  hrv: 'hr', slv: 'sl', lit: 'lt', lav: 'lv', est: 'et', cmn: 'zh', jpn: 'ja', kor: 'ko',
  arb: 'ar', ara: 'ar', pes: 'fa', urd: 'ur', heb: 'he', hin: 'hi', ben: 'bn', tam: 'ta',
  tha: 'th', vie: 'vi', ind: 'id', zsm: 'ms', tgl: 'tl',
  // Scots is near-identical to English and franc often ranks it above English —
  // treat it as English so English text is never mislabeled/false-flagged.
  sco: 'en',
}
const NAMES: Record<string, string> = {
  eng: 'English', fra: 'French', deu: 'German', spa: 'Spanish', ita: 'Italian', por: 'Portuguese',
  nld: 'Dutch', rus: 'Russian', ukr: 'Ukrainian', pol: 'Polish', ces: 'Czech', slk: 'Slovak',
  ron: 'Romanian', hun: 'Hungarian', ell: 'Greek', tur: 'Turkish', swe: 'Swedish', dan: 'Danish',
  nob: 'Norwegian', nno: 'Norwegian', fin: 'Finnish', cat: 'Catalan', bul: 'Bulgarian', srp: 'Serbian',
  hrv: 'Croatian', slv: 'Slovenian', lit: 'Lithuanian', lav: 'Latvian', est: 'Estonian', cmn: 'Chinese',
  jpn: 'Japanese', kor: 'Korean', arb: 'Arabic', ara: 'Arabic', pes: 'Persian', urd: 'Urdu', heb: 'Hebrew',
  hin: 'Hindi', ben: 'Bengali', tam: 'Tamil', tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian',
  zsm: 'Malay', tgl: 'Tagalog', sco: 'English',
}

// Returns the detected language's display name when a text run is confidently in
// a language OTHER than the page language, else null. Conservative: franc is only
// reliable on real phrases/sentences (short nav labels like "Emerald Necklaces"
// mis-detect as random languages), so we require several words AND that the page
// language doesn't score nearly as well as the top guess.
export function detectForeignLanguage(text: string, pageLang: string): string | null {
  // Require a diacritic (é, ñ, ö, ł, ệ, …). Real foreign phrases in Latin script
  // carry accents; English product titles/marketing copy stuffed with loanwords
  // ("Prong-Set … Solitaire V-Bale Pendant", "modern equestrian structure") are
  // pure ASCII and repeatedly fool trigram detection — so ASCII Latin text is
  // NOT language-detected here. (Non-Latin scripts are handled separately.)
  if (!/[À-ɏḀ-ỿ]/.test(text)) return null

  const wordCount = (text.match(/[\p{L}][\p{L}À-ɏ'’-]*/gu) || []).length
  if (wordCount < 6) return null // need a phrase, not a label/brand

  const results = francAll(text, { minLength: 20 }) // [[iso3, score], …], score 0–1
  if (!results.length || results[0][0] === 'und') return null

  const pageCode = (pageLang || 'en').toLowerCase().split('-')[0]
  const topCode = results[0][0]
  const detected1 = ISO3_TO_1[topCode] || topCode
  if (detected1 === pageCode) return null // top guess IS the page language → fine

  // Margin guard: if the page language scores nearly as high as the top guess,
  // the run is probably the page language franc slightly mis-ranked.
  let pageScore = 0
  for (const [code, score] of results) if ((ISO3_TO_1[code] || code) === pageCode) { pageScore = score; break }
  if (pageScore >= 0.85) return null

  return NAMES[topCode] || topCode.toUpperCase()
}
