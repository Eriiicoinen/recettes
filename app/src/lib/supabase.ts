import { createClient } from '@supabase/supabase-js'

const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined

export const configMissing = !url || !key

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'implicit' },
})

export type Household = { id: string; name: string; invite_code: string; people: number }
export type Member = { household_id: string; user_id: string; display_name: string }
