// Extraction du contenu d'une page de recette. Pur TypeScript (aucune API Deno) : testable avec Node.

export type PageContent = {
  /** Données schema.org Recipe trouvées dans la page (JSON-LD), ou null */
  jsonLd: Record<string, unknown> | null
  /** Texte visible de la page, utilisé quand il n'y a pas de données structurées */
  text: string
  title: string | null
  image: string | null
}

const MAX_TEXT = 60_000

/** Page de vérification anti-robots (Cloudflare, Overblog, captcha…) au lieu du contenu. */
export function isBotChallenge(html: string): boolean {
  return /confirm that you are human|security check|just a moment\.\.\.|cf-chl-|captcha|anti-bot protection|vérification de sécurité/i
    .test(html.slice(0, 20_000))
}

export function extractFromHtml(html: string): PageContent {
  return {
    jsonLd: findRecipeJsonLd(html),
    text: htmlToText(html),
    title: meta(html, 'og:title') ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
    image: meta(html, 'og:image'),
  }
}

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, 'i')
  const tag = html.match(re)?.[0]
  return tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? null
}

function isRecipe(node: unknown): node is Record<string, unknown> {
  if (!node || typeof node !== 'object') return false
  const t = (node as Record<string, unknown>)['@type']
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))
}

function findIn(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || !node || typeof node !== 'object') return null
  if (isRecipe(node)) return node
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findIn(n, depth + 1)
      if (r) return r
    }
    return null
  }
  const obj = node as Record<string, unknown>
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const r = findIn(obj[key], depth + 1)
    if (r) return r
  }
  return null
}

export function findRecipeJsonLd(html: string): Record<string, unknown> | null {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const [, raw] of scripts) {
    try {
      const found = findIn(JSON.parse(raw.trim()))
      if (found) return prune(found) as Record<string, unknown>
    } catch {
      // JSON-LD mal formé : on essaie le bloc suivant
    }
  }
  return null
}

/** Retire ce qui ne sert pas à la recette (avis, auteur, vidéo…) pour réduire la taille envoyée à Claude. */
function prune(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(prune)
  if (!node || typeof node !== 'object') return node
  const drop = new Set(['review', 'aggregateRating', 'author', 'publisher', 'video', 'image', 'thumbnailUrl',
    'interactionStatistic', 'potentialAction', 'nutrition', '@context', 'datePublished', 'dateModified'])
  return Object.fromEntries(Object.entries(node as Record<string, unknown>)
    .filter(([k]) => !drop.has(k)).map(([k, v]) => [k, prune(v)]))
}

export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/li|\/h\d|\/div|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text
}
