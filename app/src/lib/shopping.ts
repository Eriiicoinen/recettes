import { formatQty } from './recipes'
import { supabase } from './supabase'

export type ShoppingItem = {
  id: string
  household_id: string
  week_start: string
  origin: 'menu' | 'manual' | 'recurring'
  recurring_id: string | null
  ingredient_id: string | null
  label: string
  quantity: number | null
  unit: string | null
  aisle_id: string | null
  sources: string[]
  is_staple: boolean
  hidden: boolean
  checked: boolean
  checked_by: string | null
  checked_at: string | null
  created_at: string
}

export async function syncList(householdId: string, week: string, carryManual: boolean): Promise<string[]> {
  const { data, error } = await supabase.rpc('sync_shopping_list', { p_household: householdId, p_week: week, p_carry_manual: carryManual })
  if (error) throw error
  return (data?.missing ?? []) as string[]
}

export async function listItems(householdId: string, week: string): Promise<ShoppingItem[]> {
  const { data, error } = await supabase.from('shopping_items').select('*')
    .eq('household_id', householdId).eq('week_start', week).order('label')
  if (error) throw error
  return data as ShoppingItem[]
}

/** Quantités stockées en g et ml : 1500 g → « 1,5 kg », 250 ml → « 25 cl » */
export function formatAmount(q: number | null, unit: string | null): string {
  if (q == null) return ''
  // Pour acheter, on arrondit au-dessus : 66,7 g → 70 g
  if ((unit === 'g' || unit === 'ml') && q < 1000) q = q < 20 ? Math.ceil(q) : Math.ceil(q / 5 - 1e-9) * 5
  if (unit === 'g') return q >= 1000 ? `${formatQty(q / 1000)} kg` : `${formatQty(q)} g`
  if (unit === 'ml') {
    if (q >= 1000) return `${formatQty(q / 1000)} l`
    if (q >= 100 && q % 10 === 0) return `${formatQty(q / 10)} cl`
    return `${formatQty(q)} ml`
  }
  return [formatQty(q), unit].filter(Boolean).join(' ')
}

// ------------------------------------------------------------------ articles de chaque semaine

export type RecurringItem = { id: string; household_id: string; label: string; aisle_id: string | null }

export async function listRecurring(householdId: string): Promise<RecurringItem[]> {
  const { data, error } = await supabase.from('recurring_items').select('id, household_id, label, aisle_id')
    .eq('household_id', householdId).order('label')
  if (error) throw error
  return data as RecurringItem[]
}

export async function addRecurring(householdId: string, label: string, aisleId: string | null): Promise<RecurringItem> {
  const { data, error } = await supabase.from('recurring_items').insert({ household_id: householdId, label, aisle_id: aisleId })
    .select('id, household_id, label, aisle_id').single()
  if (error) {
    if (error.code === '23505') throw new Error(`« ${label} » est déjà dans les articles de chaque semaine.`)
    throw error
  }
  return data as RecurringItem
}

/** Supprime l'article régulier ; il disparaît aussi des listes où il a été ajouté. */
export async function removeRecurring(id: string) {
  const { error } = await supabase.from('recurring_items').delete().eq('id', id)
  if (error) throw error
}

// ------------------------------------------------------------------ conditionnements

export const PACK_LABELS = ['paquet', 'boîte', 'bouteille', 'brique', 'sachet', 'pot', 'barquette', 'filet', 'botte', 'tranche', 'lot']

/** Unité de la ligne ramenée à celle du stockage : g, ml, ou '' (pièces). */
export const unitKey = (unit: string | null) => unit ?? ''

type Pack = { pack_size: number | null; pack_unit: string | null; pack_label: string | null }

/** « 2 paquets de 150 g » pour 260 g, si l'ingrédient a un conditionnement dans la même unité ; sinon null. */
export function packAmount(q: number | null, unit: string | null, pack: Pack | undefined): string | null {
  if (q == null || !pack?.pack_size || (pack.pack_unit ?? '') !== unitKey(unit)) return null
  const n = Math.max(1, Math.ceil(q / pack.pack_size - 1e-9))
  const label = pack.pack_label || 'paquet'
  const plural = n > 1 && !/[sx]$/.test(label) ? `${label}s` : label
  return `${n} ${plural} de ${formatAmount(pack.pack_size, unit) || pack.pack_size}`
}

/** Liste en texte simple, par rayon, pour WhatsApp, SMS ou les notes. */
export function listText(week: string, groups: { name: string; list: ShoppingItem[] }[], staples: ShoppingItem[],
  amount: (i: ShoppingItem) => string = (i) => formatAmount(i.quantity, i.unit)) {
  const d = new Date(`${week}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  const line = (i: ShoppingItem) => `- ${i.label}${amount(i) ? ` : ${amount(i)}` : ''}`
  const parts = [`🛒 Courses (semaine du ${d})`]
  for (const g of groups) parts.push(`\n${g.name}\n${g.list.map(line).join('\n')}`)
  if (staples.length) parts.push(`\nÀ vérifier au placard\n${staples.map(line).join('\n')}`)
  return parts.join('\n')
}
