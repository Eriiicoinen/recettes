import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearCaches, clearQueue } from './offline'
import { listStoredPeriods, setStoredPeriods, setWeekStartDow } from './week'
import type { StoredPeriod } from '../../../supabase/functions/_shared/period.ts'
import { supabase, type Household, type Member } from './supabase'

type Ctx = {
  session: Session | null
  household: Household | null
  me: Member | null
  loading: boolean
  reloadHousehold: () => Promise<void>
}

const SessionContext = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [me, setMe] = useState<Member | null>(null)
  const [loading, setLoading] = useState(true)

  const reloadHousehold = useCallback(async () => {
    const { data: auth } = await supabase.auth.getSession()
    const uid = auth.session?.user.id
    if (!uid) {
      setHousehold(null)
      setMe(null)
      return
    }
    const cacheKey = `recettes.household.${uid}`
    const { data: m, error } = await supabase
      .from('household_members')
      .select('household_id, user_id, display_name, households(id, name, invite_code, people, week_start_dow)')
      .eq('user_id', uid)
      .order('joined_at')
      .limit(1)
      .maybeSingle()
    if (error) {
      // Hors ligne (au magasin) : on reprend le foyer mémorisé plutôt que d'afficher l'écran d'accueil
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { me: Member; household: Household; periods?: StoredPeriod[] } | null
        if (cached) {
          setWeekStartDow(cached.household.week_start_dow)
          setStoredPeriods(cached.periods ?? [])
          setMe(cached.me)
          setHousehold(cached.household)
        }
      } catch { /* pas de cache */ }
      return
    }
    if (m) {
      const { households, ...member } = m as unknown as Member & { households: Household }
      const periods = await listStoredPeriods(households.id).catch(() => [])
      setWeekStartDow(households.week_start_dow)
      setStoredPeriods(periods)
      setMe(member)
      // Nouvel objet : les écrans recalculent leurs périodes même si le foyer n'a pas changé
      setHousehold({ ...households })
      try { localStorage.setItem(cacheKey, JSON.stringify({ me: member, household: households, periods })) } catch { /* stockage plein ou bloqué */ }
    } else {
      setMe(null)
      setHousehold(null)
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await reloadHousehold()
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // File hors ligne propre à chaque utilisateur : vidée à la déconnexion
      if (event === 'SIGNED_OUT') { clearQueue(); clearCaches() }
      setSession(s)
      void reloadHousehold()
    })
    return () => sub.subscription.unsubscribe()
  }, [reloadHousehold])

  // Période modifiée sur l'autre téléphone (ou début de semaine) : nouvelle découpe
  useEffect(() => {
    if (!household?.id) return
    const ch = supabase.channel(`periods-${household.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'periods', filter: `household_id=eq.${household.id}` }, () => void reloadHousehold())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'periods' }, () => void reloadHousehold())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${household.id}` }, () => void reloadHousehold())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [household?.id, reloadHousehold])

  return (
    <SessionContext.Provider value={{ session, household, me, loading, reloadHousehold }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession outside SessionProvider')
  return ctx
}
