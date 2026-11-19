// Importe une recette depuis une URL ou un texte collé, et la renvoie structurée (sans l'enregistrer).
// POST { url?: string, text?: string }  →  { recipe: ImportedRecipe, source_url: string | null }
import Anthropic from 'npm:@anthropic-ai/sdk@1.10.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.10.0/helpers/zod'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { z } from 'npm:zod@4.6.7'
import { extractFromHtml } from './extract.ts'

const CATEGORIES = ['Entrée', 'Plat', 'Accompagnement', 'Soupe', 'Salade', 'Dessert', 'Autre'] as const
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'] as const
const UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'c. à s.', 'c. à c.', 'pièce', 'gousse', 'botte', 'tranche', 'pincée',
  'sachet', 'boîte', 'pot', 'verre', 'tasse', 'feuille', 'brin']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function schemaFor(aisles: string[]) {
  return z.object({
    is_recipe: z.boolean().describe('false si le contenu ne contient pas de recette de cuisine'),
    name: z.string(),
    category: z.enum(CATEGORIES),
    seasons: z.array(z.enum(SEASONS)).describe('Saisons où les ingrédients principaux sont de saison en France. Vide = toute l\'année.'),
    servings: z.number().int().describe('Nombre de parts / personnes'),
    prep_minutes: z.number().int().nullable(),
    cook_minutes: z.number().int().nullable(),
    ingredients: z.array(z.object({
      quantity: z.number().nullable().describe('Nombre décimal ; null si non chiffré (« sel », « un peu de »)'),
      unit: z.string().nullable().describe(`Une de : ${UNITS.join(', ')} ; null pour un nombre de pièces (« 3 œufs »)`),
      name: z.string().describe('Nom de l\'ingrédient au singulier, sans quantité ni préparation, ex. « Oignon », « Huile d\'olive »'),
      note: z.string().nullable().describe('Préparation ou précision : « émincé », « facultatif », « bien mûres »'),
      aisle: aisles.length ? z.enum(aisles as [string, ...string[]]).nullable() : z.string().nullable(),
    })),
    steps: z.array(z.string()).describe('Étapes dans l\'ordre, une phrase ou un paragraphe court chacune, sans numéro'),
    tags: z.array(z.string()).describe('2 à 4 mots-clés en minuscules : végétarien, rapide, batch cooking…'),
    notes: z.string().nullable().describe('Astuces ou variantes utiles présentes dans la source, sinon null'),
  })
}

const SYSTEM = `Tu transformes une recette (données structurées d'une page web, texte de page, ou texte collé) en fiche pour un carnet de recettes familial en français.

Règles :
- Tout en français. Traduis si la source est dans une autre langue, et convertis les unités impériales (cups, oz, lb, °F) en unités métriques.
- Reprends fidèlement les quantités et les étapes de la source ; n'invente pas d'ingrédient. Tu peux reformuler une étape pour la rendre claire et concise.
- Noms d'ingrédients : au singulier, majuscule initiale, réutilise exactement un nom de la liste « ingrédients déjà connus » quand c'est le même produit.
- Rayon : choisis le rayon de magasin le plus probable dans la liste fournie.
- Si le contenu ne contient pas de recette (page d'erreur, article, accueil), mets is_recipe à false et remplis le reste au mieux avec des valeurs vides.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  // Utilisateur connecté obligatoire ; les requêtes passent par ses droits (RLS)
  const authHeader = req.headers.get('Authorization') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''))
  if (!user) return json({ error: 'Non connecté' }, 401)

  let body: { url?: string; text?: string }
  try { body = await req.json() } catch { return json({ error: 'Requête invalide' }, 400) }
  const url = body.url?.trim() || null
  const pasted = body.text?.trim() || null
  if (!url && !pasted) return json({ error: 'Donne un lien ou un texte.' }, 400)

  // Contexte du foyer : rayons et ingrédients connus, pour des noms et rayons cohérents
  const { data: member } = await supabase.from('household_members').select('household_id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!member) return json({ error: 'Aucun foyer' }, 403)
  const [{ data: aisles }, { data: known }] = await Promise.all([
    supabase.from('aisles').select('name').eq('household_id', member.household_id).order('position'),
    supabase.from('ingredients').select('name').eq('household_id', member.household_id).order('name').limit(500),
  ])
  const aisleNames = (aisles ?? []).map((a) => a.name as string)

  let content: string
  let sourceUrl: string | null = null
  if (url) {
    let parsed: URL
    try { parsed = new URL(url) } catch { return json({ error: 'Lien invalide.' }, 400) }
    if (!/^https?:$/.test(parsed.protocol)) return json({ error: 'Lien invalide.' }, 400)
    let res: Response
    try {
      res = await fetch(parsed, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        },
      })
    } catch {
      return json({ error: 'Impossible d\'ouvrir cette page (site injoignable ou trop lent).' }, 502)
    }
    if (!res.ok) return json({ error: `La page a répondu ${res.status}. Vérifie le lien.` }, 502)
    const page = extractFromHtml(await res.text())
    sourceUrl = res.url || url
    content = page.jsonLd
      ? `Données structurées schema.org de la page ${sourceUrl} :\n${JSON.stringify(page.jsonLd)}`
      : `Texte de la page ${sourceUrl} (titre : ${page.title ?? '?'}) :\n${page.text}`
  } else {
    content = `Recette collée par l'utilisateur :\n${pasted!.slice(0, 60_000)}`
  }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  try {
    const response = await anthropic.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(schemaFor(aisleNames)) },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Rayons du magasin : ${aisleNames.join(' ; ') || '—'}\nIngrédients déjà connus : ${(known ?? []).map((k) => k.name).join(' ; ') || '—'}\n\n${content}`,
      }],
    })
    if (response.stop_reason === 'refusal') return json({ error: 'Claude n\'a pas pu traiter ce contenu.' }, 422)
    if (response.stop_reason === 'max_tokens') return json({ error: 'Recette trop longue à traiter.' }, 422)
    const recipe = response.parsed_output
    if (!recipe) return json({ error: 'Réponse illisible, réessaie.' }, 502)
    if (!recipe.is_recipe) return json({ error: 'Aucune recette trouvée sur cette page.' }, 422)
    return json({ recipe, source_url: sourceUrl })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'Clé API Claude invalide ou absente (secret ANTHROPIC_API_KEY).' }, 500)
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Trop de demandes, réessaie dans une minute.' }, 429)
    if (e instanceof Anthropic.APIError) return json({ error: `Erreur Claude ${e.status} : ${e.message}` }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
