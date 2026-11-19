import { Check, ChevronLeft, ChevronRight, Ellipsis, House, Plus, Repeat, Share2, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Sheet from '../components/Sheet'
import PackEditor from '../components/shopping/PackEditor'
import RecurringSheet from '../components/shopping/RecurringSheet'
import { guessAisle } from '../lib/aisleGuess'
import { cacheGet, cacheSet, flush, onQueueChange, run } from '../lib/offline'
import { ingKey, listAisles, listIngredients, type Aisle, type Ingredient } from '../lib/recipes'
import { useSession } from '../lib/session'
import {
  addRecurring, formatAmount, packAmount, listItems, listRecurring, listText, removeRecurring, syncList, type RecurringItem, type ShoppingItem,
} from '../lib/shopping'
import { useRealtime } from '../lib/realtime'
import { supabase, type Member } from '../lib/supabase'
import { addDays, mondayOf, relativeWeek, todayISO, weekLabel } from '../lib/week'

type Cache = { items: ShoppingItem[]; aisles: Aisle[]; members: Member[]; missing: string[]; ingredients?: Ingredient[] }

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
  const [recurring, setRecurring] = useState<RecurringItem[]>([])
  const [showRecurring, setShowRecurring] = useState(false)
  // Message bref en bas d'écran, avec « Annuler » quand l'action peut être défaite
  const [toast, setToast] = useState<{ msg: string; undo?: () => void } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const showToast = (msg: string, undo?: () => void) => {
    clearTimeout(toastTimer.current)
    setToast({ msg, undo })
    toastTimer.current = setTimeout(() => setToast(null), undo ? 5000 : 2500)
  }
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
      const [list, a, m, ing, rec] = await Promise.all([
        listItems(household.id, week),
        listAisles(household.id),
        supabase.from('household_members').select('household_id, user_id, display_name').eq('household_id', household.id)
          .then(({ data }) => (data ?? []) as Member[]),
        listIngredients(household.id),
        listRecurring(household.id),
      ])
      if (n !== loadSeq.current) return
      setItems(list)
      setAisles(a)
      setMembers(m)
      setIngredients(ing)
      setRecurring(rec)
      if (miss) setMissing(miss)
      setError('')
      persist({ items: list, aisles: a, members: m, ingredients: ing, ...(miss ? { missing: miss } : {}) })
    } catch (e) {
      if (n !== loadSeq.current) return
      const cached = cacheGet<Cache>(cacheKey)
      if (cached && itemsRef.current === null) {
        setItems(cached.items)
        setAisles(cached.aisles)
        setMembers(cached.members)
        setMissing(cached.missing)
        setIngredients(cached.ingredients ?? [])
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
    setIngredients(cached?.ingredients ?? [])
    void load(true)
    const b = burst.current
    return () => { clearTimeout(b.timer) }
  }, [household, week, cacheKey, load])

  // Regroupe les rafales d'événements (une synchro modifie plusieurs lignes) en un seul rechargement ;
  // le menu ou les articles réguliers changent → recalcul de la liste, sinon simple relecture
  const burst = useRef<{ timer?: ReturnType<typeof setTimeout>; sync: boolean }>({ sync: false })
  const filter = `household_id=eq.${household?.id}`
  useRealtime(household && `shopping-${week}`, [
    { table: 'week_items', filter }, { table: 'shopping_items', filter }, { table: 'recurring_items', filter },
  ], (table) => {
    const b = burst.current
    b.sync ||= table !== 'shopping_items'
    clearTimeout(b.timer)
    b.timer = setTimeout(() => { const s = b.sync; b.sync = false; void load(s) }, 300)
  })

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

  function toggle(i: ShoppingItem, withUndo = true) {
    const patch = i.checked
      ? { checked: false, checked_by: null, checked_at: null }
      : { checked: true, checked_by: me?.user_id ?? null, checked_at: new Date().toISOString() }
    patchLocal(i.id, patch)
    void safe(() => run({ kind: 'update', table: 'shopping_items', id: i.id, patch }))
    if (!i.checked) {
      navigator.vibrate?.(10)
      if (withUndo) showToast(`${i.label} : dans le chariot`, () => toggle({ ...i, ...patch }, false))
    }
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

  async function setPack(i: ShoppingItem, size: number | null, label: string | null) {
    if (!i.ingredient_id) return
    const patch = { pack_size: size, pack_label: label, pack_unit: size ? i.unit ?? '' : null }
    setIngredients((list) => list.map((x) => (x.id === i.ingredient_id ? { ...x, ...patch } : x)))
    await safe(() => run({ kind: 'update', table: 'ingredients', id: i.ingredient_id!, patch }))
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
    showToast(`${i.label} supprimé`, () => {
      // Annuler : la même ligne revient (même identifiant)
      loadSeq.current++
      setItems((list) => {
        const next = [...(list ?? []), i]
        persist({ items: next })
        return next
      })
      const { id, household_id, week_start, origin, label, aisle_id, quantity, unit } = i
      void safe(() => run({ kind: 'insert', table: 'shopping_items', row: { id, household_id, week_start, origin, label, aisle_id, quantity, unit } }))
    })
  }

  function hide(i: ShoppingItem) {
    setSelected(null)
    update(i, { hidden: true })
    showToast(`${i.label} : retiré de la liste`, () => update({ ...i, hidden: true }, { hidden: false }))
  }

  /** Article à racheter chaque semaine : retenu, et ajouté automatiquement aux prochaines listes */
  async function makeRecurring(i: ShoppingItem) {
    setSelected(null)
    await safe(async () => {
      const r = await addRecurring(household!.id, i.label, i.aisle_id)
      if (i.origin === 'manual') await supabase.from('shopping_items').update({ origin: 'recurring', recurring_id: r.id }).eq('id', i.id)
      await load(true)
    })
  }

  async function stopRecurring(id: string) {
    setSelected(null)
    await safe(async () => { await removeRecurring(id); await load(false) })
  }

  async function shareList() {
    const text = listText(week, groups, staples, (i) => amounts(i).main)
    try {
      if (navigator.share) await navigator.share({ title: 'Liste de courses', text })
      else { await navigator.clipboard.writeText(text); showToast('Liste copiée') }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      try { await navigator.clipboard.writeText(text); showToast('Liste copiée') } catch { showToast('Partage impossible sur cet appareil.') }
    }
  }

  function addManual(e: FormEvent) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label || !household) return
    const known = ingredients.find((x) => ingKey(x.name) === ingKey(label))
    const row: ShoppingItem = {
      id: crypto.randomUUID(), household_id: household.id, week_start: week, origin: 'manual', ingredient_id: null, recurring_id: null,
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
  const ingById = useMemo(() => new Map(ingredients.map((x) => [x.id, x])), [ingredients])
  /** Quantité à prendre en magasin (« 2 paquets de 150 g ») et quantité exacte nécessaire. */
  const amounts = (i: ShoppingItem) => {
    const exact = formatAmount(i.quantity, i.unit)
    const pack = i.ingredient_id ? packAmount(i.quantity, i.unit, ingById.get(i.ingredient_id)) : null
    return { main: pack ?? exact, detail: pack ? exact : '' }
  }
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
        <span className="box" aria-hidden>{i.checked && <Check size={18} strokeWidth={3} />}</span>
        <span className="shop-main">
          <span className="shop-label">{i.label}{i.origin === 'recurring' && <Repeat size={14} className="muted recurring-mark" aria-label="chaque semaine" />}</span>
          {amounts(i).main && <span className="shop-qty">{amounts(i).main}</span>}
          {amounts(i).detail && <span className="muted small">({amounts(i).detail})</span>}
          {i.checked && i.checked_by && i.checked_by !== me?.user_id && <span className="muted small"> · {memberName(i.checked_by)}</span>}
        </span>
      </button>
      <button className="btn ghost icon shop-more" onClick={() => setSelected(i)} aria-label={`Options pour ${i.label}`}><Ellipsis size={20} /></button>
    </li>
  )

  return (
    <section className="page">
      <div className="shop-head">
        <div className="week-nav">
          <button className="btn ghost icon" onClick={() => goWeek(addDays(week, -7))} aria-label="Semaine précédente"><ChevronLeft size={24} /></button>
          <div className="week-title">
            <h1>Courses</h1>
            <div className="muted small">{relativeWeek(week)} · {weekLabel(week)}</div>
          </div>
          <button className="btn ghost icon" onClick={() => goWeek(addDays(week, 7))} aria-label="Semaine suivante"><ChevronRight size={24} /></button>
        </div>
        {items && items.length > 0 && (
          <div className="shop-count">
            <span><strong>{remaining}</strong> à acheter{done.length ? <span className="muted"> · {done.length} dans le chariot</span> : null}</span>
            {remaining > 0 && <button className="btn ghost small-btn" onClick={shareList}><Share2 size={16} /> Partager</button>}
          </div>
        )}
      </div>

      {(!online || pending > 0) && (
        <div className="offline-banner" role="status">
          {online ? 'Envoi des modifications…' : 'Hors ligne'}
          {pending > 0 && ` · ${pending} modification${pending > 1 ? 's' : ''} en attente`}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {missing.length > 0 && (
        <p className="warn small inline-icon"><TriangleAlert size={16} /> Sans ingrédients saisis, donc absentes de la liste : {missing.join(', ')}.</p>
      )}


      {items === null ? <p className="muted">Chargement…</p> : items.length === 0 ? (
        <div className="empty">
          La liste est vide.<br />
          <Link to={week === thisWeek ? '/semaine' : `/semaine?s=${week}`}>Ajoute des recettes à la semaine</Link> et elle se remplira toute seule.
        </div>
      ) : (
        <>
          {remaining === 0 && done.length > 0 && <div className="empty">Tout est dans le chariot. Bonnes courses !</div>}
          {groups.map((g) => (
            <div key={g.name} className="aisle">
              <h2 className="aisle-title">{g.name} <span className="muted small">{g.list.length}</span></h2>
              <ul className="shop-list">{g.list.map(row)}</ul>
            </div>
          ))}

          {staples.length > 0 && (
            <details className="aisle collapsible">
              <summary><h2 className="aisle-title">Placard, à vérifier <span className="muted small">{staples.length}</span></h2></summary>
              <ul className="shop-list">{staples.map(row)}</ul>
            </details>
          )}

          {done.length > 0 && (
            <details className="aisle collapsible">
              <summary><h2 className="aisle-title">Dans le chariot <span className="muted small">{done.length}</span></h2></summary>
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

      <button className="btn ghost small-btn" style={{ alignSelf: 'center' }} onClick={() => setShowRecurring(true)}>
        <Repeat size={16} /> Articles de chaque semaine{recurring.length ? ` (${recurring.length})` : ''}
      </button>

      <form className="add-bar" onSubmit={addManual}>
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Ajouter un article…" aria-label="Ajouter un article" enterKeyHint="done" />
        <button className="btn primary icon" disabled={!newLabel.trim()} aria-label="Ajouter"><Plus size={22} /></button>
      </form>

      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && (
            <button className="btn ghost small-btn" onClick={() => { toast.undo!(); setToast(null); clearTimeout(toastTimer.current) }}>Annuler</button>
          )}
        </div>
      )}

      {showRecurring && household && (
        <RecurringSheet
          items={recurring}
          onClose={() => setShowRecurring(false)}
          onAdd={(label) => safe(async () => {
            const known = ingredients.find((x) => ingKey(x.name) === ingKey(label))
            await addRecurring(household.id, label, known?.aisle_id ?? guessAisle(label, aisles))
            await load(true)
          })}
          onRemove={(id) => stopRecurring(id)}
        />
      )}

      {selected && (
        <Sheet title={selected.label} onClose={() => setSelected(null)}>
          <div className="stack">
            {amounts(selected).main && (
              <div><span className="shop-qty big">{amounts(selected).main}</span>
                {amounts(selected).detail && <span className="muted"> · il en faut {amounts(selected).detail}</span>}</div>
            )}
            {selected.sources.length > 0 && <p className="muted small" style={{ margin: 0 }}>Pour : {selected.sources.join(', ')}</p>}
            {selected.origin === 'recurring' && <p className="muted small inline-icon" style={{ margin: 0 }}><Repeat size={14} /> Ajouté chaque semaine</p>}

            <div className="sheet-section">Cette semaine</div>
            {selected.origin === 'manual' ? (
              <button className="btn" onClick={() => remove(selected)}><Trash2 size={16} /> Supprimer de la liste</button>
            ) : selected.hidden ? (
              <button className="btn" onClick={() => { update(selected, { hidden: false }); setSelected(null) }}>Remettre dans la liste</button>
            ) : (
              <button className="btn" onClick={() => hide(selected)}>
                <House size={16} /> {selected.origin === 'recurring' ? 'Pas besoin cette semaine' : "J'en ai déjà à la maison"}
              </button>
            )}

            <div className="sheet-section">Toujours <span className="muted small">(retenu pour les prochaines listes)</span></div>
            <label className="field">
              <span>Rayon</span>
              <select value={selected.aisle_id ?? ''} onChange={(e) => void setAisle(selected, e.target.value || null)}>
                <option value="">Sans rayon</option>
                {aisles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {selected.ingredient_id && selected.origin === 'menu' && (
              <PackEditor key={selected.id} unit={selected.unit}
                size={(() => { const g = ingById.get(selected.ingredient_id!); return g && (g.pack_unit ?? '') === (selected.unit ?? '') ? g.pack_size : null })()}
                label={ingById.get(selected.ingredient_id)?.pack_label ?? null}
                onSave={(size, label) => void setPack(selected, size, label)} />
            )}
            {selected.ingredient_id && (
              <label className="toggle-row">
                <input type="checkbox" checked={selected.is_staple} onChange={(e) => void setStaple(selected, e.target.checked)} />
                <span>Produit du placard <span className="muted small">(on en a toujours : rangé à part, à vérifier)</span></span>
              </label>
            )}
            {selected.origin === 'manual' && (
              <button className="btn" onClick={() => void makeRecurring(selected)}><Repeat size={16} /> En acheter chaque semaine</button>
            )}
            {selected.origin === 'recurring' && selected.recurring_id && (
              <button className="btn ghost" onClick={() => void stopRecurring(selected.recurring_id!)}>Ne plus l'ajouter chaque semaine</button>
            )}
          </div>
        </Sheet>
      )}
    </section>
  )
}
