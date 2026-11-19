import { supabase } from './supabase'

// File d'attente des modifications faites sans réseau (au magasin), rejouée au retour de la connexion.

type Op =
  | { kind: 'update'; table: string; id: string; patch: Record<string, unknown> }
  | { kind: 'insert'; table: string; row: Record<string, unknown> }
  | { kind: 'delete'; table: string; id: string }

const KEY = 'recettes.queue'

function readQueue(): Op[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Op[] } catch { return [] }
}
function writeQueue(q: Op[]) {
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* stockage indisponible */ }
  listeners.forEach((l) => l(q.length))
}

const listeners = new Set<(pending: number) => void>()
export function onQueueChange(fn: (pending: number) => void) {
  listeners.add(fn)
  fn(readQueue().length)
  return () => { listeners.delete(fn) }
}

function isNetworkError(message: string | undefined) {
  return !navigator.onLine || /fetch|network|load failed|timeout/i.test(message ?? '')
}

async function exec(op: Op) {
  const t = supabase.from(op.table)
  const { error } = op.kind === 'update' ? await t.update(op.patch).eq('id', op.id)
    : op.kind === 'insert' ? await t.insert(op.row)
    : await t.delete().eq('id', op.id)
  return error
}

/** Exécute tout de suite si possible ; sinon met en file d'attente. Renvoie false si mis en attente. */
export async function run(op: Op): Promise<boolean> {
  if (readQueue().length) { writeQueue([...readQueue(), op]); void flush(); return false } // garder l'ordre
  const error = await exec(op).catch((e: Error) => ({ message: e.message }))
  if (!error) return true
  if (isNetworkError(error.message)) { writeQueue([...readQueue(), op]); return false }
  throw new Error(error.message)
}

let current: Promise<void> | null = null
/** Rejoue la file ; si un envoi est déjà en cours, renvoie la même promesse (on peut l'attendre avant de recharger). */
export function flush(): Promise<void> {
  if (current) return current
  current = (async () => {
    let q = readQueue()
    while (q.length) {
      const error = await exec(q[0]).catch((e: Error) => ({ message: e.message }))
      if (error && isNetworkError(error.message)) break // toujours hors ligne
      // Erreur définitive (ex. article supprimé entre-temps) : on abandonne cette opération
      q = q.slice(1)
      writeQueue(q)
    }
  })().finally(() => { current = null })
  return current
}
export const pendingCount = () => readQueue().length

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush())
}

export function cacheGet<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null } catch { return null }
}
export function cacheSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* stockage plein ou bloqué */ }
}
