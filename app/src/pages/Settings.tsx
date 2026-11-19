import { useEffect, useState } from 'react'
import { useSession } from '../lib/session'
import { supabase, type Member } from '../lib/supabase'
import ConnectorCard from './ConnectorCard'

export default function Settings() {
  const { household, me, session } = useSession()
  const [members, setMembers] = useState<Member[]>([])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!household) return
    const load = () =>
      supabase.from('household_members').select('household_id, user_id, display_name')
        .eq('household_id', household.id).order('joined_at')
        .then(({ data }) => setMembers(data ?? []))
    void load()
    // Démonstration du temps réel : l'autre téléphone apparaît dès qu'il rejoint
    const ch = supabase.channel('members')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${household.id}` }, load)
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [household])

  if (!household) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(household!.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* presse-papiers indisponible : le code reste lisible */ }
  }

  return (
    <section className="page">
      <h1>Réglages</h1>

      <div className="card stack">
        <h2>{household.name}</h2>
        <div className="row between">
          <div>
            <div className="muted small">Code d'invitation</div>
            <div className="invite-code">{household.invite_code}</div>
          </div>
          <button className="btn" onClick={copy}>{copied ? 'Copié ✓' : 'Copier'}</button>
        </div>
        <div>
          <div className="muted small">Membres</div>
          <ul className="plain">
            {members.map((m) => (
              <li key={m.user_id}>{m.display_name}{m.user_id === me?.user_id && <span className="muted"> (toi)</span>}</li>
            ))}
          </ul>
        </div>
      </div>

      <ConnectorCard householdId={household.id} />

      <div className="card stack">
        <div className="muted small">Connecté en tant que</div>
        <div>{session?.user.email}</div>
        <button className="btn ghost danger" onClick={() => supabase.auth.signOut()}>Se déconnecter</button>
      </div>
    </section>
  )
}
