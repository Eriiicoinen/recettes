import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteRecipe, formatDuration, formatQty, getRecipe, listStats, recipeText, relativeDate, setFavorite, yieldLabel,
  type Recipe, type RecipeLine, type RecipeStats,
} from '../lib/recipes'
import { useRealtime } from '../lib/realtime'
import Sheet from '../components/Sheet'
import { deleteRecipePhotos, setRecipePhoto } from '../lib/photos'
import { useSession } from '../lib/session'
import { findDurations, formatClock, useTimers } from '../lib/timers'
import { addDays, addToWeek, defaultServings, mondayOf, relativeWeek, todayISO, weekLabel, weeksContaining } from '../lib/week'

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
  const { timers, now, start: startTimer, stop: stopTimer } = useTimers()
  const [flash, setFlash] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)

  function notify(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 2500)
  }

  async function share() {
    if (!recipe) return
    const text = recipeText(recipe, lines, servings)
    try {
      if (navigator.share) await navigator.share({ title: recipe.name, text })
      else { await navigator.clipboard.writeText(text); notify('Recette copiée ✓') }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      try { await navigator.clipboard.writeText(text); notify('Recette copiée ✓') } catch { notify('Partage impossible sur cet appareil.') }
    }
  }

  async function changePhoto(file: File | undefined) {
    if (!file || !recipe || !household) return
    setPhotoBusy(true)
    try {
      const url = await setRecipePhoto(household.id, recipe.id, file, recipe.photo_url)
      setRecipe({ ...recipe, photo_url: url })
    } catch (e) {
      notify((e as Error).message)
    }
    setPhotoBusy(false)
  }

  async function openPlan() {
    if (!household || !recipe) return
    const thisWeek = mondayOf(todayISO())
    setInWeeks(await weeksContaining(household.id, recipe.id, [thisWeek, addDays(thisWeek, 7)]))
    setPlanOpen(true)
  }

  async function plan(week: string) {
    if (!household || !recipe) return
    setPlanOpen(false)
    // Quantité laissée telle quelle : la taille du foyer ; sinon celle choisie avec le sélecteur
    const n = servings === recipe.servings ? defaultServings(recipe, household.people) : servings
    await addToWeek(household.id, week, { recipe_id: recipe.id, servings: n })
    setPlanned(`Ajoutée : ${relativeWeek(week).toLowerCase()}`)
  }

  const load = useCallback(async () => {
    if (!id) return
    const r = await getRecipe(id)
    if (!r) { setMissing(true); return }
    setRecipe((prev) => {
      if (!prev || prev.servings !== r.recipe.servings) setServings(r.recipe.servings)
      return r.recipe
    })
    setLines(r.lines)
    setStats((await listStats()).get(id))
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  useRealtime(id ? `recipe-${id}` : null, [
    { table: 'recipes', filter: `id=eq.${id}` },
    { table: 'recipe_ingredients', filter: `recipe_id=eq.${id}` },
  ], () => void load())

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
    if (household) await deleteRecipePhotos(household.id, recipe!.id).catch(() => {})
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

      {recipe.photo_url && !cooking && <img className="hero" src={recipe.photo_url} alt="" />}

      <header className="stack" style={{ gap: 6 }}>
        <h1 style={{ margin: 0 }}>{recipe.name}</h1>
        <div className="muted small">
          {[recipe.is_simple ? '🧺 Repas sans recette' : recipe.category, recipe.seasons.length ? recipe.seasons.join(', ') : "Toute l'année",
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
        {!(recipe.is_simple && recipe.steps.length === 0) && (
          <button className="btn" onClick={() => setCooking(!cooking)}>
            {cooking ? 'Quitter le mode cuisine' : '🍳 Mode cuisine'}
          </button>
        )}
      </div>
      {!cooking && (
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="btn small-btn" onClick={share}>📤 Partager</button>
          <label className={photoBusy ? 'btn small-btn disabled' : 'btn small-btn'}>
            {photoBusy ? 'Envoi…' : recipe.photo_url ? '📷 Changer la photo' : '📷 Ajouter une photo'}
            <input type="file" accept="image/*" hidden disabled={photoBusy}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void changePhoto(f) }} />
          </label>
        </div>
      )}
      {flash && <p className="muted small" role="status" style={{ margin: 0 }}>{flash}</p>}
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
          <h2>{recipe.is_simple ? 'À acheter' : 'Ingrédients'}</h2>
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
                <span>
                  {s}
                  {findDurations(s).map((d) => (
                    <button key={d.seconds} className="timer-chip" aria-label={`Minuteur ${d.label}`}
                      onClick={(e) => { e.stopPropagation(); setCooking(true); startTimer(`Étape ${i + 1} · ${d.label}`, d.seconds) }}>
                      ⏱ {d.label}
                    </button>
                  ))}
                </span>
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

      {timers.length > 0 && (
        <div className="timer-bar" role="status" aria-live="polite">
          {timers.map((t) => (
            <div key={t.id} className={t.done ? 'timer done' : 'timer'}>
              <span className="timer-label">{t.label}</span>
              <strong className="timer-time">{t.done ? '⏰ Terminé !' : formatClock((t.end - now) / 1000)}</strong>
              <button className="btn ghost icon" onClick={() => stopTimer(t.id)} aria-label={t.done ? 'OK' : 'Arrêter'}>{t.done ? 'OK' : '✕'}</button>
            </div>
          ))}
        </div>
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
