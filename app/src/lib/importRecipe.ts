import { FunctionsHttpError } from '@supabase/supabase-js'
import type { Aisle, RecipeDraft, RecipeLine } from './recipes'
import { emptyDraft } from './recipes'
import { blobToBase64, shrinkImage } from './images'
import { supabase } from './supabase'

type Imported = {
  name: string
  category: string
  seasons: string[]
  servings: number
  yield_unit: string | null
  prep_minutes: number | null
  cook_minutes: number | null
  ingredients: { quantity: number | null; unit: string | null; name: string; note: string | null; aisle: string | null }[]
  steps: string[]
  tags: string[]
  notes: string | null
}

/** "https://…" seul → lien ; sinon le premier lien trouvé dans un texte court ; sinon texte de recette. */
export function splitInput(input: string): { url?: string; text?: string } {
  const s = input.trim()
  if (/^https?:\/\/\S+$/.test(s)) return { url: s }
  const link = s.match(/https?:\/\/\S+/)?.[0]
  if (link && s.length < 300) return { url: link } // texte de partage du type « Regarde cette recette : https://… »
  return { text: s }
}

type Photo = { media_type: string; data: string }

/** Photo réduite (1600 px au plus) en JPEG : lisible par Claude, légère à envoyer. */
async function shrink(file: File): Promise<Photo> {
  return { media_type: 'image/jpeg', data: await blobToBase64(await shrinkImage(file, 1600)) }
}

export async function importPhotos(files: File[], aisles: Aisle[]) {
  if (files.length > 4) throw new Error('4 photos au maximum.')
  let images: Photo[]
  try { images = await Promise.all(files.map(shrink)) } catch { throw new Error('Photo illisible : essaie en JPEG ou PNG.') }
  return callImport({ images }, aisles, 'photo')
}

export async function importRecipe(input: string, aisles: Aisle[]) {
  const body = splitInput(input)
  return callImport(body, aisles, body.url ? 'url' : 'text')
}

/** Variante d'une recette du carnet (végétarien, sans lactose…) réécrite par Claude ; rien n'est enregistré. */
export async function adaptRecipe(recipeId: string, request: string, aisles: Aisle[]) {
  return callImport({ adapt: { recipe_id: recipeId, request } }, aisles, 'claude')
}

async function callImport(body: object, aisles: Aisle[], kind: 'url' | 'text' | 'photo' | 'claude'): Promise<{ draft: RecipeDraft; lines: RecipeLine[] }> {
  const { data, error } = await supabase.functions.invoke('import-recipe', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? 'Import impossible.')
    }
    throw new Error('Import impossible : vérifie ta connexion.')
  }
  const r = data.recipe as Imported
  const aisleId = new Map(aisles.map((a) => [a.name, a.id]))
  return {
    draft: {
      ...emptyDraft(),
      name: r.name,
      category: r.category,
      seasons: r.seasons,
      servings: Math.max(1, r.servings || 4),
      yield_unit: r.yield_unit || null,
      prep_minutes: r.prep_minutes || null,
      cook_minutes: r.cook_minutes || null,
      steps: r.steps,
      tags: r.tags,
      notes: r.notes,
      source_kind: kind,
      source_url: data.source_url ?? null,
    },
    lines: r.ingredients.map((i) => ({
      name: i.name, quantity: i.quantity, unit: i.unit, note: i.note, aisle_id: i.aisle ? aisleId.get(i.aisle) ?? null : null,
    })),
  }
}

export async function findBySource(householdId: string, url: string | null) {
  if (!url) return null
  const { data } = await supabase.from('recipes').select('id, name').eq('household_id', householdId).eq('source_url', url).limit(1).maybeSingle()
  return data as { id: string; name: string } | null
}
