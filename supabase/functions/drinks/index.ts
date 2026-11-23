// « Qu'est-ce qu'on boit ? » : Claude propose des vins pour une recette et les enregistre dans recipes.drinks.
// - Utilisateur connecté : POST { recipe_id } → { drinks } (recette lue et modifiée avec ses droits, RLS)
// - Rattrapage (en-tête x-reminder-key) : POST { missing: true } → toutes les recettes sans accord
import Anthropic from 'npm:@anthropic-ai/sdk@1.10.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.10.0/helpers/zod'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2'
import { z } from 'npm:zod@4.6.7'
import { MODEL } from '../_shared/models.ts'
import { DRINKS_RULES, drinksSchema } from '../_shared/drinks.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SELECT = 'id, name, category, is_simple, steps, notes, recipe_ingredients(quantity, unit, note, position, ingredients(name))'
type Row = {
  id: string; name: string; category: string; is_simple: boolean; steps: string[]; notes: string | null
  recipe_ingredients: { quantity: number | null; unit: string | null; note: string | null; position: number; ingredients: { name: string } }[]
}

async function pair(anthropic: Anthropic, db: SupabaseClient, r: Row) {
  const lines = [...(r.recipe_ingredients ?? [])].sort((a, b) => a.position - b.position)
    .map((l) => `- ${[l.quantity, l.unit].filter((x) => x != null && x !== '').join(' ')} ${l.ingredients.name}${l.note ? `, ${l.note}` : ''}`)
  const text = `${r.name} (${r.is_simple ? 'repas sans recette' : r.category})
Ingrédients :
${lines.join('\n') || '—'}
${r.steps?.length ? `Étapes :\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}`
  const response = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(z.object({ drinks: drinksSchema })) },
    system: `Tu es caviste et tu conseilles une famille française sur quoi boire avec un plat. Réponds en français.\n${DRINKS_RULES}`,
    messages: [{ role: 'user', content: text }],
  })
  const drinks = response.parsed_output?.drinks
  if (!drinks?.length) throw new Error('Pas de suggestion, réessaie.')
  const { error } = await db.from('recipes').update({ drinks }).eq('id', r.id)
  if (error) throw error
  return drinks
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)
  let body: { recipe_id?: string; missing?: boolean }
  try { body = await req.json() } catch { return json({ error: 'Requête invalide' }, 400) }
  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })

  try {
    const key = Deno.env.get('REMINDER_KEY')
    if (key && req.headers.get('x-reminder-key') === key) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      const { data, error } = await admin.from('recipes').select(SELECT).eq('drinks', '[]').limit(40)
      if (error) return json({ error: error.message }, 500)
      const done: string[] = []
      const failed: string[] = []
      for (const r of (data ?? []) as unknown as Row[]) {
        try { await pair(anthropic, admin, r); done.push(r.name) } catch { failed.push(r.name) }
      }
      return json({ done, failed })
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await db.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
    if (!user) return json({ error: 'Non connecté' }, 401)
    if (!body.recipe_id) return json({ error: 'recipe_id manquant' }, 400)
    const { data: r } = await db.from('recipes').select(SELECT).eq('id', body.recipe_id).maybeSingle()
    if (!r) return json({ error: 'Recette introuvable.' }, 404)
    return json({ drinks: await pair(anthropic, db, r as unknown as Row) })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Trop de demandes, réessaie dans une minute.' }, 429)
    if (e instanceof Anthropic.APIError) return json({ error: `Erreur Claude ${e.status} : ${e.message}` }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
