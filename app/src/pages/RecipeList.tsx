import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReviewPrompt from '../components/ReviewPrompt'
import {
  cacheAllRecipes, CATEGORIES, currentSeason, formatDuration, listRecipes, listStats, relativeDate,
  type Recipe, type RecipeStats,
} from '../lib/recipes'
import { useSession } from '../lib/session'
import { useRealtime } from '../lib/realtime'

type Chip = 'favoris' | 'saison' | 'rapide' | 'oubliees' | 'simples'
const CHIPS: { id: Chip; label: string }[] = [
  { id: 'favoris', label: '♥ Favoris' },
  { id: 'saison', label: `De saison (${currentSeason()})` },
  { id: 'rapide', label: '< 30 min' },
  { id: 'oubliees', label: 'Pas faites depuis longtemps' },
  { id: 'simples', label: '🧺 Sans recette' },
]

export default function RecipeList() {
  const { household } = useSession()
  const [query, setQuery] = useState(() => sessionStorage.getItem('recipes.q') ?? '')
  const [category, setCategory] = useState<string>('')
  const [chips, setChips] = useState<Set<Chip>>(new Set())
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [stats, setStats] = useState<Map<string, RecipeStats>>(new Map())
  const [error, setError] = useState('')
  const reqId = useRef(0)

  useEffect(() => {
    try { sessionStorage.setItem('recipes.q', query) } catch { /* stockage indisponible */ }
  }, [query])

  const load = useCallback(async () => {
    if (!household) return
    const id = ++reqId.current
    try {
      const [r, s] = await Promise.all([listRecipes(household.id, query), listStats()])
      if (id !== reqId.current) return // une recherche plus récente a été lancée
      setRecipes(r)
      setStats(s)
      setError('')
      if (!query) void cacheAllRecipes(household.id) // pour cuisiner sans réseau
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message)
    }
  }, [household, query])

  useEffect(() => {
    const t = setTimeout(load, query ? 200 : 0)
    return () => clearTimeout(t)
  }, [load, query])

  useRealtime(household && 'recipes-list', [{ table: 'recipes', filter: `household_id=eq.${household?.id}` }], () => void load())

  const filtered = useMemo(() => {
    if (!recipes) return null
    const season = currentSeason()
    const cutoff = Date.now() - 30 * 86400000
    let out = recipes.filter((r) => {
      if (category && r.category !== category) return false
      if (chips.has('favoris') && !r.is_favorite) return false
      if (chips.has('simples') && !r.is_simple) return false
      if (chips.has('saison') && r.seasons.length && !r.seasons.includes(season)) return false
      if (chips.has('rapide') && ((r.prep_minutes ?? 0) + (r.cook_minutes ?? 0) > 30 || !(r.prep_minutes || r.cook_minutes))) return false
      if (chips.has('oubliees')) {
        const last = stats.get(r.id)?.last_cooked
        if (last && new Date(last).getTime() > cutoff) return false
      }
      return true
    })
    if (chips.has('oubliees')) {
      const t = (r: Recipe) => { const l = stats.get(r.id)?.last_cooked; return l ? new Date(l).getTime() : 0 }
      out = [...out].sort((a, b) => t(a) - t(b))
    }
    return out
  }, [recipes, stats, category, chips])

  function toggle(c: Chip) {
    setChips((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  const filtering = !!(query || category || chips.size)

  return (
    <section className="page">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Recettes</h1>
        <Link to="/recettes/nouvelle" className="btn primary">+ Ajouter</Link>
      </div>

      {household && !query && <ReviewPrompt householdId={household.id} />}

      <div className="search">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom, ingrédient, tag…" aria-label="Rechercher une recette" enterKeyHint="search" />
        {query && <button className="search-clear" onClick={() => setQuery('')} aria-label="Effacer">×</button>}
      </div>

      <div className="chips" role="group" aria-label="Filtres">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={category ? 'chip on' : 'chip'} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        {CHIPS.map((c) => (
          <button key={c.id} className={chips.has(c.id) ? 'chip on' : 'chip'} aria-pressed={chips.has(c.id)} onClick={() => toggle(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}
      {filtered === null ? (
        <p className="muted">Chargement…</p>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {filtering ? 'Aucune recette ne correspond.' : (
            <>Ton carnet est vide.<br /><Link to="/recettes/nouvelle">Ajoute ta première recette</Link></>
          )}
        </div>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>{filtered.length} recette{filtered.length > 1 ? 's' : ''}</p>
          <ul className="recipe-list">
            {filtered.map((r) => {
              const total = (r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)
              const s = stats.get(r.id)
              return (
                <li key={r.id}>
                  <Link to={`/recettes/${r.id}`} className="recipe-card">
                    {r.photo_url ? <img className="thumb" src={r.photo_url} alt="" loading="lazy" />
                      : <span className="thumb empty" aria-hidden>{r.is_simple ? '🧺' : '🍽'}</span>}
                    <div className="recipe-card-main">
                      <div className="recipe-name">{r.is_favorite && <span className="fav" aria-label="Favori">♥ </span>}{r.name}</div>
                      <div className="muted small">
                        {[r.is_simple ? '🧺 Sans recette' : r.category, total ? formatDuration(total) : null, r.rating ? '★'.repeat(r.rating) : null].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="muted small recipe-last">{relativeDate(s?.last_cooked ?? null)}</div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
