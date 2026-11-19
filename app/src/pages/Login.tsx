import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// Code à 6 chiffres par e-mail plutôt qu'un lien magique :
// sur iPhone, un lien s'ouvre dans Safari et pas dans l'app installée.
export default function Login() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } })
    setBusy(false)
    if (error) setError(error.message)
    else setStep('code')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError('Code incorrect ou expiré.')
  }

  return (
    <main className="center-page">
      <div className="brand-mark" aria-hidden>🍲</div>
      <h1>Recettes &amp; Menus</h1>
      {step === 'email' ? (
        <form onSubmit={sendCode} className="stack">
          <label className="field">
            <span>Ton e-mail</span>
            <input type="email" required autoComplete="email" inputMode="email"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom@exemple.fr" />
          </label>
          <button className="btn primary" disabled={busy}>{busy ? 'Envoi…' : 'Recevoir un code'}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="stack">
          <p className="muted">Code envoyé à <strong>{email}</strong>. Il peut mettre une minute à arriver.</p>
          <label className="field">
            <span>Code reçu</span>
            <input required inputMode="numeric" autoComplete="one-time-code" maxLength={10}
              value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="code-input" />
          </label>
          <button className="btn primary" disabled={busy}>{busy ? 'Vérification…' : 'Se connecter'}</button>
          <button type="button" className="btn ghost" onClick={() => { setStep('email'); setCode('') }}>Changer d'e-mail</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  )
}
