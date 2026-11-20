import { ingKey } from './recipes'
import { supabase } from './supabase'

// Mode drive : chaque article ouvre la recherche Intermarché, ou directement le produit habituel s'il est retenu.
export const STORE_NAME = 'Intermarché'

export type StoreProduct = { item_key: string; url: string; title: string | null }

/** Recherche sur le site du magasin (le magasin choisi sur le site s'applique). */
export const searchUrl = (label: string) => `https://www.intermarche.com/recherche/${encodeURIComponent(label.trim().toLowerCase())}`

/** Clé commune à « Œufs », « oeuf », « Oeuf » : un seul produit retenu. */
export const itemKey = (label: string) => ingKey(label)

/**
 * Valide un lien collé (souvent un texte de partage « Regarde ce produit : https://… ») et en tire le nom du produit.
 * Seuls les liens produit Intermarché sont acceptés.
 */
export function parseProductLink(input: string): { url: string; title: string | null } | null {
  const raw = input.match(/https?:\/\/\S+/)?.[0]
  if (!raw) return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:' || !/(^|\.)intermarche\.com$/.test(u.hostname) || !u.pathname.startsWith('/produit/')) return null
  const slug = u.pathname.split('/')[2] ?? ''
  const title = slug ? decodeURIComponent(slug).replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : null
  return { url: `https://www.intermarche.com${u.pathname}`, title }
}

export async function listStoreProducts(householdId: string): Promise<Map<string, StoreProduct>> {
  const { data, error } = await supabase.from('store_products').select('item_key, url, title').eq('household_id', householdId)
  if (error) throw error
  return new Map((data as StoreProduct[]).map((p) => [p.item_key, p]))
}

export async function saveStoreProduct(householdId: string, label: string, url: string, title: string | null) {
  const { error } = await supabase.from('store_products').upsert(
    { household_id: householdId, item_key: itemKey(label), url, title, updated_at: new Date().toISOString() },
    { onConflict: 'household_id,item_key' },
  )
  if (error) throw error
}

export async function forgetStoreProduct(householdId: string, label: string) {
  const { error } = await supabase.from('store_products').delete().eq('household_id', householdId).eq('item_key', itemKey(label))
  if (error) throw error
}
