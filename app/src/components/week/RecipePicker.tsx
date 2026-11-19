import { useEffect, useState } from 'react'
import { createSimpleMeal } from '../../lib/meals'
import { getRecipe, listAisles, listRecipes, norm, type Recipe } from '../../lib/recipes'
import { useSession } from '../../lib/session'
import type { WeekItem } from '../../lib/week'
import Sheet from '../Sheet'

/** Choix de ce qu'on mange dans un créneau : recette du carnet, du panier, repas sans recette ou texte libre. */
const QUICK = [['🚫', 'Absents'], ['🍽', 'Resto'], ['🥡', 'Restes'], ['🥪', 'Sur le pouce']] as const

export default function RecipePicker({ title, householdId, people, basket, basketName, onPickRecipe, onPickBasket, onFreeText, onClose }: {
  title: string; householdId: string; people: number; basket: WeekItem[]; basketName: (i: WeekItem) => string
  onPickRecipe: (r: Recipe) => void; onPickBasket: (i: WeekItem) => void; onFreeText: (t: string) => void; onClose: () => void
}) {
  const { session } = useSession()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Recipe[] | null>(null)
  const [free, setFree] = useState('')
  const [simple, setSimple] = useState<{ name: string; lines: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [simpleError, setSimpleError] = useState('')

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      listRecipes(householdId, q).then((r) => { if (!cancelled) setResults(r) }).catch(() => {})
    }, q ? 200 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, householdId])

  async function saveSimple() {
    if (!simple || !simple.name.trim() || !session) return
    setSaving(true)
    setSimpleError('')
    try {
      const aisles = await listAisles(householdId)
      const id = await createSimpleMeal(householdId, session.user.id, simple.name, people, simple.lines, aisles)
      const r = await getRecipe(id)
      if (r) onPickRecipe(r.recipe)
    } catch (e) {
      setSimpleError((e as Error).message)
      setSaving(false)
    }
  }

  if (simple) {
    return (
      <Sheet title="Repas sans recette" onClose={onClose}>
        <div className="stack">
          <label className="field">
            <span>Nom</span>
            <input value={simple.name} onChange={(e) => setSimple({ ...simple, name: e.target.value })} placeholder="Raclette, fondue, apéro…" autoFocus />
          </label>
          <label className="field">
            <span>À acheter pour {people} personne{people > 1 ? 's' : ''} <small className="muted">(une ligne par article)</small></span>
            <textarea rows={7} value={simple.lines} onChange={(e) => setSimple({ ...simple, lines: e.target.value })}
              placeholder={'800 g de fromage à raclette\n1 kg de pommes de terre\n400 g de charcuterie\nCornichons'} />
          </label>
          <p className="muted small" style={{ margin: 0 }}>
            Gardé dans ton carnet (filtre « 🧺 Sans recette ») pour la prochaine fois. Les quantités s'adaptent aux invités.
          </p>
          {simpleError && <p className="error" style={{ margin: 0 }}>{simpleError}</p>}
          <div className="row between">
            <button className="btn ghost" onClick={() => setSimple(null)} disabled={saving}>Retour</button>
            <button className="btn primary" onClick={saveSimple} disabled={saving || !simple.name.trim()}>
              {saving ? 'Enregistrement…' : 'Ajouter au menu'}
            </button>
          </div>
        </div>
      </Sheet>
    )
  }


  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        {basket.length > 0 && !q && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="muted small">Depuis les recettes de la semaine</div>
            {basket.map((i) => (
              <button key={i.id} className="pick-row accent" onClick={() => onPickBasket(i)}>{basketName(i)}</button>
            ))}
          </div>
        )}
        <div className="search">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher une recette…" aria-label="Chercher une recette" />
        </div>
        <div className="pick-list">
          {results === null ? <p className="muted">Chargement…</p> : results.length === 0 ? (
            <p className="muted small">{q ? 'Aucune recette.' : 'Ton carnet est vide.'}</p>
          ) : results.slice(0, 50).map((r) => (
            <button key={r.id} className="pick-row" onClick={() => onPickRecipe(r)}>
              <span>{r.name}</span>
              <span className="muted small">{r.category}</span>
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setSimple({ name: q.trim(), lines: '' })}>🧺 Repas sans recette (raclette, fondue…)</button>
        <div className="row wrap" style={{ gap: 6 }}>
          {QUICK.map(([icon, label]) => (
            <button key={label} className="chip" onClick={() => onFreeText(label)}>{icon} {label}</button>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (free.trim()) onFreeText(free.trim()) }}>
          <input style={{ flex: 1, minWidth: 0 }} value={free} onChange={(e) => setFree(e.target.value)}
            placeholder="Ou autre chose : restes, resto…" aria-label="Texte libre" />
          <button className="btn" disabled={!free.trim()}>OK</button>
        </form>
        {q && norm(q).length > 0 && results?.length === 0 && (
          <button className="btn ghost small-btn" onClick={() => onFreeText(q.trim())}>Ajouter « {q.trim()} » comme texte libre</button>
        )}
      </div>
    </Sheet>
  )
}
