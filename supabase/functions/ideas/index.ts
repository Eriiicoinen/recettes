// « Que faire avec ce que j'ai ? » : 3 idées de plats à partir d'ingrédients disponibles.
// POST { have: string[] }  →  { ideas: Idea[] }
import Anthropic from 'npm:@anthropic-ai/sdk@1.10.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.10.0/helpers/zod'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { z } from 'npm:zod@4.6.7'
import { MODEL } from '../_shared/models.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const Ideas = z.object({
  ideas: z.array(z.object({
    name: z.string(),
    pitch: z.string().describe('Une phrase qui donne envie, sans répéter le nom'),
    minutes: z.number().int().describe('Temps total approximatif'),
    servings: z.number().int(),
    ingredients: z.array(z.string()).describe('Liste complète avec quantités, ex. « 3 courgettes », « 200 g de feta »'),
    missing: z.array(z.string()).describe('Ingrédients à acheter : ni dans la liste disponible, ni de placard courant (sel, poivre, huile, farine, sucre, épices courantes)'),
    steps: z.array(z.string()).describe('Étapes courtes, sans numéro'),
  })),
})

function season(d = new Date()) {
  const m = d.getMonth() + 1
  return m >= 3 && m <= 5 ? 'printemps' : m >= 6 && m <= 8 ? 'été' : m >= 9 && m <= 11 ? 'automne' : 'hiver'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!user) return json({ error: 'Non connecté' }, 401)

  let body: { have?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Requête invalide' }, 400) }
  const have = (Array.isArray(body.have) ? body.have : []).map((s) => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 20)
  if (!have.length) return json({ error: 'Indique au moins un ingrédient.' }, 400)

  const { data: member } = await supabase.from('household_members').select('household_id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!member) return json({ error: 'Aucun foyer' }, 403)
  const [{ data: recipes }, { data: household }] = await Promise.all([
    supabase.from('recipes').select('name').eq('household_id', member.household_id).limit(300),
    supabase.from('households').select('people').eq('id', member.household_id).single(),
  ])

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  try {
    const response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(Ideas) },
      system: `Tu proposes des idées de repas familiaux, simples et de saison, en français, à une famille en France.
Propose exactement 3 plats différents (pas trois variantes du même) qui utilisent au mieux les ingrédients disponibles, avec le moins d'achats possible.
Recettes réalistes, de 15 à 60 minutes, pour ${household?.people ?? 2} personnes. Quantités métriques.
Évite les plats déjà présents dans le carnet de la famille (fournis) : l'application les propose déjà.`,
      messages: [{
        role: 'user',
        content: `Saison : ${season()}.\nIngrédients disponibles : ${have.join(', ')}.\nDéjà dans le carnet : ${(recipes ?? []).map((r) => r.name).join(' ; ') || '—'}`,
      }],
    })
    if (response.stop_reason === 'refusal') return json({ error: 'Pas d\'idée possible avec ces ingrédients.' }, 422)
    if (!response.parsed_output) return json({ error: 'Réponse illisible, réessaie.' }, 502)
    return json({ ideas: response.parsed_output.ideas.slice(0, 3) })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Trop de demandes, réessaie dans une minute.' }, 429)
    if (e instanceof Anthropic.APIError) return json({ error: `Erreur Claude ${e.status} : ${e.message}` }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
