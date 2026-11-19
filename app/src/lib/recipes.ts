import { supabase } from './supabase'

export const CATEGORIES = ['Entrée', 'Plat', 'Accompagnement', 'Soupe', 'Salade', 'Dessert', 'Autre'] as const
export const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'] as const
export const UNITS = ['g', 'kg', 'ml', 'cl', 'dl', 'l', 'c. à s.', 'c. à c.', 'pièce', 'gousse', 'botte', 'tranche',
  'pincée', 'sachet', 'boîte', 'pot', 'verre', 'tasse', 'feuille', 'brin']

export type Recipe = {
  id: string
  household_id: string
  name: string
  category: string
  seasons: string[]
  rating: number | null
  servings: number
  /** Ce que compte servings : null = personnes ; sinon « cookies », « pots »… */
  yield_unit: string | null
  prep_minutes: number | null
  cook_minutes: number | null
  steps: string[]
  notes: string | null
  tags: string[]
  is_favorite: boolean
  /** Repas sans recette : juste une liste de courses (raclette, fondue…) */
  is_simple: boolean
  source_kind: string
  source_url: string | null
  photo_url: string | null
  created_at: string
  updated_at: string
}

export type Ingredient = {
  id: string
  name: string
  default_unit: string | null
  aisle_id: string | null
  is_staple: boolean
}

export type Aisle = { id: string; name: string; position: number }

export type RecipeLine = {
  id?: string
  ingredient_id?: string
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
  aisle_id?: string | null // utilisé seulement pour créer un nouvel ingrédient
}

export type RecipeStats = { recipe_id: string; last_cooked: string | null; times_cooked: number }

export type RecipeDraft = Omit<Recipe, 'id' | 'household_id' | 'created_at' | 'updated_at'> & { lines: RecipeLine[] }

export const emptyDraft = (): RecipeDraft => ({
  name: '', category: 'Plat', seasons: [], rating: null, servings: 4, yield_unit: null, prep_minutes: null, cook_minutes: null,
  steps: [], notes: null, tags: [], is_favorite: false, is_simple: false, source_kind: 'manual', source_url: null, photo_url: null,
  lines: [],
})

/** Normalisation identique à public.f_norm côté base : minuscules, sans accents. */
export function norm(s: string) {
  // œ/æ développés comme le fait unaccent() (« Œuf » = « Oeuf »), sinon l'index unique sur f_norm refuse l'insertion
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').trim()
}

/** Clé de rapprochement des ingrédients : sans accents, sans casse, au singulier ("Oignons" = "oignon"). */
export function ingKey(s: string) {
  return norm(s).split(/\s+/).map((w) => (w.length > 3 ? w.replace(/(s|x)$/, '') : w)).join(' ')
}

export function currentSeason(d = new Date()): string {
  const m = d.getMonth() + 1
  if (m >= 3 && m <= 5) return 'Printemps'
  if (m >= 6 && m <= 8) return 'Été'
  if (m >= 9 && m <= 11) return 'Automne'
  return 'Hiver'
}

export async function listRecipes(householdId: string, query: string): Promise<Recipe[]> {
  if (query.trim()) {
    const { data, error } = await supabase.rpc('search_recipes', { p_household: householdId, p_query: query.trim() })
    if (error) throw error
    return data as Recipe[]
  }
  const { data, error } = await supabase.from('recipes').select('*').eq('household_id', householdId).order('name')
  if (error) throw error
  return data as Recipe[]
}

export async function listStats(): Promise<Map<string, RecipeStats>> {
  const { data } = await supabase.from('recipe_stats').select('*')
  return new Map((data ?? []).map((s: RecipeStats) => [s.recipe_id, s]))
}

export async function listIngredients(householdId: string): Promise<Ingredient[]> {
  const { data, error } = await supabase.from('ingredients')
    .select('id, name, default_unit, aisle_id, is_staple').eq('household_id', householdId).order('name')
  if (error) throw error
  return data as Ingredient[]
}

export async function listAisles(householdId: string): Promise<Aisle[]> {
  const { data, error } = await supabase.from('aisles').select('id, name, position')
    .eq('household_id', householdId).order('position')
  if (error) throw error
  return data as Aisle[]
}

export async function getRecipe(id: string): Promise<{ recipe: Recipe; lines: RecipeLine[] } | null> {
  const { data, error } = await supabase.from('recipes')
    .select('*, recipe_ingredients(id, ingredient_id, quantity, unit, note, position, ingredients(name))')
    .eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const { recipe_ingredients, ...recipe } = data as Recipe & {
    recipe_ingredients: { id: string; ingredient_id: string; quantity: number | null; unit: string | null; note: string | null; position: number; ingredients: { name: string } }[]
  }
  const lines = recipe_ingredients
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ id: l.id, ingredient_id: l.ingredient_id, name: l.ingredients.name, quantity: l.quantity, unit: l.unit, note: l.note }))
  return { recipe, lines }
}

/** Trouve ou crée les ingrédients par nom (sans tenir compte des accents ni de la casse). */
async function resolveIngredients(householdId: string, lines: RecipeLine[]): Promise<Map<string, string>> {
  const known = await listIngredients(householdId)
  const byName = new Map(known.map((i) => [ingKey(i.name), i.id]))
  const missing = new Map<string, RecipeLine>()
  for (const l of lines) if (!byName.has(ingKey(l.name)) && !missing.has(ingKey(l.name))) missing.set(ingKey(l.name), l)
  if (missing.size) {
    const rows = [...missing.values()].map((l) => ({
      household_id: householdId, name: capitalize(l.name.trim()), default_unit: l.unit || null, aisle_id: l.aisle_id ?? null,
    }))
    const { data, error } = await supabase.from('ingredients').insert(rows).select('id, name')
    if (error) {
      // Créé entre-temps sur l'autre téléphone : un seul doublon fait échouer le lot, on réessaie un par un puis on relit
      for (const row of rows) await supabase.from('ingredients').insert(row)
      const again = await listIngredients(householdId)
      return new Map(again.map((i) => [ingKey(i.name), i.id]))
    }
    for (const i of data) byName.set(ingKey(i.name), i.id)
  }
  return byName
}

export async function saveRecipe(householdId: string, userId: string, draft: RecipeDraft, id?: string): Promise<string> {
  const { lines, ...fields } = draft
  const clean = lines.filter((l) => l.name.trim())
  // Uniquement les colonnes modifiables (le brouillon peut contenir id, dates… d'une recette chargée)
  const payload = {
    category: fields.category, seasons: fields.seasons, rating: fields.rating, servings: fields.servings,
    yield_unit: fields.yield_unit?.trim().toLowerCase() || null,
    prep_minutes: fields.prep_minutes, cook_minutes: fields.cook_minutes, is_favorite: fields.is_favorite,
    is_simple: fields.is_simple,
    source_kind: fields.source_kind, photo_url: fields.photo_url,
    name: fields.name.trim(),
    steps: fields.steps.map((s) => s.trim()).filter(Boolean),
    tags: fields.tags.map((t) => t.trim()).filter(Boolean),
    notes: fields.notes?.trim() || null,
    source_url: fields.source_url?.trim() || null,
  }

  let recipeId = id
  if (recipeId) {
    const { error } = await supabase.from('recipes').update(payload).eq('id', recipeId)
    if (error) throw error
  } else {
    const { data, error } = await supabase.from('recipes')
      .insert({ ...payload, household_id: householdId, created_by: userId }).select('id').single()
    if (error) throw error
    recipeId = data.id as string
  }

  const ids = await resolveIngredients(householdId, clean)
  // Vérifié avant de supprimer les anciennes lignes : sinon un échec laisserait la recette sans ingrédients
  const unresolved = clean.filter((l) => !ids.get(ingKey(l.name)))
  if (unresolved.length) throw new Error(`Ingrédients non enregistrés : ${unresolved.map((l) => l.name.trim()).join(', ')}`)
  // Suppression + insertion en une seule transaction côté base
  const { error } = await supabase.rpc('replace_recipe_ingredients', {
    p_recipe: recipeId,
    p_lines: clean.map((l, i) => ({
      ingredient_id: ids.get(ingKey(l.name)), quantity: l.quantity, unit: l.unit || null,
      note: l.note?.trim() || null, position: i,
    })),
  })
  if (error) throw error
  return recipeId!
}

export async function deleteRecipe(id: string) {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}

export async function setFavorite(id: string, value: boolean) {
  const { error } = await supabase.from('recipes').update({ is_favorite: value }).eq('id', id)
  if (error) throw error
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "1,5" → 1.5 ; "" → null */
export function parseQty(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number)
    return b ? a / b : null
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** 1.5 → "1,5" ; 0.333 → "⅓" ; null → "" */
export function formatQty(n: number | null): string {
  if (n == null) return ''
  const frac: [number, string][] = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']]
  const whole = Math.floor(n)
  const rest = n - whole
  if (whole < 10) for (const [v, sym] of frac) if (Math.abs(rest - v) < 0.02) return (whole ? whole : '') + sym
  const r = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10
  return String(r).replace('.', ',')
}

/** 4, null → « 4 pers. » ; 20, « cookies » → « 20 cookies » */
export function yieldLabel(n: number, unit: string | null) {
  return unit ? `${n} ${unit}` : `${n} pers.`
}

export function formatDuration(min: number | null) {
  if (!min) return ''
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

export function relativeDate(iso: string | null) {
  if (!iso) return 'Jamais cuisinée'
  const days = Math.round((Date.now() - new Date(iso + 'T12:00:00').getTime()) / 86400000)
  if (days <= 0) return "Aujourd'hui"
  if (days === 1) return 'Hier'
  if (days < 14) return `Il y a ${days} jours`
  if (days < 60) return `Il y a ${Math.round(days / 7)} semaines`
  return `Il y a ${Math.round(days / 30)} mois`
}

/**
 * Crée un repas sans recette depuis une liste collée (« 200 g fromage à raclette », « cornichons »…).
 * Les articles inconnus sont rangés dans le rayon deviné.
 */
export async function createSimpleMeal(householdId: string, userId: string, name: string, people: number,
  linesText: string, aisles: Aisle[], parse: (l: string) => RecipeLine | null, guess: (n: string, a: Aisle[]) => string | null) {
  const lines = linesText.split(/\r?\n/).map(parse).filter((l): l is RecipeLine => !!l)
    .map((l) => ({ ...l, name: l.name.charAt(0).toUpperCase() + l.name.slice(1), aisle_id: guess(l.name, aisles) }))
  const draft: RecipeDraft = { ...emptyDraft(), name: name.trim(), servings: Math.max(1, people), is_simple: true, lines }
  return saveRecipe(householdId, userId, draft)
}
