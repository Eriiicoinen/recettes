import { formatQty } from './recipes'
import { supabase } from './supabase'

export type ShoppingItem = {
  id: string
  household_id: string
  week_start: string
  origin: 'menu' | 'manual'
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
