import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listRecipes, type Recipe } from '../lib/recipes'
import { dayLabel, listToReview, reviewMeal, updateWeekItem, type WeekItem } from '../lib/week'

/** « C'était comment ? » : note et commentaire sur les repas des derniers jours, une question à la fois. */
export default function ReviewPrompt({ householdId }: { householdId: string }) {
  const [queue, setQueue] = useState<WeekItem[]>([])
  const [dupes, setDupes] = useState<WeekItem[]>([])
  const [recipes, setRecipes] = useState<Map<string, Recipe>>(new Map())
  const [rating, setRating] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [thanks, setThanks] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([listToReview(householdId), listRecipes(householdId, '')])
      .then(([items, r]) => {
        if (cancelled) return
        const byId = new Map(r.map((x) => [x.id, x]))
        // Une recette cuisinée deux fois dans la semaine n'est demandée qu'une fois
        const seen = new Set<string>()
        const first = items.filter((i) => i.recipe_id && byId.has(i.recipe_id) && !seen.has(i.recipe_id) && seen.add(i.recipe_id))
        setQueue(first)
        setDupes(items.filter((i) => !first.includes(i)))
        setRecipes(byId)
      })
      .catch(() => { /* hors ligne : pas de question */ })
    return () => { cancelled = true }
  }, [householdId])

  const item = queue[0]
  if (thanks && !item) return <p className="muted small" role="status" style={{ margin: 0 }}>✓ Merci, c'est noté.</p>
  if (!item) return null
  const recipe = recipes.get(item.recipe_id!)!

  async function submit(skip: boolean) {
    setBusy(true)
    try {
      await reviewMeal(item.id, skip ? null : rating, skip ? '' : note)
      const now = new Date().toISOString()
      await Promise.all(dupes.filter((d) => d.recipe_id === item.recipe_id).map((d) => updateWeekItem(d.id, { reviewed_at: now })))
      setThanks(!skip)
    } catch { /* réessayé à la prochaine ouverture */ }
    setBusy(false)
    setRating(null)
    setNote('')
    setQueue((q) => q.slice(1))
  }

  return (
    <div className="card stack review-card">
      <div className="row between">
        <h2>C'était comment ?</h2>
        {queue.length > 1 && <span className="muted small">{queue.length} repas</span>}
      </div>
      <div>
        <Link to={`/recettes/${recipe.id}`}><strong>{recipe.name}</strong></Link>
        <div className="muted small">{item.day ? `${dayLabel(item.day)} · ${item.meal === 'midi' ? 'midi' : 'soir'}` : ''}</div>
      </div>
      <div className="stars" role="radiogroup" aria-label="Note">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} sur 5`}
            className={rating != null && n <= rating ? 'star on' : 'star'} onClick={() => setRating(n)}>★</button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Un mot ? « moins de sel », « à refaire »…"
        aria-label="Commentaire" maxLength={300} />
      <div className="row between">
        <button className="btn ghost small-btn" disabled={busy} onClick={() => submit(true)}>Pas cuisiné / passer</button>
        <button className="btn primary small-btn" disabled={busy || (rating == null && !note.trim())} onClick={() => submit(false)}>Enregistrer</button>
      </div>
      {recipe.rating != null && <p className="muted small" style={{ margin: 0 }}>Note actuelle : {'★'.repeat(recipe.rating)}. La nouvelle la remplace ; le commentaire s'ajoute aux notes de la recette.</p>}
    </div>
  )
}
