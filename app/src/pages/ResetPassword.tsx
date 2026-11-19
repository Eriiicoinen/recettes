import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { endRecovery } from '../lib/launch'
import { supabase } from '../lib/supabase'

/** Arrivée par le lien « mot de passe oublié » : choix du nouveau mot de passe. */
export default function ResetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Les deux mots de passe ne sont pas identiques.'); return }
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(error.message); return }
    endRecovery()
    onDone()
  }

  return (
    <main className="center-page">
      <div className="brand-mark" aria-hidden><KeyRound size={34} strokeWidth={1.8} /></div>
      <h1>Nouveau mot de passe</h1>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Nouveau mot de passe</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <small className="muted">8 caractères minimum.</small>
        </label>
        <label className="field">
          <span>Encore une fois</span>
          <input type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        <button className="btn primary" disabled={busy}>{busy ? '…' : 'Enregistrer'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="muted small">Sur iPhone, l'app installée a sa propre connexion : ouvre-la ensuite et connecte-toi avec ce nouveau mot de passe.</p>
    </main>
  )
}
