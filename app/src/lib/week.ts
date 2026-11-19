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
  leftover_of: string | null
  reviewed_at: string | null
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

/** Parts à prévoir : la taille du foyer pour une recette « pour N personnes », le rendement d'origine sinon (20 cookies). */
export function defaultServings(recipe: Pick<Recipe, 'servings' | 'yield_unit'>, people: number | undefined) {
  return recipe.yield_unit ? recipe.servings : people || recipe.servings
}

export async function addToWeek(householdId: string, start: string, item: {
  recipe_id?: string | null; free_text?: string | null; day?: string | null; meal?: Meal | null; servings?: number | null
  leftover_of?: string | null
}) {
  const { data, error } = await supabase.from('week_items').insert({
    household_id: householdId, week_start: start,
    recipe_id: item.recipe_id ?? null, free_text: item.free_text ?? null,
    day: item.day ?? null, meal: item.day ? item.meal ?? 'soir' : null, servings: item.servings ?? null,
    leftover_of: item.leftover_of ?? null,
  }).select('*').single()
  if (error) throw error
  return data as WeekItem
}

export async function updateWeekItem(id: string, patch: Partial<Pick<WeekItem, 'day' | 'meal' | 'servings' | 'reviewed_at'>>) {
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

// ------------------------------------------------------------------ restes

/** Repas suivant : le soir du même jour après un midi, le midi du lendemain après un soir. */
export function nextSlot(day: string, meal: Meal): { day: string; meal: Meal } {
  return meal === 'midi' ? { day, meal: 'soir' } : { day: addDays(day, 1), meal: 'midi' }
}

/** Cuisine le double et place « Restes : … » au repas suivant (éventuellement la semaine d'après). */
export async function makeLeftovers(item: WeekItem, recipe: Recipe, people: number) {
  if (!item.day || !item.meal) throw new Error("Place d'abord ce repas sur un jour.")
  await updateWeekItem(item.id, { servings: (item.servings ?? defaultServings(recipe, people)) * 2 })
  const next = nextSlot(item.day, item.meal)
  await addToWeek(item.household_id, mondayOf(next.day), { free_text: `Restes : ${recipe.name}`, ...next, leftover_of: item.id })
}

/** Supprime des restes : le plat d'origine repasse à des quantités simples. */
export async function removeLeftovers(item: WeekItem, parent: WeekItem | undefined) {
  await removeWeekItem(item.id)
  if (parent?.servings && parent.servings >= 2) await updateWeekItem(parent.id, { servings: Math.round(parent.servings / 2) })
}

// ------------------------------------------------------------------ avis après le repas

/** Repas des 7 derniers jours pas encore évalués (les plus récents d'abord). */
export async function listToReview(householdId: string): Promise<WeekItem[]> {
  const today = todayISO()
  const { data, error } = await supabase.from('week_items').select('*')
    .eq('household_id', householdId).not('recipe_id', 'is', null).is('reviewed_at', null)
    .gte('day', addDays(today, -7)).lt('day', today)
    .order('day', { ascending: false }).order('meal', { ascending: false }).limit(5)
  if (error) throw error
  return data as WeekItem[]
}

export async function reviewMeal(itemId: string, rating: number | null, note: string) {
  const { error } = await supabase.rpc('review_meal', { p_item: itemId, p_rating: rating, p_note: note })
  if (error) throw error
}

// ------------------------------------------------------------------ remplir la semaine

export type Proposal = {
  day: string
  meal: Meal
  /** Recette du panier placée dans ce créneau */
  basketItem?: WeekItem
  recipe?: Recipe
  /** Restes du repas proposé à cet index */
  leftoverOf?: number
}

const isWeekday = (iso: string) => { const d = fromISO(iso).getDay(); return d >= 1 && d <= 5 }
const totalMinutes = (r: Recipe) => (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)

/** Score d'une recette pour un créneau : note, favori, pas faite récemment, rapide en semaine, différente du repas précédent. */
function slotScore(r: Recipe, day: string, prev: Recipe | undefined, lastCooked: Map<string, string | null>) {
  let s = (r.rating ?? 3) + (r.is_favorite ? 2 : 0) + Math.random() * 3
  const last = lastCooked.get(r.id)
  const days = last ? (Date.now() - fromISO(last).getTime()) / 86400000 : Infinity
  if (days < 14) s -= 4
  else if (days > 30) s += 2
  if (totalMinutes(r) > 45) s += isWeekday(day) ? -3 : 1
  if (prev && prev.category === r.category && r.category !== 'Plat') s -= 2
  if (prev && prev.tags.some((t) => r.tags.includes(t))) s -= 1
  return s
}

/** Recettes candidates : plats de saison, pas mal notées, pas déjà prévues. */
function fillPool(recipes: Recipe[], exclude: Set<string>, season: string) {
  return recipes.filter((r) => IDEA_CATEGORIES.has(r.category) && !exclude.has(r.id)
    && !(r.seasons.length && !r.seasons.includes(season)) && !(r.rating != null && r.rating <= 2))
}

/**
 * Propose un repas pour chaque créneau vide (à partir d'aujourd'hui) : d'abord les recettes du panier,
 * puis des recettes du carnet. Avec « restes », chaque dîner est cuisiné en double pour le midi suivant.
 */
export function proposeWeek(opts: {
  start: string; today: string; meals: Meal[]; items: WeekItem[]; recipes: Recipe[]
  lastCooked: Map<string, string | null>; season: string; leftovers: boolean
}): { proposals: Proposal[]; unfilled: number } {
  const { start, today, meals, items, recipes, lastCooked, season, leftovers } = opts
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const taken = new Set(items.filter((i) => i.day).map((i) => `${i.day}|${i.meal}`))
  const slots = weekDays(start).filter((d) => d >= today)
    .flatMap((day) => MEALS.map((m) => ({ day, meal: m.id })))
    .filter((s) => meals.includes(s.meal) && !taken.has(`${s.day}|${s.meal}`))

  const basket = items.filter((i) => !i.day)
  const pool = fillPool(recipes, new Set(items.map((i) => i.recipe_id).filter((x): x is string => !!x)), season)
  const proposals: Proposal[] = []
  const reserved = new Set<string>() // créneaux occupés par des restes
  let unfilled = 0
  let prev: Recipe | undefined

  for (const slot of slots) {
    if (reserved.has(`${slot.day}|${slot.meal}`)) continue
    let recipe: Recipe | undefined
    const fromBasket = basket.shift()
    if (fromBasket) {
      recipe = fromBasket.recipe_id ? byId.get(fromBasket.recipe_id) : undefined
      proposals.push({ ...slot, basketItem: fromBasket, recipe })
    } else if (pool.length) {
      const best = pool.map((r, i) => ({ i, s: slotScore(r, slot.day, prev, lastCooked) })).sort((a, b) => b.s - a.s)[0]
      recipe = pool.splice(best.i, 1)[0]
      proposals.push({ ...slot, recipe })
    } else {
      unfilled++
      continue
    }
    prev = recipe ?? prev
    // Restes du dîner pour le midi suivant, si ce créneau est libre et dans la semaine
    if (leftovers && slot.meal === 'soir' && recipe && !recipe.yield_unit && meals.includes('midi')) {
      const next = nextSlot(slot.day, 'soir')
      const nk = `${next.day}|${next.meal}`
      if (next.day < addDays(start, 7) && !taken.has(nk)) {
        reserved.add(nk)
        proposals.push({ ...next, leftoverOf: proposals.length - 1 })
      }
    }
  }
  return { proposals, unfilled }
}

/** Remplace la recette proposée pour un créneau par la meilleure suivante pas encore utilisée. */
export function swapProposal(proposals: Proposal[], index: number, recipes: Recipe[], items: WeekItem[],
  lastCooked: Map<string, string | null>, season: string): Proposal[] {
  const used = new Set([...items.map((i) => i.recipe_id), ...proposals.map((p) => p.recipe?.id)].filter((x): x is string => !!x))
  const pool = fillPool(recipes, used, season)
  if (!pool.length) return proposals
  const p = proposals[index]
  const prev = index > 0 ? proposals[index - 1].recipe : undefined
  const best = pool.map((r) => ({ r, s: slotScore(r, p.day, prev, lastCooked) })).sort((a, b) => b.s - a.s)[0].r
  return proposals.map((x, i) => (i === index ? { day: x.day, meal: x.meal, recipe: best } : x))
}

/** Retire une proposition (et ses restes) ; les index des restes suivants sont recalculés. */
export function dropProposal(proposals: Proposal[], index: number): Proposal[] {
  const keep = proposals.map((p, i) => i !== index && p.leftoverOf !== index)
  const newIndex = new Map<number, number>()
  proposals.forEach((_, i) => { if (keep[i]) newIndex.set(i, newIndex.size) })
  return proposals.filter((_, i) => keep[i])
    .map((p) => (p.leftoverOf == null ? p : { ...p, leftoverOf: newIndex.get(p.leftoverOf) }))
}

/** Enregistre les propositions retenues. */
export async function applyProposals(householdId: string, start: string, proposals: Proposal[], people: number) {
  const created = new Map<number, WeekItem>()
  for (const [i, p] of proposals.entries()) {
    if (p.leftoverOf != null) continue
    const double = proposals.some((x) => x.leftoverOf === i) ? 2 : 1
    if (p.basketItem) {
      const patch: Partial<Pick<WeekItem, 'day' | 'meal' | 'servings'>> = { day: p.day, meal: p.meal }
      if (double === 2 && p.recipe) patch.servings = (p.basketItem.servings ?? defaultServings(p.recipe, people)) * 2
      await updateWeekItem(p.basketItem.id, patch)
      created.set(i, { ...p.basketItem, ...patch })
    } else if (p.recipe) {
      created.set(i, await addToWeek(householdId, start, {
        recipe_id: p.recipe.id, day: p.day, meal: p.meal, servings: defaultServings(p.recipe, people) * double,
      }))
    }
  }
  for (const p of proposals) {
    if (p.leftoverOf == null) continue
    const parent = created.get(p.leftoverOf)
    const recipe = proposals[p.leftoverOf]?.recipe
    if (parent && recipe) {
      await addToWeek(householdId, start, { free_text: `Restes : ${recipe.name}`, day: p.day, meal: p.meal, leftover_of: parent.id })
    }
  }
}
