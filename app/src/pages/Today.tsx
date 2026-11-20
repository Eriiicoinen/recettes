import { CalendarDays, ChefHat, Lightbulb, RefreshCw, Settings as SettingsIcon, ShoppingCart, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CategoryIcon, tintOf } from '../components/CategoryIcon'
import ReviewPrompt from '../components/ReviewPrompt'
import RecipePicker from '../components/week/RecipePicker'
import { listRecipes, yieldLabel, type Recipe } from '../lib/recipes'
import { useRealtime } from '../lib/realtime'
import { useSession } from '../lib/session'
import { listItems } from '../lib/shopping'
import { supabase, type Member } from '../lib/supabase'
import {
  addDays, addToWeek, defaultServings, listDays, listWeek, weekStartOf, removeWeekItem, todayISO, updateWeekItem, type Meal, type WeekItem,
} from '../lib/week'

type Summary = { toBuy: number; planned: number }

/** Accueil : ce qu'on mange aujourd'hui, demain, et l'état de la semaine et des courses. */
export default function Today() {
  const { household, me } = useSession()
  const navigate = useNavigate()
  const today = todayISO()
  const tomorrow = addDays(today, 1)
  const week = weekStartOf(today)

  const [items, setItems] = useState<WeekItem[] | null>(null)
  const [recipes, setRecipes] = useState<Map<string, Recipe>>(new Map())
  const [summary, setSummary] = useState<Summary | null>(null)
  const [basket, setBasket] = useState<WeekItem[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [picking, setPicking] = useState<{ day: string; meal: Meal } | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!household) return
    try {
      const [days, r, list, w] = await Promise.all([
        listDays(household.id, [today, tomorrow]),
        listRecipes(household.id, ''),
        listItems(household.id, week).catch(() => []),
        listWeek(household.id, week).catch(() => []),
      ])
      void supabase.from('household_members').select('household_id, user_id, display_name').eq('household_id', household.id)
        .then(({ data }) => setMembers((data ?? []) as Member[]))
      setItems(days)
      setBasket(w.filter((i) => !i.day))
      setRecipes(new Map(r.map((x) => [x.id, x])))
      setSummary({
        toBuy: list.filter((i) => !i.checked && !i.hidden && !i.is_staple).length,
        planned: new Set(w.filter((i) => i.day).map((i) => `${i.day}|${i.meal}`)).size,
      })
      setError('')
    } catch (e) {
      setError((e as Error).message)
      setItems((x) => x ?? [])
    }
  }, [household, today, tomorrow, week])

  useEffect(() => { void load() }, [load])
  useRealtime(household && 'today', [
    { table: 'week_items', filter: `household_id=eq.${household?.id}` },
    { table: 'shopping_items', filter: `household_id=eq.${household?.id}` },
  ], () => void load())

  // L'après-midi, le dîner passe en premier
  const meals: Meal[] = new Date().getHours() >= 14 ? ['soir', 'midi'] : ['midi', 'soir']
  const slot = (day: string, meal: Meal) => (items ?? []).filter((i) => i.day === day && i.meal === meal)
  const greeting = useMemo(() => {
    const h = new Date().getHours()
    return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'
  }, [])
  const dateLabel = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

  async function replace(target: { day: string; meal: Meal }, add: () => Promise<unknown>) {
    setPicking(null)
    try {
      for (const i of slot(target.day, target.meal)) await removeWeekItem(i.id)
      await add()
      await load()
    } catch (e) { setError((e as Error).message) }
  }

  const name = (i: WeekItem) => (i.recipe_id ? recipes.get(i.recipe_id)?.name ?? 'Recette supprimée' : i.free_text ?? '')

  return (
    <section className="page">
      <div className="row between today-head">
        <div>
          <div className="muted small today-date">{dateLabel}</div>
          <h1 style={{ margin: 0 }}>{greeting}{me?.display_name ? `, ${me.display_name}` : ''}</h1>
        </div>
        <Link to="/reglages" className="btn ghost icon" aria-label="Réglages"><SettingsIcon size={22} /></Link>
      </div>

      {error && <p className="error">{error}</p>}

      {items === null ? <p className="muted">Chargement…</p> : meals.map((meal, idx) => {
        const list = slot(today, meal)
        const main = idx === 0
        const label = meal === 'midi' ? 'Ce midi' : 'Ce soir'
        return (
          <div key={meal} className={main ? 'meal-card main' : 'meal-card'}>
            <div className="meal-label">{label}</div>
            {list.length === 0 ? (
              <div className="meal-empty">
                <p className="muted" style={{ margin: 0 }}>Rien de prévu.</p>
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className={main ? 'btn primary' : 'btn'} onClick={() => setPicking({ day: today, meal })}>Choisir</button>
                  <Link className="btn soft" to="/idees"><Lightbulb size={18} /> Que faire ?</Link>
                </div>
              </div>
            ) : list.map((i) => {
              const r = i.recipe_id ? recipes.get(i.recipe_id) : undefined
              const parts = r ? i.servings ?? defaultServings(r, household?.people) : null
              return (
                <div key={i.id} className="meal-item">
                  {r ? (
                    <Link to={`/recettes/${r.id}${parts ? `?parts=${parts}` : ''}`} className={`meal-img ${tintOf(r)}`}>
                      {r.photo_url ? <img src={r.photo_url} alt="" /> : <CategoryIcon recipe={r} size={main ? 40 : 30} strokeWidth={1.5} />}
                    </Link>
                  ) : null}
                  <div className="meal-body">
                    <div className="meal-name">{name(i)}</div>
                    {i.cook_id && members.length > 1 && (
                      <div className="small cook-line">{i.cook_id === me?.user_id ? "C'est toi qui cuisines" : `${members.find((m) => m.user_id === i.cook_id)?.display_name ?? '…'} cuisine`}</div>
                    )}
                    {r && parts && <div className="muted small">Pour {yieldLabel(parts, r.yield_unit)}{(r.prep_minutes ?? 0) + (r.cook_minutes ?? 0) ? ` · ${(r.prep_minutes ?? 0) + (r.cook_minutes ?? 0)} min` : ''}</div>}
                    <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                      {r && !(r.is_simple && r.steps.length === 0) && (
                        <button className={main ? 'btn primary' : 'btn'} onClick={() => navigate(`/recettes/${r.id}?cuisine=1${parts ? `&parts=${parts}` : ''}`)}>
                          <ChefHat size={18} /> Cuisiner
                        </button>
                      )}
                      {r?.is_simple && r.steps.length === 0 && <Link className={main ? 'btn primary' : 'btn'} to={`/recettes/${r.id}`}>Voir la liste</Link>}
                      <button className="btn ghost" onClick={() => setPicking({ day: today, meal })}><RefreshCw size={16} /> Changer</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {items && (
        <Link to={weekStartOf(tomorrow) === week ? '/semaine' : `/semaine?s=${weekStartOf(tomorrow)}`} className="card tomorrow">
          <div className="meal-label">Demain</div>
          <div className="small">
            {(['midi', 'soir'] as Meal[]).map((m) => {
              const l = slot(tomorrow, m)
              return <div key={m}><span className="muted">{m === 'midi' ? 'Midi' : 'Soir'} · </span>{l.length ? l.map(name).join(', ') : <span className="muted">rien de prévu</span>}</div>
            })}
          </div>
        </Link>
      )}

      {household && <ReviewPrompt householdId={household.id} />}

      {summary && (
        <div className="grid-2">
          <Link to="/courses" className="card stat">
            <ShoppingCart size={22} className="stat-icon" />
            <div className="stat-value">{summary.toBuy}</div>
            <div className="muted small">{summary.toBuy > 1 ? 'articles à acheter' : summary.toBuy === 1 ? 'article à acheter' : 'Liste à jour'}</div>
          </Link>
          <Link to="/semaine" className="card stat">
            <CalendarDays size={22} className="stat-icon" />
            <div className="stat-value">{summary.planned}<span className="muted small"> / 14</span></div>
            <div className="muted small">repas prévus cette semaine</div>
            <div className="meter" aria-hidden><span style={{ width: `${Math.min(100, (summary.planned / 14) * 100)}%` }} /></div>
          </Link>
        </div>
      )}
      {summary && summary.planned < 14 && (
        <Link to="/semaine" className="btn soft"><Sparkles size={18} /> Planifier la semaine</Link>
      )}

      {picking && household && (
        <RecipePicker
          title={picking.meal === 'midi' ? (picking.day === today ? 'Ce midi' : 'Midi') : picking.day === today ? 'Ce soir' : 'Soir'}
          householdId={household.id}
          people={household.people}
          basket={weekStartOf(picking.day) === week ? basket : []}
          basketName={name}
          onPickRecipe={(r) => void replace(picking, () => addToWeek(household.id, weekStartOf(picking.day), {
            recipe_id: r.id, servings: defaultServings(r, household.people), ...picking,
          }))}
          onPickBasket={(item) => void replace(picking, () => updateWeekItem(item.id, picking))}
          onFreeText={(t) => void replace(picking, () => addToWeek(household.id, weekStartOf(picking.day), { free_text: t, ...picking }))}
          onClose={() => setPicking(null)}
        />
      )}
    </section>
  )
}
