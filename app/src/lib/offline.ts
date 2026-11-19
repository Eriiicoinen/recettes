import { supabase } from './supabase'

// File d'attente des modifications faites sans réseau (au magasin), rejouée au retour de la connexion.
// Chaque modification passe par la file (mémorisée avant l'envoi) et les envois se font un par un, dans l'ordre.

type Op = (
  | { kind: 'update'; table: string; id: string; patch: Record<string, unknown> }
  | { kind: 'insert'; table: string; row: Record<string, unknown> }
  | { kind: 'delete'; table: string; id: string }
) & { qid?: string }

const KEY = 'recettes.queue'

// Copie en mémoire : la file fonctionne même si le stockage local est indisponible
let queue: Op[] = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Op[] } catch { return [] }
})()

function writeQueue(q: Op[]) {
  queue = q
  try { localStorage.setItem(KEY, JSON.stringify(q)) } catch { /* stockage indisponible */ }
  listeners.forEach((l) => l(q.length))
}

const listeners = new Set<(pending: number) => void>()
export function onQueueChange(fn: (pending: number) => void) {
  listeners.add(fn)
  fn(queue.length)
  return () => { listeners.delete(fn) }
}

type ExecError = { message: string; status?: number }

/** Réseau absent, serveur indisponible ou session à rafraîchir : on réessaiera plus tard. */
function isRetriable(error: ExecError) {
  return !navigator.onLine || /fetch|network|load failed|timeout/i.test(error.message)
    || (error.status ?? 0) >= 500 || error.status === 401
}

async function exec(op: Op): Promise<ExecError | null> {
  try {
    const t = supabase.from(op.table)
    const { error, status } = op.kind === 'update' ? await t.update(op.patch).eq('id', op.id)
      : op.kind === 'insert' ? await t.insert(op.row)
      : await t.delete().eq('id', op.id)
    return error ? { message: error.message, status } : null
  } catch (e) {
    return { message: (e as Error).message }
  }
}

const waiting = new Set<string>()
const failures = new Map<string, string>()

async function drain() {
  for (;;) {
    const op = queue[0]
    if (!op || !navigator.onLine) return
    const error = await exec(op)
    if (error && isRetriable(error)) return // toujours hors ligne : on réessaiera
    // Erreur définitive (ex. article supprimé entre-temps) : on abandonne cette opération
    if (error && op.qid && waiting.has(op.qid)) failures.set(op.qid, error.message)
    writeQueue(queue.filter((o) => o !== op))
  }
}

let tail: Promise<void> = Promise.resolve()
/** Rejoue la file (un seul envoi à la fois) ; la promesse se résout quand ce passage est terminé. */
export function flush(): Promise<void> {
  tail = tail.then(drain)
  return tail
}

/** Envoie tout de suite si possible ; sinon laisse en file d'attente. Renvoie false si mis en attente. */
export async function run(op: Op): Promise<boolean> {
  const qid = crypto.randomUUID()
  waiting.add(qid)
  try {
    writeQueue([...queue, { ...op, qid }])
    await flush()
    if (queue.some((o) => o.qid === qid)) return false
    const message = failures.get(qid)
    if (message !== undefined) throw new Error(message)
    return true
  } finally {
    waiting.delete(qid)
    failures.delete(qid)
  }
}
export const pendingCount = () => queue.length

/** À la déconnexion : les modifications en attente appartiennent à l'utilisateur qui part. */
export function clearQueue() {
  writeQueue([])
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flush())
}

export function cacheGet<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null } catch { return null }
}
export function cacheSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* stockage plein ou bloqué */ }
}

/** Supprime toutes les données mémorisées sur ce téléphone (à la déconnexion). */
export function clearCaches() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('recettes.')) localStorage.removeItem(k)
  } catch { /* stockage indisponible */ }
}
