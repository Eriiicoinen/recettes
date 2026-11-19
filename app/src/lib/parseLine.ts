import { norm, parseQty, UNITS, type RecipeLine } from './recipes'

// Variantes écrites → unité canonique
const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gr: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg',
  ml: 'ml', cl: 'cl', dl: 'dl', l: 'l', litre: 'l', litres: 'l',
  'c. a s.': 'c. à s.', 'c.a.s': 'c. à s.', 'c.a.s.': 'c. à s.', cas: 'c. à s.', cs: 'c. à s.', 'cuillere a soupe': 'c. à s.', 'cuilleres a soupe': 'c. à s.', 'cuil. a soupe': 'c. à s.',
  'c. a c.': 'c. à c.', 'c.a.c': 'c. à c.', 'c.a.c.': 'c. à c.', cac: 'c. à c.', cc: 'c. à c.', 'cuillere a cafe': 'c. à c.', 'cuilleres a cafe': 'c. à c.', 'cuil. a cafe': 'c. à c.',
  piece: 'pièce', pieces: 'pièce', gousse: 'gousse', gousses: 'gousse', botte: 'botte', bottes: 'botte',
  tranche: 'tranche', tranches: 'tranche', pincee: 'pincée', pincees: 'pincée', sachet: 'sachet', sachets: 'sachet',
  boite: 'boîte', boites: 'boîte', pot: 'pot', pots: 'pot', verre: 'verre', verres: 'verre', tasse: 'tasse', tasses: 'tasse',
  feuille: 'feuille', feuilles: 'feuille', brin: 'brin', brins: 'brin',
}

const ALIAS_KEYS = Object.keys(UNIT_ALIASES).sort((a, b) => b.length - a.length)
const FRACTIONS: Record<string, string> = { '½': '0.5', '¼': '0.25', '¾': '0.75', '⅓': '0.3333', '⅔': '0.6667' }

/**
 * "200 g de farine" → { quantity: 200, unit: 'g', name: 'farine' }
 * "2 oignons, émincés" → { quantity: 2, unit: null, name: 'oignons', note: 'émincés' }
 * "sel, poivre" → { name: 'sel, poivre' } (pas de virgule-note sans quantité)
 */
export function parseIngredientLine(raw: string): RecipeLine | null {
  let s = raw.trim().replace(/^[-•*·]\s*/, '')
  if (!s) return null
  for (const [k, v] of Object.entries(FRACTIONS)) s = s.replace(k, ` ${v}`).trim()

  let quantity: number | null = null
  const q = s.match(/^(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|\d+\s+\d\.\d+)\s*/)
  if (q) {
    const parts = q[1].split(/\s+/)
    quantity = parts.length === 2 && parts[1].includes('.') ? Number(parts[0]) + Number(parts[1]) : parseQty(q[1].replace(/\s/g, ''))
    s = s.slice(q[0].length)
  }

  let unit: string | null = null
  const n = norm(s)
  for (const key of ALIAS_KEYS) {
    if (n.startsWith(key) && (n.length === key.length || /[\s.']/.test(n[key.length]))) {
      unit = UNIT_ALIASES[key]
      s = s.slice(key.length).replace(/^[.\s]+/, '')
      break
    }
  }
  s = s.replace(/^(de |d'|d’)/i, '').trim()

  let note: string | null = null
  const comma = s.indexOf(',')
  if (comma > 0 && (quantity != null || unit)) {
    note = s.slice(comma + 1).trim() || null
    s = s.slice(0, comma).trim()
  }
  const paren = s.match(/^(.*?)\s*\((.+)\)\s*$/)
  if (paren) {
    s = paren[1]
    note = [paren[2], note].filter(Boolean).join(', ')
  }
  if (!s) return null
  if (unit && !UNITS.includes(unit)) unit = null
  return { name: s, quantity, unit, note }
}
