import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ReviewPrompt from '../components/ReviewPrompt'
import Sheet from '../components/Sheet'
import { currentSeason, listRecipes, listStats, norm, yieldLabel, type Recipe, type RecipeStats } from '../lib/recipes'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'
import {
  addDays, addToWeek, applyProposals, dayLabel, defaultServings, dropProposal, listWeek, makeLeftovers, MEALS, mondayOf,
  pickIdeas, proposeWeek, relativeWeek, removeLeftovers, removeWeekItem, swapProposal, todayISO, updateWeekItem, weekDays,
  weekLabel, type Meal, type Proposal, type WeekItem,
} from '../lib/week'

type Target = { day: string; meal: Meal } | 'basket'

export default function Week() {
  const { household } = useSession()
  const [params, setParams] = useSearchParams()
  const start = mondayOf(params.get('s') ?? todayISO())
  const today = todayISO()

  const [items, setItems] = useState<WeekItem[] | null>(null)
  const [recipes, setRecipes] = useState<Map<string, Recipe>>(new Map())
  const [stats, setStats] = useState<Map<string, RecipeStats>>(new Map())
  const [picker, setPicker] = useState<Target | null>(null)
  const [selected, setSelected] = useState<WeekItem | null>(null)
  const [moving, setMoving] = useState<WeekItem | null>(null)
  const [ideasSeed, setIdeasSeed] = useState(0)
  const [filling, setFilling] = useState(false)
  const [error, setError] = useState('')

  const reqId = useRef(0)
  const reload = useCallback(async () => {
    if (!household) return
    const id = ++reqId.current
    try {
      const [w, r, s] = await Promise.all([listWeek(household.id, start), listRecipes(household.id, ''), listStats()])
      if (id !== reqId.current) return // semaine changée ou rechargement plus récent entre-temps
      setItems(w)
      setRecipes(new Map(r.map((x) => [x.id, x])))
      setStats(s)
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message)
    }
  }, [household, start])

  useEffect(() => {
    setItems(null)
    void reload()
    if (!household) return
    const ch = supabase.channel(`week-${start}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'week_items', filter: `household_id=eq.${household.id}` }, () => void reload())
      // Les suppressions ne peuvent pas être filtrées côté temps réel : écoutées sans filtre
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'week_items' }, () => void reload())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [household, start, reload])

  const basket = useMemo(() => (items ?? []).filter((i) => !i.day), [items])
  const slot = (day: string, meal: Meal) => (items ?? []).filter((i) => i.day === day && i.meal === meal)

  const ideas = useMemo(() => {
    const exclude = new Set((items ?? []).map((i) => i.recipe_id).filter((x): x is string => !!x))
    const last = new Map([...stats.values()].map((s) => [s.recipe_id, s.last_cooked]))
    return pickIdeas([...recipes.values()], last, exclude, currentSeason())
    // ideasSeed relance le tirage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, stats, items?.length, ideasSeed])

  const goWeek = (s: string) => setParams(s === mondayOf(today) ? {} : { s }, { replace: true })

  function itemName(i: WeekItem) {
    return i.recipe_id ? recipes.get(i.recipe_id)?.name ?? 'Recette supprimée' : i.free_text ?? ''
  }
  function itemYield(i: WeekItem) {
    const r = i.recipe_id ? recipes.get(i.recipe_id) : null
    if (!r) return null
    return yieldLabel(i.servings ?? r.servings, r.yield_unit)
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      setError('')
      await fn()
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function dropTo(target: Target) {
    if (!moving) return
    const m = moving
    setMoving(null)
    await act(() => updateWeekItem(m.id, target === 'basket' ? { day: null, meal: null } : target))
  }

  async function pickRecipe(recipe: Recipe) {
    const t = picker!
    setPicker(null)
    await act(() => addToWeek(household!.id, start, {
      recipe_id: recipe.id, servings: defaultServings(recipe, household!.people), ...(t === 'basket' ? {} : t),
    }))
  }
  async function pickFreeText(textValue: string) {
    const t = picker!
    setPicker(null)
    await act(() => addToWeek(household!.id, start, { free_text: textValue, ...(t === 'basket' ? {} : t) }))
  }
  async function placeFromBasket(item: WeekItem) {
    const t = picker!
    setPicker(null)
    if (t !== 'basket') await act(() => updateWeekItem(item.id, t))
  }

  const ItemChip = ({ i }: { i: WeekItem }) => (
    <button className={`week-item${moving?.id === i.id ? ' moving' : ''}${i.recipe_id ? '' : ' free'}`}
      onClick={() => (moving ? undefined : setSelected(i))} disabled={!!moving}>
      <span className="week-item-name">{itemName(i)}</span>
      {itemYield(i) && <span className="muted small">{itemYield(i)}</span>}
    </button>
  )

  return (
    <section className="page">
      <div className="week-nav">
        <button className="btn ghost icon" onClick={() => goWeek(addDays(start, -7))} aria-label="Semaine précédente">‹</button>
        <div className="week-title">
          <h1>{relativeWeek(start)}</h1>
          <div className="muted small">{weekLabel(start)}</div>
        </div>
        <button className="btn ghost icon" onClick={() => goWeek(addDays(start, 7))} aria-label="Semaine suivante">›</button>
      </div>
      {start !== mondayOf(today) && (
        <button className="btn ghost small-btn" style={{ alignSelf: 'center' }} onClick={() => goWeek(mondayOf(today))}>Revenir à cette semaine</button>
      )}

      {moving && (
        <div className="move-banner" role="status">
          <span>Où mettre <strong>{itemName(moving)}</strong> ?</span>
          <button className="btn small-btn" onClick={() => setMoving(null)}>Annuler</button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {household && start === mondayOf(today) && !moving && <ReviewPrompt householdId={household.id} />}
      {items === null ? <p className="muted">Chargement…</p> : (
        <>
          {!moving && addDays(start, 6) >= today && (
            <button className="btn primary fill-btn" onClick={() => setFilling(true)}>✨ Remplir ma semaine</button>
          )}
          <div className="card stack">
            <div className="row between">
              <h2>Recettes de la semaine</h2>
              {moving ? (
                moving.day && <button className="btn small-btn primary" onClick={() => dropTo('basket')}>Mettre ici</button>
              ) : (
                <button className="btn small-btn" onClick={() => setPicker('basket')}>+ Ajouter</button>
              )}
            </div>
            {basket.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>
                Les recettes prévues sans jour précis. Elles comptent pour la liste de courses. Place-les dans un créneau si tu veux.
              </p>
            ) : (
              <div className="basket">{basket.map((i) => <ItemChip key={i.id} i={i} />)}</div>
            )}
          </div>

          <div className="days">
            {weekDays(start).map((day) => (
              <div key={day} className={day === today ? 'day card today' : day < today ? 'day card past' : 'day card'}>
                <div className="day-title">{dayLabel(day)}{day === today && <span className="pill small">Aujourd'hui</span>}</div>
                {MEALS.map((m) => {
                  const list = slot(day, m.id)
                  return (
                    <div key={m.id} className="slot">
                      <span className="slot-label muted small">{m.label}</span>
                      <div className="slot-items">
                        {list.map((i) => <ItemChip key={i.id} i={i} />)}
                        {moving ? (
                          !(moving.day === day && moving.meal === m.id) && (
                            <button className="slot-add drop" onClick={() => dropTo({ day, meal: m.id })}>Mettre ici</button>
                          )
                        ) : (
                          <button className="slot-add" onClick={() => setPicker({ day, meal: m.id })}
                            aria-label={`Ajouter au ${m.label.toLowerCase()} du ${dayLabel(day)}`}>{list.length ? '+' : '+ Ajouter'}</button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {!moving && ideas.length > 0 && (
            <div className="card stack">
              <div className="row between">
                <h2>💡 Idées</h2>
                <button className="btn ghost small-btn" onClick={() => setIdeasSeed((n) => n + 1)}>Autres idées</button>
              </div>
              <p className="muted small" style={{ margin: 0 }}>De saison, pas cuisinées depuis un mois.</p>
              <ul className="plain ideas">
                {ideas.map((r) => (
                  <li key={r.id} className="row between">
                    <Link to={`/recettes/${r.id}`}>{r.name}</Link>
                    <button className="btn small-btn" onClick={() => act(() => addToWeek(household!.id, start, { recipe_id: r.id, servings: defaultServings(r, household!.people) }))}>
                      + Semaine
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {picker && (
        <RecipePicker
          title={picker === 'basket' ? 'Ajouter à la semaine' : `${dayLabel(picker.day)} · ${picker.meal === 'midi' ? 'Midi' : 'Soir'}`}
          householdId={household!.id}
          basket={picker === 'basket' ? [] : basket}
          basketName={itemName}
          onPickRecipe={pickRecipe}
          onPickBasket={placeFromBasket}
          onFreeText={pickFreeText}
          onClose={() => setPicker(null)}
        />
      )}

      {selected && (
        <ItemSheet
          item={selected}
          name={itemName(selected)}
          recipe={selected.recipe_id ? recipes.get(selected.recipe_id) ?? null : null}
          people={household?.people ?? 2}
          hasLeftovers={(items ?? []).some((i) => i.leftover_of === selected.id)}
          onClose={() => setSelected(null)}
          onServings={(n) => act(() => updateWeekItem(selected.id, { servings: n })).then(() => setSelected({ ...selected, servings: n }))}
          onMove={() => { setMoving(selected); setSelected(null) }}
          onToBasket={() => { const s = selected; setSelected(null); void act(() => updateWeekItem(s.id, { day: null, meal: null })) }}
          onLeftovers={() => {
            const s = selected
            const r = recipes.get(s.recipe_id!)
            setSelected(null)
            if (r) void act(() => makeLeftovers(s, r, household!.people))
          }}
          onRemove={() => {
            const s = selected
            setSelected(null)
            const parent = s.leftover_of ? (items ?? []).find((i) => i.id === s.leftover_of) : undefined
            void act(() => (s.leftover_of ? removeLeftovers(s, parent) : removeWeekItem(s.id)))
          }}
        />
      )}

      {filling && household && items && (
        <FillSheet
          start={start}
          today={today}
          items={items}
          recipes={[...recipes.values()]}
          lastCooked={new Map([...stats.values()].map((s) => [s.recipe_id, s.last_cooked]))}
          onClose={() => setFilling(false)}
          onApply={(proposals) => { setFilling(false); void act(() => applyProposals(household.id, start, proposals, household.people)) }}
        />
      )}
    </section>
  )
}

function ItemSheet({ item, name, recipe, people, hasLeftovers, onClose, onServings, onMove, onToBasket, onLeftovers, onRemove }: {
  item: WeekItem; name: string; recipe: Recipe | null; people: number; hasLeftovers: boolean; onClose: () => void
  onServings: (n: number) => void; onMove: () => void; onToBasket: () => void; onLeftovers: () => void; onRemove: () => void
}) {
  const servings = item.servings ?? (recipe ? defaultServings(recipe, people) : 1)
  const forPeople = recipe && !recipe.yield_unit
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="stack">
        {item.day && <p className="muted small" style={{ margin: 0 }}>{dayLabel(item.day)} · {item.meal === 'midi' ? 'Midi' : 'Soir'}</p>}
        {recipe && (
          <div className="row between">
            <span>Quantité</span>
            <div className="stepper">
              <button onClick={() => onServings(Math.max(1, servings - 1))} aria-label="Moins">−</button>
              <span>{yieldLabel(servings, recipe.yield_unit)}</span>
              <button onClick={() => onServings(servings + 1)} aria-label="Plus">+</button>
            </div>
          </div>
        )}
        {forPeople && (
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="muted small">Invités :</span>
            {[1, 2, 4].map((n) => (
              <button key={n} className="chip" onClick={() => onServings(servings + n)}>+{n}</button>
            ))}
          </div>
        )}
        {forPeople && item.day && !hasLeftovers && (
          <button className="btn" onClick={onLeftovers}>🍱 Cuisiner ×2 pour les restes ({item.meal === 'soir' ? 'midi du lendemain' : 'le soir'})</button>
        )}
        {hasLeftovers && <p className="muted small" style={{ margin: 0 }}>🍱 Cuisiné en double : les restes sont prévus au repas suivant.</p>}
        {item.leftover_of && <p className="muted small" style={{ margin: 0 }}>Retirer ces restes remet le plat d'origine en quantité simple.</p>}
        {recipe && <Link className="btn" to={`/recettes/${recipe.id}`}>Ouvrir la recette</Link>}
        <button className="btn" onClick={onMove}>{item.day ? 'Déplacer…' : 'Placer dans un créneau…'}</button>
        {item.day && <button className="btn" onClick={onToBasket}>Remettre sans jour précis</button>}
        <button className="btn ghost danger" onClick={onRemove}>Retirer de la semaine</button>
      </div>
    </Sheet>
  )
}

const QUICK = [['🚫', 'Absents'], ['🍽', 'Resto'], ['🥡', 'Restes'], ['🥪', 'Sur le pouce']] as const

function RecipePicker({ title, householdId, basket, basketName, onPickRecipe, onPickBasket, onFreeText, onClose }: {
  title: string; householdId: string; basket: WeekItem[]; basketName: (i: WeekItem) => string
  onPickRecipe: (r: Recipe) => void; onPickBasket: (i: WeekItem) => void; onFreeText: (t: string) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Recipe[] | null>(null)
  const [free, setFree] = useState('')

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      listRecipes(householdId, q).then((r) => { if (!cancelled) setResults(r) }).catch(() => {})
    }, q ? 200 : 0)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, householdId])

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

function FillSheet({ start, today, items, recipes, lastCooked, onClose, onApply }: {
  start: string; today: string; items: WeekItem[]; recipes: Recipe[]; lastCooked: Map<string, string | null>
  onClose: () => void; onApply: (p: Proposal[]) => void
}) {
  const season = currentSeason()
  const [meals, setMeals] = useState<Meal[]>(['midi', 'soir'])
  const [leftovers, setLeftovers] = useState(false)
  const [result, setResult] = useState(() => proposeWeek({ start, today, meals, items, recipes, lastCooked, season, leftovers }))

  function redo(next: { meals?: Meal[]; leftovers?: boolean }) {
    const m = next.meals ?? meals
    const l = next.leftovers ?? leftovers
    setMeals(m)
    setLeftovers(l)
    setResult(proposeWeek({ start, today, meals: m, items, recipes, lastCooked, season, leftovers: l }))
  }
  const toggleMeal = (m: Meal) => redo({ meals: meals.includes(m) ? meals.filter((x) => x !== m) : [...meals, m] })
  const { proposals, unfilled } = result
  const cooked = proposals.filter((p) => p.leftoverOf == null).length

  return (
    <Sheet title="Remplir ma semaine" onClose={onClose}>
      <div className="stack">
        <div className="row wrap" style={{ gap: 6 }}>
          {MEALS.map((m) => (
            <button key={m.id} className={meals.includes(m.id) ? 'chip on' : 'chip'} aria-pressed={meals.includes(m.id)}
              onClick={() => toggleMeal(m.id)}>{m.label}</button>
          ))}
          <button className={leftovers ? 'chip on' : 'chip'} aria-pressed={leftovers} onClick={() => redo({ leftovers: !leftovers })}>
            🍱 Restes du soir le midi
          </button>
        </div>
        {proposals.length === 0 ? (
          <p className="muted">{unfilled ? 'Pas de recette disponible : ajoute des plats à ton carnet (ou vérifie leurs saisons).' : 'Tous les créneaux sont déjà remplis.'}</p>
        ) : (
          <ul className="plain fill-list">
            {proposals.map((p, i) => (
              <li key={`${p.day}${p.meal}`} className="fill-row">
                <div className="fill-when muted small">{dayLabel(p.day).split(' ').slice(0, 2).join(' ')} · {p.meal}</div>
                <div className="fill-what">
                  {p.leftoverOf != null ? <span className="muted">🍱 Restes : {proposals[p.leftoverOf]?.recipe?.name}</span>
                    : p.basketItem && !p.recipe ? <span>{p.basketItem.free_text}</span>
                    : <span>{p.recipe?.name}{p.basketItem && <span className="muted small"> (déjà choisie)</span>}</span>}
                </div>
                {p.leftoverOf == null && (
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn ghost icon" aria-label="Autre recette"
                      onClick={() => setResult({ unfilled, proposals: swapProposal(proposals, i, recipes, items, lastCooked, season) })}>🔄</button>
                    <button className="btn ghost icon" aria-label="Laisser libre"
                      onClick={() => setResult({ unfilled, proposals: dropProposal(proposals, i) })}>✕</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {proposals.length > 0 && unfilled > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            {unfilled} créneau{unfilled > 1 ? 'x restent libres' : ' reste libre'} : plus assez de recettes de saison dans le carnet.
          </p>
        )}
        <p className="muted small" style={{ margin: 0 }}>Plats de saison, bien notés, pas faits récemment, rapides en semaine. 🔄 pour changer, ✕ pour laisser libre.</p>
        <button className="btn primary" disabled={proposals.length === 0} onClick={() => onApply(proposals)}>
          Valider{cooked ? ` (${cooked} repas)` : ''}
        </button>
      </div>
    </Sheet>
  )
}
