import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

type Sub = { table: string; filter?: string }

/**
 * S'abonne aux changements de tables et appelle onChange(table) à chaque événement.
 * Les suppressions ne peuvent pas être filtrées côté temps réel : pour chaque table filtrée,
 * les DELETE sont aussi écoutés sans filtre (onChange décide quoi faire, en général recharger).
 * Le canal est recréé quand `key` change ; onChange peut changer à chaque rendu sans réabonnement.
 */
export function useRealtime(key: string | null, subs: Sub[], onChange: (table: string) => void) {
  const cb = useRef(onChange)
  cb.current = onChange
  const spec = JSON.stringify(subs)

  useEffect(() => {
    if (!key) return
    let ch = supabase.channel(`${key}-${Math.random().toString(36).slice(2, 8)}`)
    for (const s of JSON.parse(spec) as Sub[]) {
      const notify = () => cb.current(s.table)
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) }, notify)
      if (s.filter) ch = ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: s.table }, notify)
    }
    ch.subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [key, spec])
}
