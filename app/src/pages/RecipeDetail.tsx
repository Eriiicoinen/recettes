import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteRecipe, formatDuration, formatQty, getRecipe, listStats, relativeDate, setFavorite, yieldLabel,
  type Recipe, type RecipeLine, type RecipeStats,
} from '../lib/recipes'
import { supabase } from '../lib/supabase'
import Sheet from '../components/Sheet'
import { useSession } from '../lib/session'
import { addDays, addToWeek, mondayOf, relativeWeek, todayISO, weekLabel, weeksContaining } from '../lib/week'

type WakeLockSentinelLike = { release: () => Promise<void> }

function hostname(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

export default function RecipeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [lines, setLines] = useState<RecipeLine[]>([])
  const [stats, setStats] = useState<RecipeStats | undefined>()
  const [missing, setMissing] = useState(false)
  const [servings, setServings] = useState(4)
  const [doneIng, setDoneIng] = useState<Set<number>>(new Set())
  const [doneStep, setDoneStep] = useState<Set<number>>(new Set())
  const [cooking, setCooking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { household } = useSession()
  const [planOpen, setPlanOpen] = useState(false)
  const [inWeeks, setInWeeks] = useState<Set<string>>(new Set())
  const [planned, setPlanned] = useState('')

  async function openPlan() {
    if (!household || !recipe) return
    const thisWeek = mondayOf(todayISO())
    setInWeeks(await weeksContaining(household.id, recipe.id, [thisWeek, addDays(thisWeek, 7)]))
    setPlanOpen(true)
  }

  async function plan(week: string) {
    if (!household || !recipe) return
    setPlanOpen(false)
    await addToWeek(household.id, week, { recipe_id: recipe.id, servings })
    setPlanned(`Ajoutée : ${relativeWeek(week).toLowerCase()}`)
  }

  useEffect(() => {
    if (!id) return
    const load = async () => {
      const r = await getRecipe(id)
      if (!r) { setMissing(true); return }
      setRecipe((prev) => {
        if (!prev || prev.servings !== r.recipe.servings) setServings(r.recipe.servings)
        return r.recipe
      })
      setLines(r.lines)
      setStats((await listStats()).get(id))
    }
    void load()
    const ch = supabase.channel(`recipe-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes', filter: `id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipe_ingredients', filter: `recipe_id=eq.${id}` }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [id])

  // Mode cuisine : écran maintenu allumé
  useEffect(() => {
    if (!cooking) return
    let lock: WakeLockSentinelLike | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }
    const acquire = () => nav.wakeLock?.request('screen').then((l) => { lock = l }).catch(() => {})
    void acquire()
    const onVis = () => { if (document.visibilityState === 'visible') void acquire() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release() }
  }, [cooking])

  if (missing) return <section className="page"><p>Recette introuvable.</p><Link to="/recettes">← Recettes</Link></section>
  if (!recipe) return <section className="page"><p className="muted">Chargement…</p></section>

  const factor = servings / recipe.servings
  const total = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0)

  function toggle(set: Set<number>, i: number, setter: (s: Set<number>) => void) {
    const next = new Set(set)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setter(next)
  }

  async function remove() {
    await deleteRecipe(recipe!.id)
    navigate('/recettes', { replace: true })
  }

  return (
    <section className={cooking ? 'page cooking' : 'page'}>
      <div className="row between">
        <button className="btn ghost back" onClick={() => navigate(-1)}>← Retour</button>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn ghost icon" aria-pressed={recipe.is_favorite} aria-label="Favori"
            onClick={() => setFavorite(recipe.id, !recipe.is_favorite).then(() => setRecipe({ ...recipe, is_favorite: !recipe.is_favorite }))}>
            <span className={recipe.is_favorite ? 'fav' : 'muted'}>{recipe.is_favorite ? '♥' : '♡'}</span>
          </button>
          <Link className="btn ghost" to={`/recettes/${recipe.id}/modifier`}>Modifier</Link>
        </div>
      </div>

      <header className="stack" style={{ gap: 6 }}>
        <h1 style={{ margin: 0 }}>{recipe.name}</h1>
        <div className="muted small">
          {[recipe.category, recipe.seasons.length ? recipe.seasons.join(', ') : "Toute l'année",
            recipe.rating ? '★'.repeat(recipe.rating) : null].filter(Boolean).join(' · ')}
        </div>
        <div className="row wrap small">
          {recipe.prep_minutes ? <span className="pill">Préparation {formatDuration(recipe.prep_minutes)}</span> : null}
          {recipe.cook_minutes ? <span className="pill">Cuisson {formatDuration(recipe.cook_minutes)}</span> : null}
          {total && recipe.prep_minutes && recipe.cook_minutes ? <span className="pill">Total {formatDuration(total)}</span> : null}
          <span className="pill">{relativeDate(stats?.last_cooked ?? null)}{stats?.times_cooked ? ` · ${stats.times_cooked}×` : ''}</span>
        </div>
        {recipe.tags.length > 0 && <div className="row wrap small">{recipe.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>}
      </header>

      <div className="grid-2">
        <button className="btn primary" onClick={openPlan}>📅 Ajouter à la semaine</button>
        <button className="btn" onClick={() => setCooking(!cooking)}>
          {cooking ? 'Quitter le mode cuisine' : '🍳 Mode cuisine'}
        </button>
      </div>
      {planned && <p className="muted small" role="status" style={{ margin: 0 }}>✓ {planned}</p>}
      {planOpen && (
        <Sheet title="Ajouter à quelle semaine ?" onClose={() => setPlanOpen(false)}>
          <div className="stack">
            {[mondayOf(todayISO()), addDays(mondayOf(todayISO()), 7)].map((w) => (
              <button key={w} className="pick-row" onClick={() => plan(w)}>
                <span>{relativeWeek(w)} <span className="muted small">({weekLabel(w)})</span></span>
                {inWeeks.has(w) && <span className="muted small">déjà prévue</span>}
              </button>
            ))}
            <p className="muted small" style={{ margin: 0 }}>Elle rejoint « Recettes de la semaine » ; tu pourras la placer sur un jour dans l'onglet Semaine.</p>
          </div>
        </Sheet>
      )}

      <div className="card stack">
        <div className="row between">
          <h2>Ingrédients</h2>
          <div className="stepper" aria-label="Quantité">
            <button onClick={() => setServings(Math.max(1, servings - 1))} aria-label="Moins de parts">−</button>
            <span>{yieldLabel(servings, recipe.yield_unit)}</span>
            <button onClick={() => setServings(servings + 1)} aria-label="Plus de parts">+</button>
          </div>
        </div>
        {lines.length === 0 ? <p className="muted">Aucun ingrédient saisi.</p> : (
          <ul className="checklist">
            {lines.map((l, i) => (
              <li key={l.id ?? i}>
                <label className={doneIng.has(i) ? 'done' : ''}>
                  <input type="checkbox" checked={doneIng.has(i)} onChange={() => toggle(doneIng, i, setDoneIng)} />
                  <span>
                    <strong>{[formatQty(l.quantity == null ? null : l.quantity * factor), l.unit].filter(Boolean).join(' ')}</strong>
                    {l.quantity != null || l.unit ? ' ' : ''}{l.name}
                    {l.note && <span className="muted">, {l.note}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {recipe.steps.length > 0 && (
        <div className="card stack">
          <h2>Étapes</h2>
          <ol className="steps">
            {recipe.steps.map((s, i) => (
              <li key={i} className={doneStep.has(i) ? 'done' : ''} onClick={() => toggle(doneStep, i, setDoneStep)}>
                <span className="step-num">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {recipe.notes && (
        <div className="card stack">
          <h2>Notes</h2>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{recipe.notes}</p>
        </div>
      )}

      {recipe.source_url && (
        <a className="muted small" href={recipe.source_url} target="_blank" rel="noreferrer">Source : {hostname(recipe.source_url)} ↗</a>
      )}

      {!cooking && (
        confirmDelete ? (
          <div className="card row between">
            <span>Supprimer cette recette ?</span>
            <div className="row">
              <button className="btn" onClick={() => setConfirmDelete(false)}>Annuler</button>
              <button className="btn danger-solid" onClick={remove}>Supprimer</button>
            </div>
          </div>
        ) : (
          <button className="btn ghost danger" onClick={() => setConfirmDelete(true)}>Supprimer la recette</button>
        )
      )}
    </section>
  )
}
