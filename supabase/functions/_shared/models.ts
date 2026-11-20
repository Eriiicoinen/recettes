// Modèles Claude utilisés par les fonctions. Modifiables sans redéployer via les secrets Supabase
// CLAUDE_MODEL (structuration, idées, adaptations) et CLAUDE_FETCH_MODEL (lecture de page par web_fetch).
// Haiku 5.5 : le moins cher (~0,10 $ / 0,50 $ par million de tokens), suffisant pour extraire et structurer une recette.
export const MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-haiku-5-5'
// web_fetch_20260209 est documenté pour Sonnet 5.5 (pas pour Haiku 5.5) : repli rare, sites anti-robots seulement
export const FETCH_MODEL = Deno.env.get('CLAUDE_FETCH_MODEL') || 'claude-sonnet-5-5'
