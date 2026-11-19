import { FunctionsHttpError } from '@supabase/supabase-js'
import { ingKey } from './recipes'
import { supabase } from './supabase'

export type BookMatch = {
  id: string
  name: string
  minutes: number
  matched: string[]
  /** Ingrédients à acheter (hors placard) */
  missing: string[]
}

export type Idea = {
  name: string
  pitch: string
  minutes: number
  servings: number
  ingredients: string[]
  missing: string[]
  steps: string[]
}

/** « Courgettes » correspond à « Courgette », « tomate » à « Tomate cerise » (et inversement). */
function matches(have: string, ingredient: string) {
  const a = ingKey(have)
  const b = ingKey(ingredient)
  return !!a && !!b && (a === b || ` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `))
}

/** Recettes du carnet qui utilisent ce qu'on a : le plus d'ingrédients utilisés, le moins d'achats. */
export async function matchBook(householdId: string, have: string[]): Promise<BookMatch[]> {
  const { data, error } = await supabase.from('recipes')
    .select('id, name, prep_minutes, cook_minutes, recipe_ingredients(ingredients(name, is_staple))')
    .eq('household_id', householdId)
  if (error) throw error
  type Row = { id: string; name: string; prep_minutes: number | null; cook_minutes: number | null
    recipe_ingredients: { ingredients: { name: string; is_staple: boolean } }[] }
  return (data as unknown as Row[])
    .map((r) => {
      const ings = r.recipe_ingredients.map((x) => x.ingredients)
      const matched = have.filter((h) => ings.some((i) => matches(h, i.name)))
      const missing = ings.filter((i) => !i.is_staple && !have.some((h) => matches(h, i.name))).map((i) => i.name)
      return { id: r.id, name: r.name, minutes: (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0), matched, missing }
    })
    .filter((m) => m.matched.length > 0)
    .sort((a, b) => b.matched.length - a.matched.length || a.missing.length - b.missing.length)
    .slice(0, 12)
}

export async function askClaude(have: string[]): Promise<Idea[]> {
  const { data, error } = await supabase.functions.invoke('ideas', { body: { have } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'Idées indisponibles.')
    }
    throw new Error('Idées indisponibles : vérifie ta connexion.')
  }
  return data.ideas as Idea[]
}

/** Texte de recette complet, pour la créer avec l'import habituel. */
export function ideaText(i: Idea) {
  return [i.name, `Pour ${i.servings} personnes · ${i.minutes} min`, '', 'Ingrédients :', ...i.ingredients.map((x) => `- ${x}`),
    '', 'Étapes :', ...i.steps.map((s, n) => `${n + 1}. ${s}`)].join('\n')
}
