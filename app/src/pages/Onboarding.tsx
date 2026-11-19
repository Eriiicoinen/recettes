import { useState, type FormEvent } from 'react'
import { clearInvite, pendingInvite } from '../lib/launch'
import { addSampleRecipes } from '../lib/samples'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'

export default function Onboarding() {
  const { reloadHousehold, session } = useSession()
  // Arrivée par un lien d'invitation : on rejoint le foyer, code déjà rempli
  const [mode, setMode] = useState<'create' | 'join'>(() => (pendingInvite() ? 'join' : 'create'))
  const [samples, setSamples] = useState(true)
  const [displayName, setDisplayName] = useState('')
  const [householdName, setHouseholdName] = useState('Maison')
  const [code, setCode] = useState(() => pendingInvite() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { data, error } = mode === 'create'
      ? await supabase.rpc('create_household', { p_name: householdName.trim(), p_display_name: displayName.trim() })
      : await supabase.rpc('join_household', { p_code: code.trim(), p_display_name: displayName.trim() })
    if (error) { setBusy(false); setError(error.message); return }
    if (mode === 'join') clearInvite()
    if (mode === 'create' && samples && session && typeof data === 'string') {
      await addSampleRecipes(data, session.user.id).catch(() => { /* le foyer est créé ; les exemples sont un bonus */ })
    }
    setBusy(false)
    await reloadHousehold()
  }

  return (
    <main className="center-page">
      <h1>Bienvenue</h1>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>Créer le foyer</button>
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>Rejoindre</button>
      </div>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>Ton prénom</span>
          <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="given-name" />
        </label>
        {mode === 'create' ? (
          <label className="field">
            <span>Nom du foyer</span>
            <input required value={householdName} onChange={(e) => setHouseholdName(e.target.value)} />
          </label>
        ) : null}
        {mode === 'create' ? (
          <label className="toggle-row">
            <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} />
            <span>Ajouter 3 recettes d'exemple <span className="muted small">(carbonara, soupe d'hiver, raclette ; à supprimer quand tu veux)</span></span>
          </label>
        ) : (
          <label className="field">
            <span>Code d'invitation</span>
            <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="A1B2C3" className="code-input" autoCapitalize="characters" />
            <small className="muted">Visible dans Réglages sur l'autre téléphone (ou envoyé par lien).</small>
          </label>
        )}
        <button className="btn primary" disabled={busy}>{mode === 'create' ? 'Créer' : 'Rejoindre'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  )
}
