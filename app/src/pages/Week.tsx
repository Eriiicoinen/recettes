import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ReviewPrompt from '../components/ReviewPrompt'
import CopyWeekSheet from '../components/week/CopyWeekSheet'
import FillSheet from '../components/week/FillSheet'
import ItemSheet from '../components/week/ItemSheet'
import RecipePicker from '../components/week/RecipePicker'
import { currentSeason, listRecipes, listStats, yieldLabel, type Recipe, type RecipeStats } from '../lib/recipes'
import { useSession } from '../lib/session'
import { useRealtime } from '../lib/realtime'
import {
  addDays, addToWeek, applyProposals, copyWeek, dayLabel, defaultServings, lastCookedMap, listWeek, makeLeftovers, MEALS, mondayOf,
  pickIdeas, relativeWeek, removeLeftovers, removeWeekItem, todayISO, updateWeekItem, weekDays, weekLabel, type Meal,
  type WeekItem,
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
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState('')
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
  }, [reload])

  useRealtime(household && `week-${start}`, [{ table: 'week_items', filter: `household_id=eq.${household?.id}` }], () => void reload())

  const basket = useMemo(() => (items ?? []).filter((i) => !i.day), [items])
  const slot = (day: string, meal: Meal) => (items ?? []).filter((i) => i.day === day && i.meal === meal)

  const ideas = useMemo(() => {
    const exclude = new Set((items ?? []).map((i) => i.recipe_id).filter((x): x is string => !!x))
    const last = lastCookedMap(stats)
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
            <div className="grid-2">
              <button className="btn primary" onClick={() => setFilling(true)}>✨ Remplir ma semaine</button>
              <button className="btn" onClick={() => setCopying(true)}>📋 Reprendre une semaine</button>
            </div>
          )}
          {copied && <p className="muted small" role="status" style={{ margin: 0 }}>{copied}</p>}
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
          people={household!.people}
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

      {copying && household && items && (
        <CopyWeekSheet householdId={household.id} before={start} onClose={() => setCopying(false)}
          onPick={(w) => {
            setCopying(false)
            void act(async () => {
              const n = await copyWeek(household.id, w, start, items, today)
              setCopied(n ? `✓ ${n} repas repris de la semaine du ${weekLabel(w.start)}.` : 'Rien à reprendre : les créneaux sont déjà remplis ou passés.')
              setTimeout(() => setCopied(''), 4000)
            })
          }} />
      )}

      {filling && household && items && (
        <FillSheet
          start={start}
          today={today}
          items={items}
          recipes={[...recipes.values()]}
          lastCooked={lastCookedMap(stats)}
          onClose={() => setFilling(false)}
          onApply={(proposals) => { setFilling(false); void act(() => applyProposals(household.id, start, proposals, household.people)) }}
        />
      )}
    </section>
  )
}
