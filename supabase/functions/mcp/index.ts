// Serveur MCP « Recettes » pour Claude (connecteur personnalisé claude.ai / appli mobile).
// Transport Streamable HTTP sans état : chaque POST contient un message JSON-RPC, la réponse est du JSON.
// URL : https://<projet>.supabase.co/functions/v1/mcp/<code secret>  — le code identifie le foyer.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2'

const APP_URL = 'https://eriiicoinen.github.io/recettes/#'
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const CATEGORIES = ['Entrée', 'Plat', 'Accompagnement', 'Soupe', 'Salade', 'Dessert', 'Autre']
const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver']
const UNITS = ['g', 'kg', 'ml', 'cl', 'l', 'c. à s.', 'c. à c.', 'pièce', 'gousse', 'botte', 'tranche', 'pincée',
  'sachet', 'boîte', 'pot', 'verre', 'tasse', 'feuille', 'brin']

type Ctx = { db: SupabaseClient; householdId: string; userId: string }
type RpcMessage = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown> }

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

// ------------------------------------------------------------------ utilitaires

function norm(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}
/** Même règle que l'app : sans accents, sans casse, au singulier. */
function ingKey(s: string) {
  return norm(s).split(/\s+/).map((w) => (w.length > 3 ? w.replace(/(s|x)$/, '') : w)).join(' ')
}
function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function fmtQty(n: number | null) {
  if (n == null) return ''
  return String(Math.round(n * 100) / 100).replace('.', ',')
}
async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) })

// ------------------------------------------------------------------ outils

async function toolDefinitions(ctx: Ctx) {
  const { data: aisles } = await ctx.db.from('aisles').select('name').eq('household_id', ctx.householdId).order('position')
  const aisleNames = (aisles ?? []).map((a) => a.name as string)
  return [
    {
      name: 'add_recipe',
      title: 'Ajouter une recette au carnet',
      description:
        "Enregistre une recette dans le carnet de recettes familial (application Recettes & Menus), partagé entre les téléphones du foyer. " +
        "À utiliser quand l'utilisateur demande d'ajouter, sauvegarder ou garder une recette (« ajoute-la à mon carnet »). " +
        "Rédige tout en français. Ingrédients : un par entrée, nom au singulier avec majuscule (« Oignon », « Huile d'olive »), quantité numérique, unité métrique. " +
        "servings + yield_unit décrivent le rendement : 4 personnes → servings 4, yield_unit null ; 20 cookies → servings 20, yield_unit « cookies ». " +
        "Renvoie le lien vers la recette dans l'application.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'category', 'servings', 'ingredients', 'steps'],
        properties: {
          name: { type: 'string', description: 'Nom de la recette' },
          category: { type: 'string', enum: CATEGORIES },
          seasons: { type: 'array', items: { type: 'string', enum: SEASONS }, description: 'Saisons des ingrédients principaux ; vide = toute l\'année' },
          servings: { type: 'integer', minimum: 1, description: 'Quantité produite (personnes, ou pièces si yield_unit est renseigné)' },
          yield_unit: { type: ['string', 'null'], description: 'null = personnes ; sinon « cookies », « pièces », « pots », « cake »…' },
          prep_minutes: { type: ['integer', 'null'] },
          cook_minutes: { type: ['integer', 'null'] },
          ingredients: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name'],
              properties: {
                quantity: { type: ['number', 'null'], description: 'null si non chiffré (« sel »)' },
                unit: { type: ['string', 'null'], description: `Une de : ${UNITS.join(', ')} ; null pour un nombre de pièces` },
                name: { type: 'string', description: 'Ingrédient au singulier, sans quantité ni préparation' },
                note: { type: ['string', 'null'], description: 'Préparation ou précision : « émincé », « facultatif »' },
                aisle: aisleNames.length
                  ? { type: ['string', 'null'], enum: [...aisleNames, null], description: 'Rayon du magasin' }
                  : { type: ['string', 'null'] },
              },
            },
          },
          steps: { type: 'array', items: { type: 'string' }, description: 'Étapes dans l\'ordre, sans numéro' },
          tags: { type: 'array', items: { type: 'string' }, description: '2 à 4 mots-clés en minuscules' },
          notes: { type: ['string', 'null'], description: 'Astuces, variantes' },
          rating: { type: ['integer', 'null'], minimum: 1, maximum: 5 },
          source_url: { type: ['string', 'null'], description: 'Lien d\'origine si la recette vient d\'une page web' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: 'search_recipes',
      title: 'Chercher dans le carnet',
      description:
        "Cherche des recettes dans le carnet familial par nom, ingrédient, tag ou note (sans tenir compte des accents ni des fautes légères). " +
        "Requête vide = liste toutes les recettes. Renvoie id, nom, catégorie, rendement et lien.",
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { query: { type: 'string', description: 'Ex. « poireau », « soupe », « végétarien ». Vide pour tout lister.' } },
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: 'add_to_week',
      title: 'Prévoir une recette dans la semaine',
      description:
        "Ajoute une recette du carnet (id obtenu avec search_recipes ou add_recipe) au menu d'une semaine. " +
        "Sans day : elle rejoint « Recettes de la semaine » (compte pour la liste de courses, sans jour précis). " +
        "Avec day (AAAA-MM-JJ) et meal : placée sur ce créneau. Pour un repas sans recette (« restes », « resto »), utilise free_text au lieu de recipe_id. " +
        `Aujourd'hui : voir get_week. Semaines du lundi au dimanche, fuseau Europe/Paris.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          recipe_id: { type: 'string' },
          free_text: { type: 'string', description: 'Repas sans recette, ex. « Restes », « Resto »' },
          week: { type: 'string', description: '« this » (défaut), « next », ou une date AAAA-MM-JJ de la semaine voulue. Ignoré si day est donné.' },
          day: { type: 'string', description: 'Date AAAA-MM-JJ du repas' },
          meal: { type: 'string', enum: ['midi', 'soir'], description: 'Défaut : soir' },
          servings: { type: 'integer', minimum: 1, description: 'Défaut : rendement de la recette' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: 'get_week',
      title: 'Voir le menu de la semaine',
      description: 'Renvoie le menu d\'une semaine : recettes sans jour précis et repas jour par jour (midi/soir), avec la date du jour.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { week: { type: 'string', description: '« this » (défaut), « next », ou une date AAAA-MM-JJ' } },
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: 'get_shopping_list',
      title: 'Voir la liste de courses',
      description: 'Renvoie la liste de courses d\'une semaine, calculée à partir du menu (quantités cumulées) plus les articles ajoutés à la main, rangée par rayon. Indique ce qui est déjà coché.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { week: { type: 'string', description: '« this » (défaut), « next », ou une date AAAA-MM-JJ' } },
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    {
      name: 'add_shopping_item',
      title: 'Ajouter un article à la liste de courses',
      description: 'Ajoute un ou plusieurs articles hors recettes à la liste de courses (lait, éponges…). Ils restent dans la liste jusqu\'à être cochés.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: {
          items: { type: 'array', items: { type: 'string' }, description: 'Ex. ["Lait", "Éponges", "Café"]' },
          week: { type: 'string', description: '« this » (défaut), « next », ou une date AAAA-MM-JJ' },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    {
      name: 'get_recipe',
      title: 'Lire une recette du carnet',
      description: 'Renvoie la fiche complète d\'une recette du carnet (ingrédients avec quantités, étapes, notes) à partir de son id (obtenu avec search_recipes).',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: { id: { type: 'string', description: 'id de la recette' } },
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
  ]
}

type IngredientIn = { quantity?: number | null; unit?: string | null; name: string; note?: string | null; aisle?: string | null }

async function addRecipe(ctx: Ctx, a: Record<string, unknown>) {
  const name = String(a.name ?? '').trim()
  if (!name) return text('Le nom de la recette est obligatoire.', true)
  const sourceUrl = typeof a.source_url === 'string' && /^https?:\/\//.test(a.source_url) ? a.source_url : null

  if (sourceUrl) {
    const { data: dup } = await ctx.db.from('recipes').select('id, name')
      .eq('household_id', ctx.householdId).eq('source_url', sourceUrl).limit(1).maybeSingle()
    if (dup) return text(`Cette recette est déjà dans le carnet : « ${dup.name} » — ${APP_URL}/recettes/${dup.id}`)
  }

  const category = CATEGORIES.includes(String(a.category)) ? String(a.category) : 'Plat'
  const seasons = Array.isArray(a.seasons) ? a.seasons.filter((s) => SEASONS.includes(String(s))) : []
  const rating = Number.isInteger(a.rating) && (a.rating as number) >= 1 && (a.rating as number) <= 5 ? a.rating : null
  const ingredients = (Array.isArray(a.ingredients) ? a.ingredients : []) as IngredientIn[]
  const strArr = (v: unknown) => (Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [])

  const { data: rec, error } = await ctx.db.from('recipes').insert({
    household_id: ctx.householdId,
    created_by: ctx.userId,
    name,
    category,
    seasons,
    rating,
    servings: Math.max(1, Math.round(Number(a.servings) || 4)),
    yield_unit: typeof a.yield_unit === 'string' && a.yield_unit.trim() ? a.yield_unit.trim().toLowerCase() : null,
    prep_minutes: Number.isFinite(a.prep_minutes) ? Math.round(a.prep_minutes as number) : null,
    cook_minutes: Number.isFinite(a.cook_minutes) ? Math.round(a.cook_minutes as number) : null,
    steps: strArr(a.steps).map((s) => s.replace(/^\d+[.)-]\s*/, '')),
    tags: strArr(a.tags).map((t) => t.replace(/^#/, '').toLowerCase()),
    notes: typeof a.notes === 'string' && a.notes.trim() ? a.notes.trim() : null,
    source_kind: 'claude',
    source_url: sourceUrl,
  }).select('id').single()
  if (error) return text(`Enregistrement impossible : ${error.message}`, true)

  // Ingrédients : réutilise ceux du foyer, crée les nouveaux avec leur rayon
  const clean = ingredients.filter((i) => i && typeof i.name === 'string' && i.name.trim())
  if (clean.length) {
    const [{ data: known }, { data: aisles }] = await Promise.all([
      ctx.db.from('ingredients').select('id, name').eq('household_id', ctx.householdId),
      ctx.db.from('aisles').select('id, name').eq('household_id', ctx.householdId),
    ])
    const byKey = new Map((known ?? []).map((k) => [ingKey(k.name), k.id as string]))
    const aisleByName = new Map((aisles ?? []).map((x) => [x.name as string, x.id as string]))
    const missing = new Map<string, IngredientIn>()
    for (const i of clean) if (!byKey.has(ingKey(i.name)) && !missing.has(ingKey(i.name))) missing.set(ingKey(i.name), i)
    if (missing.size) {
      const { data: created, error: insErr } = await ctx.db.from('ingredients').insert([...missing.values()].map((i) => ({
        household_id: ctx.householdId,
        name: capitalize(i.name.trim()),
        default_unit: i.unit || null,
        aisle_id: i.aisle ? aisleByName.get(i.aisle) ?? null : null,
      }))).select('id, name')
      if (insErr) {
        const { data: again } = await ctx.db.from('ingredients').select('id, name').eq('household_id', ctx.householdId)
        for (const k of again ?? []) byKey.set(ingKey(k.name), k.id)
      } else {
        for (const k of created ?? []) byKey.set(ingKey(k.name), k.id)
      }
    }
    const { error: riErr } = await ctx.db.from('recipe_ingredients').insert(clean.map((i, pos) => ({
      recipe_id: rec.id,
      ingredient_id: byKey.get(ingKey(i.name)),
      quantity: typeof i.quantity === 'number' && Number.isFinite(i.quantity) ? i.quantity : null,
      unit: i.unit || null,
      note: i.note?.trim() || null,
      position: pos,
    })).filter((r) => r.ingredient_id))
    if (riErr) return text(`Recette créée mais ingrédients non enregistrés : ${riErr.message} — ${APP_URL}/recettes/${rec.id}`, true)
  }

  const { data: sameName } = await ctx.db.from('recipes').select('id').eq('household_id', ctx.householdId)
    .ilike('name', name).neq('id', rec.id).limit(1)
  const warn = sameName?.length ? '\nAttention : une autre recette porte déjà ce nom dans le carnet.' : ''
  return text(`Recette « ${name} » ajoutée au carnet (${clean.length} ingrédients). Lien : ${APP_URL}/recettes/${rec.id}${warn}`)
}

async function searchRecipes(ctx: Ctx, a: Record<string, unknown>) {
  const q = typeof a.query === 'string' ? a.query.trim() : ''
  const { data, error } = q
    ? await ctx.db.rpc('search_recipes', { p_household: ctx.householdId, p_query: q })
    : await ctx.db.from('recipes').select('*').eq('household_id', ctx.householdId).order('name')
  if (error) return text(`Recherche impossible : ${error.message}`, true)
  const rows = (data ?? []).slice(0, 40) as { id: string; name: string; category: string; servings: number; yield_unit: string | null; tags: string[] }[]
  if (!rows.length) return text(q ? `Aucune recette ne correspond à « ${q} ».` : 'Le carnet est vide.')
  const lines = rows.map((r) => `- ${r.name} (${r.category}, pour ${r.servings} ${r.yield_unit ?? 'pers.'}) — id: ${r.id}`)
  return text(`${rows.length} recette(s)${q ? ` pour « ${q} »` : ''} :\n${lines.join('\n')}`)
}

async function getRecipe(ctx: Ctx, a: Record<string, unknown>) {
  const id = String(a.id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return text('id invalide : utilise search_recipes pour le trouver.', true)
  const { data: r } = await ctx.db.from('recipes')
    .select('*, recipe_ingredients(quantity, unit, note, position, ingredients(name))')
    .eq('household_id', ctx.householdId).eq('id', id).maybeSingle()
  if (!r) return text('Recette introuvable dans le carnet.', true)
  const ings = (r.recipe_ingredients as { quantity: number | null; unit: string | null; note: string | null; position: number; ingredients: { name: string } }[])
    .sort((x, y) => x.position - y.position)
    .map((i) => `- ${[fmtQty(i.quantity), i.unit, i.ingredients.name].filter(Boolean).join(' ')}${i.note ? `, ${i.note}` : ''}`)
  const times = [r.prep_minutes ? `préparation ${r.prep_minutes} min` : '', r.cook_minutes ? `cuisson ${r.cook_minutes} min` : ''].filter(Boolean).join(', ')
  return text([
    `# ${r.name}`,
    `${r.category} · pour ${r.servings} ${r.yield_unit ?? 'personnes'}${times ? ` · ${times}` : ''}${r.seasons.length ? ` · ${r.seasons.join(', ')}` : ''}`,
    '', '## Ingrédients', ...ings,
    '', '## Étapes', ...(r.steps as string[]).map((s, i) => `${i + 1}. ${s}`),
    ...(r.notes ? ['', '## Notes', r.notes] : []),
    '', `Lien : ${APP_URL}/recettes/${r.id}${r.source_url ? ` · Source : ${r.source_url}` : ''}`,
  ].join('\n'))
}

// ------------------------------------------------------------------ semaine (dates Europe/Paris, semaines du lundi)

const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
function addDaysISO(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function mondayOfISO(iso: string) {
  const dow = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
  return addDaysISO(iso, -dow)
}
function resolveWeek(week: unknown) {
  const today = parisToday()
  if (week === 'next') return mondayOfISO(addDaysISO(today, 7))
  if (isDate(week)) return mondayOfISO(week)
  return mondayOfISO(today)
}
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

async function addToWeek(ctx: Ctx, a: Record<string, unknown>) {
  const recipeId = typeof a.recipe_id === 'string' ? a.recipe_id : null
  const freeText = typeof a.free_text === 'string' && a.free_text.trim() ? a.free_text.trim() : null
  if (!recipeId && !freeText) return text('Donne recipe_id (recette du carnet) ou free_text.', true)
  let recipe: { id: string; name: string; servings: number; yield_unit: string | null } | null = null
  if (recipeId) {
    const { data } = await ctx.db.from('recipes').select('id, name, servings, yield_unit')
      .eq('household_id', ctx.householdId).eq('id', recipeId).maybeSingle()
    if (!data) return text('Recette introuvable dans le carnet : utilise search_recipes pour trouver son id.', true)
    recipe = data
  }
  const day = isDate(a.day) ? a.day : null
  const meal = day ? (a.meal === 'midi' ? 'midi' : 'soir') : null
  const weekStart = day ? mondayOfISO(day) : resolveWeek(a.week)
  const servings = Number.isInteger(a.servings) && (a.servings as number) > 0 ? a.servings as number : recipe?.servings ?? null
  const { error } = await ctx.db.from('week_items').insert({
    household_id: ctx.householdId, week_start: weekStart, recipe_id: recipe?.id ?? null, free_text: recipe ? null : freeText,
    day, meal, servings,
  })
  if (error) return text(`Ajout impossible : ${error.message}`, true)
  const label = recipe?.name ?? freeText
  const where = day
    ? `au ${meal} du ${DAY_NAMES[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7]} ${day}`
    : `aux recettes de la semaine du ${weekStart}`
  return text(`« ${label} » ajouté ${where}. Menu : ${APP_URL}/semaine?s=${weekStart}`)
}

async function getWeek(ctx: Ctx, a: Record<string, unknown>) {
  const start = resolveWeek(a.week)
  const { data, error } = await ctx.db.from('week_items')
    .select('day, meal, servings, free_text, recipe_id, recipes(name, servings, yield_unit)')
    .eq('household_id', ctx.householdId).eq('week_start', start).order('position').order('created_at')
  if (error) return text(`Lecture impossible : ${error.message}`, true)
  type Row = { day: string | null; meal: string | null; servings: number | null; free_text: string | null; recipe_id: string | null; recipes: { name: string; servings: number; yield_unit: string | null } | null }
  const rows = (data ?? []) as unknown as Row[]
  const label = (r: Row) => r.recipes
    ? `${r.recipes.name} (${r.servings ?? r.recipes.servings} ${r.recipes.yield_unit ?? 'pers.'}, id: ${r.recipe_id})`
    : r.free_text ?? '?'
  const lines = [`Semaine du lundi ${start} au dimanche ${addDaysISO(start, 6)} — aujourd'hui : ${parisToday()}`, '']
  const basket = rows.filter((r) => !r.day)
  lines.push('Recettes de la semaine (sans jour précis) :', ...(basket.length ? basket.map((r) => `- ${label(r)}`) : ['- (aucune)']), '')
  for (let i = 0; i < 7; i++) {
    const day = addDaysISO(start, i)
    const slot = (m: string) => rows.filter((r) => r.day === day && r.meal === m).map(label).join(' + ') || '—'
    lines.push(`${DAY_NAMES[i]} ${day} : midi ${slot('midi')} | soir ${slot('soir')}`)
  }
  lines.push('', `Menu : ${APP_URL}/semaine?s=${start}`)
  return text(lines.join('\n'))
}

// ------------------------------------------------------------------ courses

function fmtAmount(q: number | null, unit: string | null) {
  if (q == null) return ''
  if (unit === 'g') return q >= 1000 ? `${fmtQty(q / 1000)} kg` : `${fmtQty(q)} g`
  if (unit === 'ml') return q >= 1000 ? `${fmtQty(q / 1000)} l` : q >= 100 && q % 10 === 0 ? `${fmtQty(q / 10)} cl` : `${fmtQty(q)} ml`
  return [fmtQty(q), unit].filter(Boolean).join(' ')
}

async function getShoppingList(ctx: Ctx, a: Record<string, unknown>) {
  const week = resolveWeek(a.week)
  const { data: sync, error: syncErr } = await ctx.db.rpc('sync_shopping_list', {
    p_household: ctx.householdId, p_week: week, p_carry_manual: week === resolveWeek('this'),
  })
  if (syncErr) return text(`Calcul impossible : ${syncErr.message}`, true)
  const [{ data: items }, { data: aisles }] = await Promise.all([
    ctx.db.from('shopping_items').select('label, quantity, unit, aisle_id, sources, is_staple, hidden, checked, origin')
      .eq('household_id', ctx.householdId).eq('week_start', week).order('label'),
    ctx.db.from('aisles').select('id, name, position').eq('household_id', ctx.householdId).order('position'),
  ])
  type It = { label: string; quantity: number | null; unit: string | null; aisle_id: string | null; sources: string[]; is_staple: boolean; hidden: boolean; checked: boolean; origin: string }
  const list = ((items ?? []) as It[]).filter((i) => !i.hidden)
  if (!list.length) return text(`Liste vide pour la semaine du ${week} : ajoute des recettes au menu (add_to_week).`)
  const line = (i: It) => `- ${i.checked ? '[x] ' : ''}${i.label}${fmtAmount(i.quantity, i.unit) ? ` : ${fmtAmount(i.quantity, i.unit)}` : ''}${i.sources.length ? ` (${i.sources.join(', ')})` : ''}`
  const out = [`Liste de courses — semaine du ${week}`]
  for (const aisle of [...(aisles ?? []), { id: null, name: 'Sans rayon' }]) {
    const inAisle = list.filter((i) => !i.is_staple && (i.aisle_id ?? null) === aisle.id)
    if (inAisle.length) out.push('', `${aisle.name} :`, ...inAisle.map(line))
  }
  const staples = list.filter((i) => i.is_staple)
  if (staples.length) out.push('', 'Placard (à vérifier) :', ...staples.map(line))
  const missing = (sync?.missing ?? []) as string[]
  if (missing.length) out.push('', `Recettes sans ingrédients saisis (absentes de la liste) : ${missing.join(', ')}`)
  out.push('', `Liste : ${APP_URL}/courses${week === resolveWeek('this') ? '' : `?s=${week}`}`)
  return text(out.join('\n'))
}

async function addShoppingItem(ctx: Ctx, a: Record<string, unknown>) {
  const labels = (Array.isArray(a.items) ? a.items : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 50)
  if (!labels.length) return text('Aucun article à ajouter.', true)
  const week = resolveWeek(a.week)
  const [{ data: known }, { data: aisles }] = await Promise.all([
    ctx.db.from('ingredients').select('name, aisle_id').eq('household_id', ctx.householdId),
    ctx.db.from('aisles').select('id, name').eq('household_id', ctx.householdId),
  ])
  const aisleOf = new Map((known ?? []).map((k) => [ingKey(k.name), k.aisle_id as string | null]))
  const other = (aisles ?? []).find((x) => x.name === 'Autre')?.id ?? null
  const { error } = await ctx.db.from('shopping_items').insert(labels.map((l) => ({
    household_id: ctx.householdId, week_start: week, origin: 'manual', label: capitalize(l), aisle_id: aisleOf.get(ingKey(l)) ?? other,
  })))
  if (error) return text(`Ajout impossible : ${error.message}`, true)
  return text(`Ajouté à la liste de courses : ${labels.join(', ')}. Liste : ${APP_URL}/courses`)
}

// ------------------------------------------------------------------ JSON-RPC

async function handle(msg: RpcMessage, ctx: Ctx): Promise<unknown | null> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } })
  if (msg.id === undefined || msg.id === null) return null // notification : pas de réponse

  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '')
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'recettes', title: 'Recettes & Menus', version: '1.0.0' },
        instructions:
          "Carnet de recettes familial et menu de la semaine. Utilise add_recipe quand l'utilisateur veut garder une recette, " +
          "search_recipes puis get_recipe pour retrouver une recette existante, get_week pour voir le menu et add_to_week pour le remplir, get_shopping_list et add_shopping_item pour les courses. " +
          "Tout est en français.",
      })
    }
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: await toolDefinitions(ctx) })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      try {
        if (name === 'add_recipe') return reply(await addRecipe(ctx, args))
        if (name === 'search_recipes') return reply(await searchRecipes(ctx, args))
        if (name === 'get_recipe') return reply(await getRecipe(ctx, args))
        if (name === 'add_to_week') return reply(await addToWeek(ctx, args))
        if (name === 'get_week') return reply(await getWeek(ctx, args))
        if (name === 'get_shopping_list') return reply(await getShoppingList(ctx, args))
        if (name === 'add_shopping_item') return reply(await addShoppingItem(ctx, args))
        return fail(-32602, `Outil inconnu : ${name}`)
      } catch (e) {
        return reply(text(`Erreur : ${(e as Error).message}`, true))
      }
    }
    default:
      return fail(-32601, `Méthode non prise en charge : ${msg.method}`)
  }
}

Deno.serve(async (req) => {
  const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response('Not found', { status: 404 })

  const { data: tok } = await db.from('connector_tokens').select('id, household_id, user_id')
    .eq('token_hash', await sha256Hex(token)).maybeSingle()
  if (!tok) return new Response('Not found', { status: 404 })

  if (req.method === 'GET' || req.method === 'DELETE') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  void db.from('connector_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id).then(() => {})
  const ctx: Ctx = { db, householdId: tok.household_id, userId: tok.user_id }

  let body: RpcMessage | RpcMessage[]
  try { body = await req.json() } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 })
  }
  const messages = Array.isArray(body) ? body : [body]
  const results = (await Promise.all(messages.map((m) => handle(m, ctx)))).filter((r) => r !== null)
  if (!results.length) return new Response(null, { status: 202 })
  return Response.json(Array.isArray(body) ? results : results[0])
})
