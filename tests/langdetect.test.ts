import { describe, it, expect } from 'vitest'
import { detectForeignLanguage } from '@/lib/langdetect'

describe('detectForeignLanguage (page lang = English)', () => {
  it('flags French review text', () => {
    expect(detectForeignLanguage("Bonjour Jérôme ! Nous sommes ravis d'apprendre que vous avez trouvé notre produit", 'en-gb')).toBe('French')
    expect(detectForeignLanguage('Très beau et de qualité supérieure', 'en-us')).toBe('French')
  })
  it('works for ANY language with diacritics, not a hardcoded set', () => {
    expect(detectForeignLanguage('Sehr schön und von hoher Qualität, wir sind begeistert', 'en')).toBe('German')
    expect(detectForeignLanguage('El diseño español es de muy buena calidad, gracias por su atención', 'en')).toBe('Spanish')
    expect(detectForeignLanguage('To jest bardzo piękny wisiorek wysokiej jakości bardzo dziękuję', 'en')).toBe('Polish')
  })
  it('does NOT flag normal English', () => {
    expect(detectForeignLanguage('This is a beautiful high quality pendant that we absolutely love', 'en')).toBeNull()
    expect(detectForeignLanguage('The quick brown fox jumps over the lazy dog every day', 'en')).toBeNull()
  })
  it('does NOT flag short brand/product phrases (too short to judge)', () => {
    expect(detectForeignLanguage('Fleur de Lis', 'en')).toBeNull()
    expect(detectForeignLanguage('de la', 'en')).toBeNull()
    expect(detectForeignLanguage('Eau de Parfum', 'en')).toBeNull()
  })
  it('ignores a single loanword inside English', () => {
    expect(detectForeignLanguage('We offer a beautiful eau de toilette for every occasion here', 'en')).toBeNull()
  })
  it('ignores ASCII English product titles / marketing full of loanwords', () => {
    // Real reported false positives on a UK (en-gb) page:
    expect(detectForeignLanguage('Prong-Set Round Lab-Grown Diamond Solitaire V-Bale Pendant', 'en-gb')).toBeNull()
    expect(detectForeignLanguage('Octagon buckle detail gives modern equestrian structure', 'en-gb')).toBeNull()
    expect(detectForeignLanguage('Classic Prong-Set Round Peridot Solitaire Pendant with Diamond', 'en')).toBeNull()
  })
  it('does not attempt pure-ASCII Latin text (precision over recall — avoids loanword FPs)', () => {
    // Genuinely non-English but ASCII → intentionally NOT flagged, to keep English
    // product pages false-positive-free. Accented foreign text is still caught.
    expect(detectForeignLanguage('Produk ini sangat bagus dan berkualitas tinggi terima kasih banyak', 'en')).toBeNull()
  })
})

describe('detectForeignLanguage (relative to page language)', () => {
  it('flags German (accented) text on a French page', () => {
    expect(detectForeignLanguage('Sehr schön und von hoher Qualität, wir sind begeistert', 'fr')).toBe('German')
  })
  it('does not flag French text on a French page', () => {
    expect(detectForeignLanguage("Bonjour, nous sommes ravis que vous avez trouvé notre produit de qualité", 'fr-fr')).toBeNull()
  })
})
