// Périodes souples (début + nombre de jours). Même algorithme que public.period_of (migration 20261120000300).
// Partagé par l'application (Vite) et les fonctions Supabase (Deno) : aucun import.
//
// - Une période personnalisée enregistrée s'applique telle quelle.
// - Ailleurs : semaines de 7 jours commençant le jour réglé (0 = dimanche … 6 = samedi), entre les périodes
//   personnalisées ; un morceau de moins de 4 jours collé à une période personnalisée rejoint la semaine voisine.

export type StoredPeriod = { start: string; days: number }
export type Period = { start: string; days: number; custom: boolean }

const MIN_PIECE = 4

function toUTC(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const fromUTC = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDaysISO = (iso: string, n: number) => fromUTC(toUTC(iso) + n * 86400000)
export const diffDays = (a: string, b: string) => Math.round((toUTC(a) - toUTC(b)) / 86400000)
const dowOf = (iso: string) => new Date(toUTC(iso)).getUTCDay()

export function periodOf(day: string, weekStartDow: number, stored: StoredPeriod[]): Period {
  const own = stored.find((p) => p.start <= day && day < addDaysISO(p.start, p.days))
  if (own) return { start: own.start, days: own.days, custom: true }

  let lo: string | null = null // fin (exclue) de la période personnalisée précédente
  let hi: string | null = null // début de la suivante
  for (const p of stored) {
    const end = addDaysISO(p.start, p.days)
    if (end <= day && (lo == null || end > lo)) lo = end
    if (p.start > day && (hi == null || p.start < hi)) hi = p.start
  }

  const b0 = addDaysISO(day, -((dowOf(day) - weekStartDow + 7) % 7))
  let bounds: string[] = []
  for (let k = -3; k <= 3; k++) {
    const b = addDaysISO(b0, 7 * k)
    if ((lo == null || b > lo) && (hi == null || b < hi)) bounds.push(b)
  }
  if (lo != null && bounds.length && diffDays(bounds[0], lo) < MIN_PIECE) bounds = bounds.slice(1)
  if (hi != null && bounds.length && diffDays(hi, bounds[bounds.length - 1]) < MIN_PIECE) bounds = bounds.slice(0, -1)

  const edges = [...(lo != null ? [lo] : []), ...bounds, ...(hi != null ? [hi] : [])]
  let start = b0
  for (const e of edges) if (e <= day) start = e
  const next = edges.find((e) => e > start)
  return { start, days: next ? diffDays(next, start) : 7, custom: false }
}
