import type { Recipe } from './recipes'
import { supabase } from './supabase'

export type Meal = 'midi' | 'soir'
export const MEALS: { id: Meal; label: string }[] = [{ id: 'midi', label: 'Midi' }, { id: 'soir', label: 'Soir' }]

export type WeekItem = {
  id: string
  household_id: string
  week_start: string
  recipe_id: string | null
  free_text: string | null
  day: string | null
  meal: Meal | null
  servings: number | null
  position: number
  created_at: string
}

// ------------------------------------------------------------------ dates (locales, au format AAAA-MM-JJ)

const pad = (n: number) => String(n).padStart(2, '0')
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromISO = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export const todayISO = () => toISO(new Date())
export function addDays(iso: string, n: number) {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}
/** Lundi de la semaine contenant la date */
export function mondayOf(iso: string) {
  const d = fromISO(iso)
  return addDays(iso, -((d.getDay() + 6) % 7))
}
export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i))

export function dayLabel(iso: string) {
  const s = fromISO(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
export function weekLabel(start: string) {
  const end = addDays(start, 6)
  const a = fromISO(start)
  const b = fromISO(end)
  const sameMonth = a.getMonth() === b.getMonth()
  const fa = a.toLocaleDateString('fr-FR', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })
  const fb = b.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  return `${fa} – ${fb}`
}
export function relativeWeek(start: string) {
  const diff = Math.round((fromISO(start).getTime() - fromISO(mondayOf(todayISO())).getTime()) / (7 * 86400000))
  if (diff === 0) return 'Cette semaine'
  if (diff === 1) return 'Semaine prochaine'
  if (diff === -1) return 'Semaine dernière'
  return diff > 0 ? `Dans ${diff} semaines` : `Il y a ${-diff} semaines`
}

// ------------------------------------------------------------------ données

export async function listWeek(householdId: string, start: string): Promise<WeekItem[]> {
  const { data, error } = await supabase.from('week_items').select('*')
    .eq('household_id', householdId).eq('week_start', start).order('position').order('created_at')
  if (error) throw error
  return data as WeekItem[]
}

export async function addToWeek(householdId: string, start: string, item: {
  recipe_id?: string | null; free_text?: string | null; day?: string | null; meal?: Meal | null; servings?: number | null
}) {
  const { data, error } = await supabase.from('week_items').insert({
    household_id: householdId, week_start: start,
    recipe_id: item.recipe_id ?? null, free_text: item.free_text ?? null,
    day: item.day ?? null, meal: item.day ? item.meal ?? 'soir' : null, servings: item.servings ?? null,
  }).select('*').single()
  if (error) throw error
  return data as WeekItem
}

export async function updateWeekItem(id: string, patch: Partial<Pick<WeekItem, 'day' | 'meal' | 'servings'>>) {
  const { error } = await supabase.from('week_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function removeWeekItem(id: string) {
  const { error } = await supabase.from('week_items').delete().eq('id', id)
  if (error) throw error
}

/** Recettes déjà prévues (panier ou créneau) dans une semaine donnée */
export async function weeksContaining(householdId: string, recipeId: string, starts: string[]) {
  const { data } = await supabase.from('week_items').select('week_start')
    .eq('household_id', householdId).eq('recipe_id', recipeId).in('week_start', starts)
  return new Set((data ?? []).map((r) => r.week_start as string))
}

// ------------------------------------------------------------------ idées

const IDEA_CATEGORIES = new Set(['Plat', 'Soupe', 'Salade'])

/**
 * Plats bien notés (ou pas encore notés), de saison, pas cuisinés depuis 30 jours et absents de la semaine.
 * Tirage pondéré par la note pour varier d'un appel à l'autre.
 */
export function pickIdeas(recipes: Recipe[], lastCooked: Map<string, string | null>, exclude: Set<string>, season: string, n = 5) {
  const cutoff = Date.now() - 30 * 86400000
  const pool = recipes.filter((r) => {
    if (!IDEA_CATEGORIES.has(r.category) || exclude.has(r.id)) return false
    if (r.seasons.length && !r.seasons.includes(season)) return false
    if (r.rating != null && r.rating <= 2) return false
    const last = lastCooked.get(r.id)
    return !last || fromISO(last).getTime() < cutoff
  })
  return pool
    .map((r) => ({ r, score: Math.random() * ((r.rating ?? 3) + (r.is_favorite ? 2 : 0)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.r)
}
