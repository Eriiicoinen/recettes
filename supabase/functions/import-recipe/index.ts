// Importe une recette depuis une URL, un texte collé ou des photos, et la renvoie structurée (sans l'enregistrer).
// POST { url?: string, text?: string, images?: { media_type, data (base64) }[], adapt?: { recipe_id, request } }
//   →  { recipe: ImportedRecipe, source_url: string | null }
// adapt : réécrit une recette du carnet selon une demande (végétarien, sans lactose…) ; rien n'est enregistré.
import Anthropic from 'npm:@anthropic-ai/sdk@1.10.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.10.0/helpers/zod'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import { z } from 'npm:zod@4.6.7'
import { FETCH_MODEL, MODEL } from '../_shared/models.ts'
import { DRINKS_RULES, drinksSchema } from '../_shared/drinks.ts'
import { extractFromHtml, isBotChallenge } from './extract.ts'

const CATEGORIES = ['Entrée', 'Plat', 'Accompagnement', 'Soupe', 'Salade', 'Dessert', 'Autre'] as const
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'] as const
const UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'c. à s.', 'c. à c.', 'pièce', 'gousse', 'botte', 'tranche', 'pincée',
  'sachet', 'boîte', 'pot', 'verre', 'tasse', 'feuille', 'brin']

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

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
    servings: z.number().int().describe('Quantité produite par la recette, telle qu\'indiquée par la source (ex. 4 pour « 4 personnes », 20 pour « 20 cookies », 1 pour « 1 cake »)'),
    yield_unit: z.string().nullable().describe('Ce que compte servings quand ce ne sont PAS des personnes/parts, au pluriel et en minuscules : « cookies », « pièces », « pots », « verrines », « crêpes », « cake », « tarte (moule 24 cm) ». null si ce sont des personnes ou des parts.'),
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
    drinks: drinksSchema,
  })
}

const SYSTEM = `Tu transformes une recette (données structurées d'une page web, texte de page, texte collé, ou photo d'un livre ou d'une fiche manuscrite) en fiche pour un carnet de recettes familial en français.

Règles :
- Tout en français. Traduis si la source est dans une autre langue, et convertis les unités impériales (cups, oz, lb, °F) en unités métriques.
- Reprends fidèlement les quantités et les étapes de la source ; n'invente pas d'ingrédient (sauf pour une adaptation demandée). Tu peux reformuler une étape pour la rendre claire et concise.
- Noms d'ingrédients : au singulier, majuscule initiale, réutilise exactement un nom de la liste « ingrédients déjà connus » quand c'est le même produit.
- Rayon : choisis le rayon de magasin le plus probable dans la liste fournie.
- Rendement : distingue bien un nombre de personnes d'un nombre de pièces. « Pour 20 cookies », « 12 muffins », « 1 cake », « 6 pots » → servings = ce nombre et yield_unit = « cookies », « muffins », « cake », « pots ». Les données schema.org (recipeYield) indiquent souvent seulement un nombre : vérifie dans le titre, les étapes ou le texte si ce nombre désigne des pièces. yield_unit = null uniquement pour des personnes ou des parts.
- Photo : lis tout le texte visible, y compris l'écriture manuscrite ; si plusieurs photos, ce sont les pages successives d'une même recette. Ce qui est illisible est omis plutôt qu'inventé.
- Adaptation demandée : applique la demande à la recette d'origine (remplace les ingrédients concernés, ajuste quantités, temps et étapes) en gardant son esprit. Ajoute la précision au nom entre parenthèses, ex. « Hachis parmentier (végétarien) ». Dans notes, explique en une ou deux phrases ce qui a changé. Si la demande est impossible ou dangereuse, mets is_recipe à false.
- ${DRINKS_RULES}
- Si le contenu ne contient pas de recette (page d'erreur, article, accueil), mets is_recipe à false et remplis le reste au mieux avec des valeurs vides.`

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
}

type Direct = { ok: true; content: string; finalUrl: string } | { ok: false; status: number }

/** Refuse les adresses internes (localhost, réseau privé, métadonnées cloud) : le serveur ne doit lire que le web public. */
function isPublicUrl(u: URL): boolean {
  if (!/^https?:$/.test(u.protocol)) return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (h.startsWith('[')) return false // IPv6 littérale
  const m = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false
  }
  return true
}

/** Lecture directe de la page depuis le serveur Supabase. */
async function fetchDirect(url: URL): Promise<Direct> {
  try {
    // Redirections suivies à la main pour vérifier chaque destination
    let current = url
    let res: Response
    for (let hop = 0; ; hop++) {
      if (!isPublicUrl(current)) return { ok: false, status: 0 }
      res = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: BROWSER_HEADERS })
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
      if (!location) break
      await res.body?.cancel()
      if (hop >= 5) return { ok: false, status: 0 }
      current = new URL(location, current)
    }
    if (!res.ok) return { ok: false, status: res.status }
    const html = await res.text()
    if (isBotChallenge(html)) return { ok: false, status: 429 }
    const page = extractFromHtml(html)
    const finalUrl = current.href
    if (page.jsonLd) return { ok: true, finalUrl, content: `Données structurées schema.org de la page ${finalUrl} :\n${JSON.stringify(page.jsonLd)}` }
    // Page sans données structurées et presque vide : probablement une page anti-robots
    if (page.text.length < 500) return { ok: false, status: 0 }
    return { ok: true, finalUrl, content: `Texte de la page ${finalUrl} (titre : ${page.title ?? '?'}) :\n${page.text}` }
  } catch {
    return { ok: false, status: 0 }
  }
}

/** Repli : Claude lit la page avec l'outil web_fetch (exécuté chez Anthropic) et en recopie la recette. */
async function fetchViaClaude(anthropic: Anthropic, url: string): Promise<string | null> {
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `Lis la page ${url} avec l'outil web_fetch et recopie fidèlement la recette qu'elle contient : titre, rendement tel qu'écrit (ex. « 4 personnes », « 20 cookies »), temps de préparation et de cuisson, liste complète des ingrédients avec leurs quantités, et toutes les étapes. Texte brut, sans commentaire. Si la page ne contient pas de recette ou ne peut pas être lue, réponds uniquement : AUCUNE RECETTE`,
  }]
  for (let i = 0; i < 4; i++) {
    const response = await anthropic.messages.create({
      model: FETCH_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 2 }],
      messages,
    })
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content })
      continue
    }
    if (response.stop_reason !== 'end_turn') return null
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim()
    return !text || text.includes('AUCUNE RECETTE') ? null : text
  }
  return null
}

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

  let body: { url?: string; text?: string; images?: { media_type?: string; data?: string }[]; adapt?: { recipe_id?: string; request?: string } }
  try { body = await req.json() } catch { return json({ error: 'Requête invalide' }, 400) }
  const url = body.url?.trim() || null
  const pasted = body.text?.trim() || null
  const images = Array.isArray(body.images) ? body.images : []
  if (images.length > 4) return json({ error: '4 photos au maximum.' }, 400)
  for (const im of images) {
    if (!IMAGE_TYPES.includes(im.media_type as typeof IMAGE_TYPES[number]) || typeof im.data !== 'string' || im.data.length > 6_000_000) {
      return json({ error: 'Photo illisible ou trop lourde.' }, 400)
    }
  }
  const adapt = body.adapt?.recipe_id && body.adapt.request?.trim()
    ? { recipeId: String(body.adapt.recipe_id), request: body.adapt.request.trim().slice(0, 500) } : null
  if (!url && !pasted && !images.length && !adapt) return json({ error: 'Donne un lien, un texte ou une photo.' }, 400)

  // Contexte du foyer : rayons et ingrédients connus, pour des noms et rayons cohérents
  const { data: member } = await supabase.from('household_members').select('household_id').eq('user_id', user.id).limit(1).maybeSingle()
  if (!member) return json({ error: 'Aucun foyer' }, 403)
  const [{ data: aisles }, { data: known }] = await Promise.all([
    supabase.from('aisles').select('name').eq('household_id', member.household_id).order('position'),
    supabase.from('ingredients').select('name').eq('household_id', member.household_id).order('name').limit(500),
  ])
  const aisleNames = (aisles ?? []).map((a) => a.name as string)

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  let content: string
  let sourceUrl: string | null = null
  try {
    if (url) {
      let parsed: URL
      try { parsed = new URL(url) } catch { return json({ error: 'Lien invalide.' }, 400) }
      if (!isPublicUrl(parsed)) return json({ error: 'Lien invalide.' }, 400)
      const direct = await fetchDirect(parsed)
      if (direct.ok) {
        sourceUrl = direct.finalUrl
        content = direct.content
      } else if (direct.status === 404 || direct.status === 410) {
        return json({ error: 'Cette page n\'existe pas (erreur 404). Vérifie le lien.' }, 422)
      } else {
        // Site qui bloque les serveurs (403, 429, protection anti-robots…) : la page est lue par l'outil web_fetch d'Anthropic
        const viaClaude = await fetchViaClaude(anthropic, parsed.href)
        if (!viaClaude) {
          return json({
            error: 'Ce site bloque la lecture automatique (protection anti-robots). Ouvre la recette sur ton téléphone, copie son texte et colle-le ici à la place du lien.',
          }, 422)
        }
        sourceUrl = parsed.href
        content = `Recette lue sur ${sourceUrl} :\n${viaClaude}`
      }
    } else if (adapt) {
      // Recette lue avec les droits de l'utilisateur : seulement une recette de son foyer
      const { data: r } = await supabase.from('recipes')
        .select('name, category, seasons, servings, yield_unit, prep_minutes, cook_minutes, steps, notes, tags, recipe_ingredients(quantity, unit, note, position, ingredients(name))')
        .eq('id', adapt.recipeId).maybeSingle()
      if (!r) return json({ error: 'Recette introuvable.' }, 404)
      type Line = { quantity: number | null; unit: string | null; note: string | null; position: number; ingredients: { name: string } }
      const lines = ((r.recipe_ingredients ?? []) as unknown as Line[]).sort((a, b) => a.position - b.position)
        .map((l) => `- ${[l.quantity, l.unit].filter((x) => x != null && x !== '').join(' ')} ${l.ingredients.name}${l.note ? `, ${l.note}` : ''}`.replace(/^- +/, '- '))
      content = `Recette d'origine à adapter :
${r.name} (${r.category}) — pour ${r.servings} ${r.yield_unit ?? 'personnes'} — préparation ${r.prep_minutes ?? '?'} min, cuisson ${r.cook_minutes ?? '?'} min
Ingrédients :
${lines.join('\n')}
Étapes :
${(r.steps as string[]).map((st, i) => `${i + 1}. ${st}`).join('\n')}
${r.notes ? `Notes : ${r.notes}` : ''}

Demande d'adaptation : ${adapt.request}`
    } else if (images.length) {
      content = `Recette en photo (${images.length} image${images.length > 1 ? 's' : ''}) ci-dessus.${pasted ? `\nPrécision de l'utilisateur : ${pasted.slice(0, 2000)}` : ''}`
    } else {
      content = `Recette collée par l'utilisateur :\n${pasted!.slice(0, 60_000)}`
    }
    const imageBlocks: Anthropic.ImageBlockParam[] = url ? [] : images.map((im) => ({
      type: 'image',
      source: { type: 'base64', media_type: im.media_type as typeof IMAGE_TYPES[number], data: im.data! },
    }))

    const response = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(schemaFor(aisleNames)) },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          ...imageBlocks,
          { type: 'text', text: `Rayons du magasin : ${aisleNames.join(' ; ') || '—'}\nIngrédients déjà connus : ${(known ?? []).map((k) => k.name).join(' ; ') || '—'}\n\n${content}` },
        ],
      }],
    })
    if (response.stop_reason === 'refusal') return json({ error: 'Claude n\'a pas pu traiter ce contenu.' }, 422)
    if (response.stop_reason === 'max_tokens') return json({ error: 'Recette trop longue à traiter.' }, 422)
    const recipe = response.parsed_output
    if (!recipe) return json({ error: 'Réponse illisible, réessaie.' }, 502)
    if (!recipe.is_recipe) return json({ error: adapt ? "Claude n'a pas pu faire cette adaptation : essaie une autre demande." : images.length ? 'Aucune recette lisible sur cette photo.' : 'Aucune recette trouvée sur cette page.' }, 422)
    return json({ recipe, source_url: sourceUrl })
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'Clé API Claude invalide ou absente (secret ANTHROPIC_API_KEY).' }, 500)
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Trop de demandes, réessaie dans une minute.' }, 429)
    if (e instanceof Anthropic.APIError) return json({ error: `Erreur Claude ${e.status} : ${e.message}` }, 502)
    return json({ error: (e as Error).message }, 500)
  }
})
