import { useEffect, useState } from 'react'
import { disablePush, enablePush, pushState, testPush, type PushState } from '../lib/push'

/** Rappel du dimanche soir quand le menu de la semaine suivante est vide (par téléphone). */
export default function NotificationsCard({ householdId, userId }: { householdId: string; userId: string }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => { void pushState().then(setState).catch(() => setState('unsupported')) }, [])

  async function act(fn: () => Promise<void>, ok: string) {
    setBusy(true)
    setMsg('')
    try { await fn(); setMsg(ok) } catch (e) { setMsg((e as Error).message) }
    setState(await pushState().catch(() => 'unsupported' as const))
    setBusy(false)
  }

  return (
    <div className="card stack">
      <h2>🔔 Rappel du dimanche</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Le dimanche soir, une notification si le menu de la semaine suivante est vide ou presque. À activer sur chaque téléphone.
      </p>
      {state === null ? <p className="muted small">…</p>
        : state === 'install-first' ? (
          <p className="small" style={{ margin: 0 }}>Sur iPhone, installe d'abord l'app : bouton Partager de Safari → « Sur l'écran d'accueil », puis ouvre-la depuis l'icône.</p>
        ) : state === 'unsupported' ? (
          <p className="small" style={{ margin: 0 }}>Ce navigateur ne gère pas les notifications.</p>
        ) : state === 'denied' ? (
          <p className="small" style={{ margin: 0 }}>Notifications bloquées pour cette app : autorise-les dans les réglages du téléphone.</p>
        ) : state === 'on' ? (
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="ok">✓ Activé sur ce téléphone</span>
            <button className="btn small-btn" disabled={busy} onClick={() => act(testPush, 'Notification de test envoyée.')}>Tester</button>
            <button className="btn ghost small-btn" disabled={busy} onClick={() => act(disablePush, 'Désactivé.')}>Désactiver</button>
          </div>
        ) : (
          <button className="btn primary" disabled={busy} onClick={() => act(() => enablePush(householdId, userId), 'Activé ✓')}>Activer sur ce téléphone</button>
        )}
      {msg && <p className="muted small" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  )
}
