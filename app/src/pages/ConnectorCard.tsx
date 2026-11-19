import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Token = { id: string; label: string; created_at: string; last_used_at: string | null }

const MCP_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/mcp/`

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : 'jamais'
}

export default function ConnectorCard({ householdId }: { householdId: string }) {
  const [tokens, setTokens] = useState<Token[]>([])
  const [newUrl, setNewUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)

  const load = () =>
    supabase.from('connector_tokens').select('id, label, created_at, last_used_at')
      .eq('household_id', householdId).order('created_at')
      .then(({ data }) => setTokens(data ?? []))

  useEffect(() => { void load() }, [householdId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    setBusy(true)
    setError('')
    const { data, error } = await supabase.rpc('create_connector_token', { p_label: 'Claude' })
    setBusy(false)
    if (error) { setError(error.message); return }
    setNewUrl(MCP_BASE + data)
    void load()
  }

  async function copy() {
    if (!newUrl) return
    try {
      await navigator.clipboard.writeText(newUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* le lien reste sélectionnable */ }
  }

  async function revoke(id: string) {
    await supabase.from('connector_tokens').delete().eq('id', id)
    setConfirmRevoke(null)
    void load()
  }

  return (
    <div className="card stack">
      <h2>Connecteur Claude</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Permet de dire à Claude (claude.ai ou appli mobile) « ajoute cette recette à mon carnet ».
      </p>

      {newUrl ? (
        <div className="stack connector-new">
          <strong>Ton lien de connecteur</strong>
          <textarea readOnly rows={3} value={newUrl} onFocus={(e) => e.target.select()} className="mono" />
          <button className="btn primary" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le lien'}</button>
          <p className="small" style={{ margin: 0 }}>
            ⚠️ Il ne sera plus affiché. Garde-le pour toi : il donne accès au carnet.
          </p>
          <ol className="small connector-steps">
            <li>Sur ordinateur, ouvre <strong>claude.ai</strong> → <strong>Paramètres → Connecteurs</strong>.</li>
            <li><strong>Ajouter un connecteur personnalisé</strong> : nom « Recettes », URL = ce lien. Pas d'OAuth.</li>
            <li>Dans une conversation, active « Recettes » dans le menu des outils (+). Ça marche aussi dans l'appli mobile.</li>
          </ol>
          <button className="btn ghost" onClick={() => setNewUrl(null)}>Terminé</button>
        </div>
      ) : (
        <button className="btn" onClick={create} disabled={busy}>{busy ? '…' : tokens.length ? 'Créer un nouveau lien' : 'Créer le lien du connecteur'}</button>
      )}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

      {tokens.length > 0 && (
        <ul className="plain">
          {tokens.map((t) => (
            <li key={t.id} className="row between small">
              <span>{t.label} · créé le {fmt(t.created_at)} · utilisé {fmt(t.last_used_at)}</span>
              {confirmRevoke === t.id ? (
                <span className="row" style={{ gap: 4 }}>
                  <button className="btn small-btn" onClick={() => setConfirmRevoke(null)}>Non</button>
                  <button className="btn small-btn danger-solid" onClick={() => revoke(t.id)}>Révoquer</button>
                </span>
              ) : (
                <button className="btn ghost small-btn danger" onClick={() => setConfirmRevoke(t.id)}>Révoquer</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
