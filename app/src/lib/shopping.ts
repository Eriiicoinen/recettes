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

/** Liste en texte simple, par rayon, pour WhatsApp, SMS ou les notes. */
export function listText(week: string, groups: { name: string; list: ShoppingItem[] }[], staples: ShoppingItem[]) {
  const d = new Date(`${week}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  const line = (i: ShoppingItem) => `- ${i.label}${formatAmount(i.quantity, i.unit) ? ` : ${formatAmount(i.quantity, i.unit)}` : ''}`
  const parts = [`🛒 Courses (semaine du ${d})`]
  for (const g of groups) parts.push(`\n${g.name}\n${g.list.map(line).join('\n')}`)
  if (staples.length) parts.push(`\nÀ vérifier au placard\n${staples.map(line).join('\n')}`)
  return parts.join('\n')
}
