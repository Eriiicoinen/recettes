import { CookingPot } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// E-mail + mot de passe : aucun e-mail n'est envoyé (pas de limite d'envoi, pas de modèle à modifier),
// et la connexion se fait directement dans l'app installée, y compris sur iPhone.
// Nécessite "Confirm email" désactivé dans Supabase > Authentication > Sign In / Providers > Email.
export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setInfo('')
    const creds = { email: email.trim(), password }
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword(creds)
      if (error) setError(error.message === 'Invalid login credentials' ? 'E-mail ou mot de passe incorrect.' : error.message)
    } else {
      const { data, error } = await supabase.auth.signUp(creds)
      if (error) setError(error.message.includes('already registered') ? 'Ce compte existe déjà : connecte-toi.' : error.message)
      else if (!data.session) setInfo('Compte créé, mais Supabase demande une confirmation par e-mail. Désactive « Confirm email » dans Supabase puis connecte-toi.')
    }
    setBusy(false)
  }

  return (
    <main className="center-page">
      <div className="brand-mark" aria-hidden><CookingPot size={38} strokeWidth={1.8} /></div>
      <h1>Recettes &amp; Menus</h1>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>Se connecter</button>
        <button role="tab" aria-selected={mode === 'signup'} onClick={() => setMode('signup')}>Créer un compte</button>
      </div>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>E-mail</span>
          <input type="email" required autoComplete="email" inputMode="email"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.fr" />
        </label>
        <label className="field">
          <span>Mot de passe</span>
          <input type="password" required minLength={8}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === 'signup' && <small className="muted">8 caractères minimum.</small>}
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Se connecter' : 'Créer mon compte'}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {info && <p className="muted" role="status">{info}</p>}
    </main>
  )
}
