import { ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import CopyWeekSheet from '../components/week/CopyWeekSheet'
import FillSheet from '../components/week/FillSheet'
import ItemSheet from '../components/week/ItemSheet'
import PlanSheet from '../components/week/PlanSheet'
import RecipePicker from '../components/week/RecipePicker'
import { listRecipes, listStats, type Recipe, type RecipeStats } from '../lib/recipes'
import { useRealtime } from '../lib/realtime'
import { useSession } from '../lib/session'
import {
  addDays, addToWeek, applyProposals, copyWeek, dayLabel, defaultServings, fromISO, lastCookedMap, listWeek, makeLeftovers,
  MEALS, mondayOf, relativeWeek, removeLeftovers, removeWeekItem, todayISO, updateWeekItem, weekDays, weekLabel, type Meal,
  type WeekItem,
} from '../lib/week'

type Target = { day: string; meal: Meal } | 'basket'

/** « Lun 17 » */
function shortDay(iso: string) {
  const d = fromISO(iso)
  const w = d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
  return { weekday: w.charAt(0).toUpperCase() + w.slice(1), num: d.getDate() }
}

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
  const [planning, setPlanning] = useState(false)
  const [filling, setFilling] = useState(false)
  const [copying, setCopying] = useState(false)
  const [flash, setFlash] = useState('')
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
  const days = weekDays(start)
  const pastDays = days.filter((d) => d < today)
  const nextDays = days.filter((d) => d >= today)
  const planned = new Set((items ?? []).filter((i) => i.day).map((i) => `${i.day}|${i.meal}`)).size
  const editable = days[6] >= today

  const goWeek = (s: string) => setParams(s === mondayOf(today) ? {} : { s }, { replace: true })

  function itemName(i: WeekItem) {
    return i.recipe_id ? recipes.get(i.recipe_id)?.name ?? 'Recette supprimée' : i.free_text ?? ''
  }

  function notify(msg: string) {
    setFlash(msg)
    setTimeout(() => setFlash(''), 4000)
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

  // Appui long sur un repas : mode déplacement (un appui simple ouvre ses actions)
  const press = useRef<{ timer?: ReturnType<typeof setTimeout>; fired: boolean }>({ fired: false })
  const pressHandlers = (i: WeekItem) => ({
    onPointerDown: () => {
      press.current.fired = false
      clearTimeout(press.current.timer)
      press.current.timer = setTimeout(() => {
        press.current.fired = true
        navigator.vibrate?.(15)
        setMoving(i)
      }, 450)
    },
    onPointerUp: () => clearTimeout(press.current.timer),
    onPointerLeave: () => clearTimeout(press.current.timer),
    onPointerCancel: () => clearTimeout(press.current.timer),
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (press.current.fired) { press.current.fired = false; return }
      if (!moving) setSelected(i)
    },
  })

  // Fonction de rendu (pas un composant) : sinon chaque rendu démonte et recrée les puces
  const chip = (i: WeekItem) => {
    const r = i.recipe_id ? recipes.get(i.recipe_id) : undefined
    return (
      <button key={i.id} className={`wchip${moving?.id === i.id ? ' moving' : ''}${r ? '' : ' free'}`} disabled={!!moving && moving.id !== i.id}
        {...pressHandlers(i)}>
        <span className="wchip-text">{itemName(i)}</span>
      </button>
    )
  }

  const cell = (day: string, meal: Meal) => {
    const list = slot(day, meal)
    const label = `${meal === 'midi' ? 'Midi' : 'Soir'} du ${dayLabel(day)}`
    return (
      <div className="wcell" key={meal}>
        {list.map(chip)}
        {moving ? (
          !(moving.day === day && moving.meal === meal) && (
            <button className="wadd drop" onClick={() => dropTo({ day, meal })} aria-label={`Mettre au ${label}`}>Ici</button>
          )
        ) : list.length === 0 && (
          <button className="wadd" onClick={() => setPicker({ day, meal })} aria-label={`Ajouter au ${label}`}><Plus size={18} /></button>
        )}
      </div>
    )
  }

  const row = (day: string) => {
    const { weekday, num } = shortDay(day)
    return (
      <div key={day} className={`wrow${day === today ? ' today' : ''}`}>
        <div className="wday"><span className="wday-name">{weekday}</span><span className="wday-num">{num}</span></div>
        {MEALS.map((m) => cell(day, m.id))}
      </div>
    )
  }

  return (
    <section className="page">
      <div className="week-nav">
        <button className="btn ghost icon" onClick={() => goWeek(addDays(start, -7))} aria-label="Semaine précédente"><ChevronLeft size={24} /></button>
        <div className="week-title">
          <h1>{relativeWeek(start)}</h1>
          <div className="muted small">{weekLabel(start)}</div>
        </div>
        <button className="btn ghost icon" onClick={() => goWeek(addDays(start, 7))} aria-label="Semaine suivante"><ChevronRight size={24} /></button>
      </div>
      {start !== mondayOf(today) && (
        <button className="btn ghost small-btn" style={{ alignSelf: 'center' }} onClick={() => goWeek(mondayOf(today))}>Revenir à cette semaine</button>
      )}

      {moving ? (
        <div className="move-banner" role="status">
          <span>Où mettre <strong>{itemName(moving)}</strong> ?</span>
          <button className="btn small-btn" onClick={() => setMoving(null)}>Annuler</button>
        </div>
      ) : items && editable && (
        <div className="week-summary">
          <div>
            <div className="stat-value">{planned}<span className="muted small"> / 14 repas</span></div>
            <div className="meter" aria-hidden><span style={{ width: `${Math.min(100, (planned / 14) * 100)}%` }} /></div>
          </div>
          <button className="btn primary" onClick={() => setPlanning(true)}><Sparkles size={18} /> Planifier</button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {flash && <p className="muted small" role="status" style={{ margin: 0 }}>{flash}</p>}

      {items === null ? <p className="muted">Chargement…</p> : (
        <>
          {(basket.length > 0 || (moving && moving.day)) && (
            <div className="card stack unplaced">
              <div className="row between">
                <h2>À placer <span className="muted small">{basket.length || ''}</span></h2>
                {moving?.day && <button className="btn small-btn primary" onClick={() => dropTo('basket')}>Mettre ici</button>}
              </div>
              <div className="basket">{basket.map(chip)}</div>
              {!moving && basket.length > 0 && (
                <p className="muted small" style={{ margin: 0 }}>Déjà comptées dans les courses. Touche-en une puis « Placer », ou laisse-les sans jour.</p>
              )}
            </div>
          )}

          <div className="wgrid">
            <div className="wrow whead"><span /><span>Midi</span><span>Soir</span></div>
            {pastDays.length > 0 && pastDays.length < 7 && (
              <details className="past-days">
                <summary className="muted small">{pastDays.length} jour{pastDays.length > 1 ? 's' : ''} passé{pastDays.length > 1 ? 's' : ''}</summary>
                {pastDays.map(row)}
              </details>
            )}
            {(pastDays.length === 7 ? days : nextDays).map(row)}
          </div>
          {!moving && <p className="muted small" style={{ margin: 0, textAlign: 'center' }}>Appui long sur un repas pour le déplacer.</p>}
        </>
      )}

      {planning && household && items && (
        <PlanSheet
          recipes={[...recipes.values()]}
          lastCooked={lastCookedMap(stats)}
          exclude={new Set(items.map((i) => i.recipe_id).filter((x): x is string => !!x))}
          onClose={() => setPlanning(false)}
          onFill={() => { setPlanning(false); setFilling(true) }}
          onCopy={() => { setPlanning(false); setCopying(true) }}
          onAddUnplaced={() => { setPlanning(false); setPicker('basket') }}
          onAddIdea={(r) => void act(() => addToWeek(household.id, start, { recipe_id: r.id, servings: defaultServings(r, household.people) }))}
        />
      )}

      {picker && (
        <RecipePicker
          title={picker === 'basket' ? 'Ajouter sans jour' : `${dayLabel(picker.day)} · ${picker.meal === 'midi' ? 'Midi' : 'Soir'}`}
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
              notify(n ? `✓ ${n} repas repris de la semaine du ${weekLabel(w.start)}.` : 'Rien à reprendre : les créneaux sont déjà remplis ou passés.')
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
