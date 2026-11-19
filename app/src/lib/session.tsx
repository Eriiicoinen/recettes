import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { clearQueue } from './offline'
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
      .select('household_id, user_id, display_name, households(id, name, invite_code, people)')
      .eq('user_id', uid)
      .order('joined_at')
      .limit(1)
      .maybeSingle()
    if (error) {
      // Hors ligne (au magasin) : on reprend le foyer mémorisé plutôt que d'afficher l'écran d'accueil
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { me: Member; household: Household } | null
        if (cached) { setMe(cached.me); setHousehold(cached.household) }
      } catch { /* pas de cache */ }
      return
    }
    if (m) {
      const { households, ...member } = m as unknown as Member & { households: Household }
      setMe(member)
      setHousehold(households)
      try { localStorage.setItem(cacheKey, JSON.stringify({ me: member, household: households })) } catch { /* stockage plein ou bloqué */ }
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
      if (event === 'SIGNED_OUT') clearQueue()
      setSession(s)
      void reloadHousehold()
    })
    return () => sub.subscription.unsubscribe()
  }, [reloadHousehold])

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
