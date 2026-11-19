import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Sheet from '../components/Sheet'
import { guessAisle } from '../lib/aisleGuess'
import { cacheGet, cacheSet, flush, onQueueChange, run } from '../lib/offline'
import { ingKey, listAisles, listIngredients, type Aisle, type Ingredient } from '../lib/recipes'
import { useSession } from '../lib/session'
import { formatAmount, listItems, syncList, type ShoppingItem } from '../lib/shopping'
import { supabase, type Member } from '../lib/supabase'
import { addDays, mondayOf, relativeWeek, todayISO, weekLabel } from '../lib/week'

type Cache = { items: ShoppingItem[]; aisles: Aisle[]; members: Member[]; missing: string[] }

export default function Shopping() {
  const { household, me } = useSession()
  const [params, setParams] = useSearchParams()
  const thisWeek = mondayOf(todayISO())
  const week = mondayOf(params.get('s') ?? todayISO())
  const cacheKey = household ? `recettes.shopping.${household.id}.${week}` : ''

  const [items, setItems] = useState<ShoppingItem[] | null>(null)
  const [aisles, setAisles] = useState<Aisle[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [selected, setSelected] = useState<ShoppingItem | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState('')
  const itemsRef = useRef<ShoppingItem[] | null>(null)
  itemsRef.current = items
  // Numéro du dernier chargement : un résultat dépassé (autre semaine, modification locale depuis) est ignoré
  const loadSeq = useRef(0)

  const persist = useCallback((next: Partial<Cache>) => {
    if (!cacheKey) return
    const prev = cacheGet<Cache>(cacheKey) ?? { items: [], aisles: [], members: [], missing: [] }
    cacheSet(cacheKey, { ...prev, ...next })
  }, [cacheKey])

  /** withSync : recalcule la liste à partir du menu (sinon simple relecture). */
  const load = useCallback(async (withSync: boolean) => {
    if (!household) return
    const n = ++loadSeq.current
    try {
      await flush()
      const miss = withSync ? await syncList(household.id, week, week === thisWeek) : null
      const [list, a, m, ing] = await Promise.all([
        listItems(household.id, week),
        listAisles(household.id),
        supabase.from('household_members').select('household_id, user_id, display_name').eq('household_id', household.id)
          .then(({ data }) => (data ?? []) as Member[]),
        listIngredients(household.id),
      ])
      if (n !== loadSeq.current) return
      setItems(list)
      setAisles(a)
      setMembers(m)
      setIngredients(ing)
      if (miss) setMissing(miss)
      setError('')
      persist({ items: list, aisles: a, members: m, ...(miss ? { missing: miss } : {}) })
    } catch (e) {
      if (n !== loadSeq.current) return
      const cached = cacheGet<Cache>(cacheKey)
      if (cached && itemsRef.current === null) {
        setItems(cached.items)
        setAisles(cached.aisles)
        setMembers(cached.members)
        setMissing(cached.missing)
      } else if (!cached && itemsRef.current === null) {
        setItems([])
      }
      if (navigator.onLine) setError((e as Error).message)
    }
  }, [household, week, thisWeek, cacheKey, persist])

  useEffect(() => {
    // Affichage immédiat depuis le cache, puis mise à jour depuis le serveur
    const cached = cacheKey ? cacheGet<Cache>(cacheKey) : null
    setItems(cached?.items ?? null)
    setAisles(cached?.aisles ?? [])
    setMembers(cached?.members ?? [])
    setMissing(cached?.missing ?? [])
    void load(true)
    if (!household) return
    // Regroupe les rafales d'événements (une synchro modifie plusieurs lignes) en un seul rechargement
    let timer: ReturnType<typeof setTimeout> | undefined
    let wantSync = false
    const schedule = (withSync: boolean) => {
      wantSync ||= withSync
      clearTimeout(timer)
      timer = setTimeout(() => { const s = wantSync; wantSync = false; void load(s) }, 300)
    }
    const filter = `household_id=eq.${household.id}`
    // Les suppressions ne peuvent pas être filtrées par foyer côté temps réel : on les écoute sans filtre
    const ch = supabase.channel(`shopping-${week}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'week_items', filter }, () => schedule(true))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'week_items' }, () => schedule(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shopping_items', filter }, () => schedule(false))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'shopping_items' }, () => schedule(false))
      .subscribe()
    return () => { clearTimeout(timer); void supabase.removeChannel(ch) }
  }, [household, week, cacheKey, load])

  useEffect(() => {
    const on = () => { setOnline(true); void load(true) }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const unsub = onQueueChange(setPending)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); unsub() }
  }, [load])

  // ------------------------------------------------------------------ actions (optimistes, avec file hors ligne)

  function patchLocal(id: string, patch: Partial<ShoppingItem>) {
    loadSeq.current++ // un chargement en cours écraserait cette modification
    setItems((list) => {
      const next = (list ?? []).map((i) => (i.id === id ? { ...i, ...patch } : i))
      persist({ items: next })
      return next
    })
  }

  async function safe(fn: () => Promise<unknown>) {
    try { await fn() } catch (e) { setError((e as Error).message); void load(false) }
  }

  function toggle(i: ShoppingItem) {
    const patch = i.checked
      ? { checked: false, checked_by: null, checked_at: null }
      : { checked: true, checked_by: me?.user_id ?? null, checked_at: new Date().toISOString() }
    patchLocal(i.id, patch)
    void safe(() => run({ kind: 'update', table: 'shopping_items', id: i.id, patch }))
  }

  function update(i: ShoppingItem, patch: Partial<ShoppingItem>) {
    patchLocal(i.id, patch)
    setSelected((s) => (s && s.id === i.id ? { ...s, ...patch } : s))
    void safe(() => run({ kind: 'update', table: 'shopping_items', id: i.id, patch }))
  }

  async function setAisle(i: ShoppingItem, aisleId: string | null) {
    update(i, { aisle_id: aisleId })
    // Le rayon est mémorisé sur l'ingrédient : il servira pour les prochaines listes
    if (i.ingredient_id) await safe(() => run({ kind: 'update', table: 'ingredients', id: i.ingredient_id!, patch: { aisle_id: aisleId } }))
  }

  async function setStaple(i: ShoppingItem, value: boolean) {
    update(i, { is_staple: value })
    if (i.ingredient_id) await safe(() => run({ kind: 'update', table: 'ingredients', id: i.ingredient_id!, patch: { is_staple: value } }))
  }

  function remove(i: ShoppingItem) {
    setSelected(null)
    loadSeq.current++
    setItems((list) => {
      const next = (list ?? []).filter((x) => x.id !== i.id)
      persist({ items: next })
      return next
    })
    void safe(() => run({ kind: 'delete', table: 'shopping_items', id: i.id }))
  }

  function addManual(e: FormEvent) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label || !household) return
    const known = ingredients.find((x) => ingKey(x.name) === ingKey(label))
    const row: ShoppingItem = {
      id: crypto.randomUUID(), household_id: household.id, week_start: week, origin: 'manual', ingredient_id: null,
      label: label.charAt(0).toUpperCase() + label.slice(1), quantity: null, unit: null,
      aisle_id: known?.aisle_id ?? guessAisle(label, aisles), sources: [], is_staple: false, hidden: false,
      checked: false, checked_by: null, checked_at: null, created_at: new Date().toISOString(),
    }
    setNewLabel('')
    loadSeq.current++
    setItems((list) => {
      const next = [...(list ?? []), row]
      persist({ items: next })
      return next
    })
    const { id, household_id, week_start, origin, label: l, aisle_id } = row
    void safe(() => run({ kind: 'insert', table: 'shopping_items', row: { id, household_id, week_start, origin, label: l, aisle_id } }))
  }

  // ------------------------------------------------------------------ affichage

  const aisleOrder = useMemo(() => new Map(aisles.map((a) => [a.id, a])), [aisles])
  const memberName = (uid: string | null) => members.find((m) => m.user_id === uid)?.display_name ?? ''

  const groups = useMemo(() => {
    const toBuy = (items ?? []).filter((i) => !i.checked && !i.hidden && !i.is_staple)
    const map = new Map<string, ShoppingItem[]>()
    for (const i of toBuy) {
      const k = i.aisle_id && aisleOrder.has(i.aisle_id) ? i.aisle_id : ''
      map.set(k, [...(map.get(k) ?? []), i])
    }
    return [...map.entries()]
      .sort(([a], [b]) => (aisleOrder.get(a)?.position ?? 999) - (aisleOrder.get(b)?.position ?? 999))
      .map(([k, list]) => ({ name: aisleOrder.get(k)?.name ?? 'Sans rayon', list: list.sort((x, y) => x.label.localeCompare(y.label, 'fr')) }))
  }, [items, aisleOrder])

  const staples = (items ?? []).filter((i) => i.is_staple && !i.checked && !i.hidden)
  const done = (items ?? []).filter((i) => i.checked && !i.hidden)
    .sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''))
  const hidden = (items ?? []).filter((i) => i.hidden)
  const remaining = groups.reduce((n, g) => n + g.list.length, 0)

  const goWeek = (s: string) => setParams(s === thisWeek ? {} : { s }, { replace: true })

  // Fonction de rendu (et non composant défini ici) : sinon chaque rendu démonte et recrée toutes les lignes
  const row = (i: ShoppingItem) => (
    <li key={i.id} className={i.checked ? 'shop-row done' : 'shop-row'}>
      <button className="shop-check" onClick={() => toggle(i)} aria-pressed={i.checked}>
        <span className="box" aria-hidden>{i.checked ? '✓' : ''}</span>
        <span className="shop-main">
          <span className="shop-label">{i.label}</span>
          {formatAmount(i.quantity, i.unit) && <span className="shop-qty">{formatAmount(i.quantity, i.unit)}</span>}
          {i.checked && i.checked_by && i.checked_by !== me?.user_id && <span className="muted small"> · {memberName(i.checked_by)}</span>}
        </span>
      </button>
      <button className="btn ghost icon shop-more" onClick={() => setSelected(i)} aria-label={`Options pour ${i.label}`}>⋯</button>
    </li>
  )

  return (
    <section className="page">
      <div className="week-nav">
        <button className="btn ghost icon" onClick={() => goWeek(addDays(week, -7))} aria-label="Semaine précédente">‹</button>
        <div className="week-title">
          <h1>Courses</h1>
          <div className="muted small">{relativeWeek(week)} · {weekLabel(week)}</div>
        </div>
        <button className="btn ghost icon" onClick={() => goWeek(addDays(week, 7))} aria-label="Semaine suivante">›</button>
      </div>

      {(!online || pending > 0) && (
        <div className="offline-banner" role="status">
          {online ? 'Envoi des modifications…' : 'Hors ligne'}
          {pending > 0 && ` · ${pending} modification${pending > 1 ? 's' : ''} en attente`}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {missing.length > 0 && (
        <p className="warn small">⚠️ Sans ingrédients saisis, donc absentes de la liste : {missing.join(', ')}.</p>
      )}

      <form className="row" onSubmit={addManual}>
        <input style={{ flex: 1, minWidth: 0 }} value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Ajouter un article (lait, éponges…)" aria-label="Ajouter un article" enterKeyHint="done" />
        <button className="btn primary" disabled={!newLabel.trim()}>Ajouter</button>
      </form>

      {items === null ? <p className="muted">Chargement…</p> : items.length === 0 ? (
        <div className="empty">
          La liste est vide.<br />
          <Link to={week === thisWeek ? '/semaine' : `/semaine?s=${week}`}>Ajoute des recettes à la semaine</Link> et elle se remplira toute seule.
        </div>
      ) : (
        <>
          {remaining === 0 && done.length > 0 && <div className="empty">🎉 Tout est dans le chariot.</div>}
          {groups.map((g) => (
            <div key={g.name} className="aisle">
              <h2 className="aisle-title">{g.name} <span className="muted small">{g.list.length}</span></h2>
              <ul className="shop-list">{g.list.map(row)}</ul>
            </div>
          ))}

          {staples.length > 0 && (
            <details className="aisle collapsible">
              <summary><h2 className="aisle-title">🧂 Placard, à vérifier <span className="muted small">{staples.length}</span></h2></summary>
              <ul className="shop-list">{staples.map(row)}</ul>
            </details>
          )}

          {done.length > 0 && (
            <details className="aisle collapsible">
              <summary><h2 className="aisle-title">✓ Dans le chariot <span className="muted small">{done.length}</span></h2></summary>
              <ul className="shop-list">{done.map(row)}</ul>
            </details>
          )}

          {hidden.length > 0 && (
            <details className="aisle collapsible">
              <summary><h2 className="aisle-title muted">Déjà à la maison <span className="small">{hidden.length}</span></h2></summary>
              <ul className="plain">
                {hidden.map((i) => (
                  <li key={i.id} className="row between">
                    <span className="muted">{i.label} {formatAmount(i.quantity, i.unit)}</span>
                    <button className="btn ghost small-btn" onClick={() => update(i, { hidden: false })}>Remettre</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {selected && (
        <Sheet title={selected.label} onClose={() => setSelected(null)}>
          <div className="stack">
            {formatAmount(selected.quantity, selected.unit) && <div className="shop-qty big">{formatAmount(selected.quantity, selected.unit)}</div>}
            {selected.sources.length > 0 && <p className="muted small" style={{ margin: 0 }}>Pour : {selected.sources.join(', ')}</p>}
            {selected.origin === 'manual' && <p className="muted small" style={{ margin: 0 }}>Ajouté à la main</p>}
            <label className="field">
              <span>Rayon</span>
              <select value={selected.aisle_id ?? ''} onChange={(e) => void setAisle(selected, e.target.value || null)}>
                <option value="">Sans rayon</option>
                {aisles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {selected.ingredient_id && <small className="muted">Retenu pour les prochaines listes.</small>}
            </label>
            {selected.ingredient_id && (
              <label className="toggle-row">
                <input type="checkbox" checked={selected.is_staple} onChange={(e) => void setStaple(selected, e.target.checked)} />
                <span>Produit du placard <span className="muted small">(sel, huile… : rangé à part, à vérifier)</span></span>
              </label>
            )}
            {selected.origin === 'menu' ? (
              <button className="btn" onClick={() => { update(selected, { hidden: !selected.hidden }); setSelected(null) }}>
                {selected.hidden ? 'Remettre dans la liste' : "J'en ai déjà à la maison"}
              </button>
            ) : (
              <button className="btn ghost danger" onClick={() => remove(selected)}>Supprimer</button>
            )}
          </div>
        </Sheet>
      )}
    </section>
  )
}
