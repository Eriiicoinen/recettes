import { cacheGet, cacheSet } from './offline'
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
  /** « Qu'est-ce qu'on boit ? » : accords proposés par Claude */
  drinks: Drink[]
  created_at: string
  updated_at: string
}

export type Drink = { name: string; style: 'rouge' | 'blanc' | 'rosé' | 'bulles' | 'doux' | 'autre'; why: string }

/** Demande à Claude des vins pour une recette ; ils sont enregistrés dans la recette. */
export async function suggestDrinks(recipeId: string): Promise<Drink[]> {
  const { data, error } = await supabase.functions.invoke('drinks', { body: { recipe_id: recipeId } })
  if (error) {
    const payload = 'context' in error ? await (error.context as Response).json().catch(() => null) : null
    throw new Error(payload?.error ?? 'Suggestion impossible : vérifie ta connexion.')
  }
  return data.drinks as Drink[]
}

export type Ingredient = {
  id: string
  name: string
  default_unit: string | null
  aisle_id: string | null
  is_staple: boolean
  /** Conditionnement en magasin, dans l'unité pack_unit (g, ml, '' = pièces) */
  pack_size: number | null
  pack_unit: string | null
  pack_label: string | null
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
  steps: [], notes: null, tags: [], is_favorite: false, is_simple: false, source_kind: 'manual', source_url: null, photo_url: null, drinks: [],
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
  const key = `recettes.recipes.${householdId}`
  const { data, error } = await supabase.from('recipes').select('*').eq('household_id', householdId).order('name')
  if (error) {
    // Hors ligne : le carnet mémorisé
    const cached = cacheGet<Recipe[]>(key)
    if (cached) return cached
    throw error
  }
  cacheSet(key, data)
  return data as Recipe[]
}

type RecipeRow = Recipe & {
  recipe_ingredients: { id: string; ingredient_id: string; quantity: number | null; unit: string | null; note: string | null; position: number; ingredients: { name: string } }[]
}
const RECIPE_SELECT = '*, recipe_ingredients(id, ingredient_id, quantity, unit, note, position, ingredients(name))'

function shapeRecipe(data: RecipeRow): { recipe: Recipe; lines: RecipeLine[] } {
  const { recipe_ingredients, ...recipe } = data
  const lines = [...recipe_ingredients]
    .sort((a, b) => a.position - b.position)
    .map((l) => ({ id: l.id, ingredient_id: l.ingredient_id, name: l.ingredients.name, quantity: l.quantity, unit: l.unit, note: l.note }))
  return { recipe, lines }
}

/**
 * Mémorise toutes les recettes (avec ingrédients) sur le téléphone, pour cuisiner sans réseau.
 * Au plus une fois toutes les 30 minutes.
 */
export async function cacheAllRecipes(householdId: string) {
  const stamp = `recettes.cachedAt.${householdId}`
  const last = cacheGet<number>(stamp) ?? 0
  if (Date.now() - last < 30 * 60_000) return
  const { data, error } = await supabase.from('recipes').select(RECIPE_SELECT).eq('household_id', householdId)
  if (error || !data) return
  for (const row of data as RecipeRow[]) cacheSet(`recettes.recipe.${row.id}`, shapeRecipe(row))
  cacheSet(stamp, Date.now())
}

export async function listStats(): Promise<Map<string, RecipeStats>> {
  const { data } = await supabase.from('recipe_stats').select('*')
  return new Map((data ?? []).map((s: RecipeStats) => [s.recipe_id, s]))
}

export async function listIngredients(householdId: string): Promise<Ingredient[]> {
  const { data, error } = await supabase.from('ingredients')
    .select('id, name, default_unit, aisle_id, is_staple, pack_size, pack_unit, pack_label').eq('household_id', householdId).order('name')
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
  const key = `recettes.recipe.${id}`
  const { data, error } = await supabase.from('recipes').select(RECIPE_SELECT).eq('id', id).maybeSingle()
  if (error) {
    const cached = cacheGet<{ recipe: Recipe; lines: RecipeLine[] }>(key)
    if (cached) return cached
    throw error
  }
  if (!data) return null
  const shaped = shapeRecipe(data as RecipeRow)
  cacheSet(key, shaped)
  return shaped
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
    // Seulement si présents : une copie hors ligne ancienne n'efface pas les accords enregistrés
    ...(fields.drinks?.length ? { drinks: fields.drinks } : {}),
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

/** Arrondi « de cuisine » d'une quantité recalculée : 66,7 g → 65 g, 2,67 œufs → 2½, 1,33 c. à s. → 1½. */
export function roundQty(n: number, unit: string | null): number {
  const u = (unit ?? '').toLowerCase().trim()
  const step = (s: number) => Math.max(s, Math.round(n / s) * s)
  if (u === 'g' || u === 'ml') return n < 20 ? step(1) : n < 100 ? step(5) : n < 1000 ? step(10) : step(50)
  if (u === 'mg') return step(1)
  if (u === 'cl' || u === 'dl') return n < 10 ? step(0.5) : step(1)
  if (u === 'kg' || u === 'l') return step(0.05)
  if (n < 1) return step(0.25)
  return step(0.5)
}

/** Quantité affichée pour un facteur de parts : exacte si facteur 1, arrondie sinon. */
export function scaledQty(q: number | null, unit: string | null, factor: number): string {
  if (q == null) return ''
  return formatQty(factor === 1 ? q : roundQty(q * factor, unit))
}

// « 80 g », « 1,5 kg », « 20 cl », « 2 c. à s. », « 3 cuillères à soupe »… (pas les °C, minutes, cm)
const QTY_IN_TEXT = /(\d+(?:[.,]\d+)?)(\s?)(kg|mg|g|cl|dl|ml|l|litres?|c\.\s?à\s?s\.?|c\.\s?à\s?c\.?|cuill[eè]res?\s+à\s+(?:soupe|café))(?![\p{L}\d])/giu

/** Recalcule les quantités écrites dans un texte (étape, précision d'ingrédient). */
export function scaleText(text: string, factor: number): string {
  if (factor === 1 || !text) return text
  return text.replace(QTY_IN_TEXT, (_m, num: string, sp: string, unit: string) => {
    const q = Number(num.replace(',', '.'))
    const norm = unit.toLowerCase().startsWith('litre') ? 'l' : unit
    return `${formatQty(roundQty(q * factor, norm))}${sp}${unit}`
  })
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

/** Recette en texte simple (WhatsApp, SMS, mail), aux quantités affichées. */
export function recipeText(recipe: Recipe, lines: RecipeLine[], servings: number) {
  const f = servings / recipe.servings
  const out = [`🍽 ${recipe.name}`, `Pour ${yieldLabel(servings, recipe.yield_unit)}`]
  const t = [recipe.prep_minutes && `préparation ${formatDuration(recipe.prep_minutes)}`, recipe.cook_minutes && `cuisson ${formatDuration(recipe.cook_minutes)}`].filter(Boolean)
  if (t.length) out.push(t.join(' · '))
  if (lines.length) {
    out.push('', recipe.is_simple ? 'À acheter :' : 'Ingrédients :')
    for (const l of lines) {
      const q = [scaledQty(l.quantity, l.unit, f), l.unit].filter(Boolean).join(' ')
      out.push(`- ${q ? `${q} ` : ''}${l.name}${l.note ? `, ${scaleText(l.note, f)}` : ''}`)
    }
  }
  if (recipe.steps.length) out.push('', 'Étapes :', ...recipe.steps.map((st, i) => `${i + 1}. ${scaleText(st, f)}`))
  if (recipe.notes) out.push('', recipe.notes)
  if (recipe.drinks?.length) out.push('', 'À boire :', ...recipe.drinks.map((d) => `- ${d.name} (${d.style})`))
  if (recipe.source_url) out.push('', `Source : ${recipe.source_url}`)
  return out.join('\n')
}
