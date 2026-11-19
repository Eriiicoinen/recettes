import { BookOpen, Camera, Check, Pencil, ShoppingBasket, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { guessAisle } from '../lib/aisleGuess'
import ImportProgress, { type ImportKind } from '../components/ImportProgress'
import { adaptRecipe, findBySource, importPhotos, importRecipe, splitInput } from '../lib/importRecipe'
import { parseIngredientLine } from '../lib/parseLine'
import {
  CATEGORIES, emptyDraft, formatDuration, getRecipe, listAisles, listIngredients, ingKey, parseQty, saveRecipe, SEASONS, UNITS, yieldLabel,
  type Aisle, type Ingredient, type RecipeDraft, type RecipeLine,
} from '../lib/recipes'
import { removeRecipePhoto, setRecipePhoto } from '../lib/photos'
import { useSession } from '../lib/session'

type Row = { key: number; qty: string; unit: string; name: string; aisle_id: string | null; aisleTouched: boolean }
let nextKey = 1
const toRow = (l: RecipeLine): Row => ({
  key: nextKey++, qty: formatQtyInput(l.quantity), unit: l.unit ?? '',
  name: l.note ? `${l.name}, ${l.note}` : l.name, aisle_id: l.aisle_id ?? null, aisleTouched: false,
})
const blankRow = (): Row => ({ key: nextKey++, qty: '', unit: '', name: '', aisle_id: null, aisleTouched: false })

function formatQtyInput(n: number | null) {
  return n == null ? '' : String(Math.round(n * 1000) / 1000).replace('.', ',')
}

/** "Oignon, émincé" → nom "Oignon" + note "émincé" */
function splitName(s: string) {
  const i = s.indexOf(',')
  return i > 0 ? { name: s.slice(0, i).trim(), note: s.slice(i + 1).trim() || null } : { name: s.trim(), note: null }
}

export default function RecipeEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { household, session } = useSession()
  const [draft, setDraft] = useState<RecipeDraft>(() => ({ ...emptyDraft(), is_simple: /[?&]simple=1/.test(window.location.hash) }))
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [stepsText, setStepsText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [aisles, setAisles] = useState<Aisle[]>([])
  const [paste, setPaste] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  // Photo choisie (envoyée après l'enregistrement, quand la recette a son identifiant) ou retirée
  const [photo, setPhoto] = useState<{ file: File; preview: string } | 'remove' | null>(null)
  const [error, setError] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [importInput, setImportInput] = useState(() => searchParams.get('import') ?? '')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [imported, setImported] = useState(false)
  // Après un import : aperçu de la fiche ; le formulaire complet seulement sur « Modifier »
  const [reviewing, setReviewing] = useState(false)
  const [importKind, setImportKind] = useState<ImportKind>('url')
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null)
  const autoImportDone = useRef(false)

  useEffect(() => {
    if (!household) return
    void listIngredients(household.id).then(setIngredients)
    void listAisles(household.id).then(setAisles)
  }, [household])

  async function runImport(input: string | File[] | { adapt: string; request: string } = importInput) {
    if (!household) return
    if (typeof input === 'string' ? !input.trim() : Array.isArray(input) ? !input.length : !input.request) return
    setImportKind(typeof input === 'string' ? (splitInput(input).url ? 'url' : 'text') : Array.isArray(input) ? 'photo' : 'adapt')
    setImporting(true)
    setImportError('')
    setDuplicate(null)
    try {
      const a = aisles.length ? aisles : await listAisles(household.id)
      const { draft: d, lines } = typeof input === 'string' ? await importRecipe(input, a)
        : Array.isArray(input) ? await importPhotos(input, a) : await adaptRecipe(input.adapt, input.request, a)
      setDraft(d)
      setRows([...lines.map(toRow), blankRow()])
      setStepsText(d.steps.join('\n'))
      setTagsText(d.tags.join(', '))
      setImported(true)
      setReviewing(true)
      window.scrollTo(0, 0)
      setDuplicate(await findBySource(household.id, d.source_url))
    } catch (e) {
      setImportError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  // Arrivée depuis le bouton Partager du téléphone : import automatique
  useEffect(() => {
    const shared = searchParams.get('import')
    const adaptId = searchParams.get('adapt')
    const request = searchParams.get('demande')
    if ((!shared && !(adaptId && request)) || !household || autoImportDone.current) return
    autoImportDone.current = true
    setSearchParams({}, { replace: true })
    // « Adapter avec Claude » depuis une fiche : variante enregistrée comme nouvelle recette
    void runImport(adaptId && request ? { adapt: adaptId, request } : shared!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household])

  useEffect(() => {
    if (!id) return
    void getRecipe(id).then((r) => {
      if (!r) { setLoadError('Recette introuvable.'); return }
      const { recipe, lines } = r
      setDraft({ ...emptyDraft(), ...recipe, lines: [] })
      setRows(lines.length ? [...lines.map(toRow), blankRow()] : [blankRow()])
      setStepsText(recipe.steps.join('\n'))
      setTagsText(recipe.tags.join(', '))
      setLoading(false)
    }).catch((e) => setLoadError((e as Error).message))
  }, [id])

  const known = useMemo(() => new Map(ingredients.map((i) => [ingKey(i.name), i])), [ingredients])

  function set<K extends keyof RecipeDraft>(k: K, v: RecipeDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows((rs) => {
      const next = rs.map((r) => {
        if (r.key !== key) return r
        const merged = { ...r, ...patch }
        if ('name' in patch) {
          const k = known.get(ingKey(splitName(merged.name).name))
          if (k && !merged.unit && k.default_unit) merged.unit = k.default_unit // reprend l'unité habituelle
          if (!merged.aisleTouched) merged.aisle_id = guessAisle(splitName(merged.name).name, aisles)
        }
        return merged
      })
      // Toujours une ligne vide à la fin pour enchaîner la saisie
      if (next[next.length - 1].name.trim()) next.push(blankRow())
      return next
    })
  }

  function removeRow(key: number) {
    setRows((rs) => {
      const next = rs.filter((r) => r.key !== key)
      return next.length && !next[next.length - 1].name.trim() ? next : [...next, blankRow()]
    })
  }

  function applyPaste() {
    const parsed = (paste ?? '').split(/\r?\n/).map(parseIngredientLine).filter((l): l is RecipeLine => !!l)
    if (parsed.length) {
      setRows((rs) => [
        ...rs.filter((r) => r.name.trim()),
        ...parsed.map((l) => ({ ...toRow(l), aisle_id: guessAisle(l.name, aisles) })),
        blankRow(),
      ])
    }
    setPaste(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!household || !session) return
    setSaving(true)
    setError('')
    const lines: RecipeLine[] = rows.filter((r) => r.name.trim()).map((r) => {
      const { name, note } = splitName(r.name)
      return { name, note, quantity: parseQty(r.qty), unit: r.unit.trim() || null, aisle_id: r.aisle_id }
    })
    try {
      const saved = await saveRecipe(household.id, session.user.id, {
        ...draft,
        steps: stepsText.split(/\r?\n/).map((s) => s.replace(/^\s*\d+[.)-](?!\d)\s*/, '')),
        tags: tagsText.split(',').map((t) => t.replace(/^#/, '')),
        lines,
      }, id)
      try {
        if (photo === 'remove') await removeRecipePhoto(saved, draft.photo_url)
        else if (photo) await setRecipePhoto(household.id, saved, photo.file, draft.photo_url)
      } catch { /* la recette est enregistrée ; la photo pourra être ajoutée depuis la fiche */ }
      navigate(`/recettes/${saved}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  // Pas de formulaire vide en cas d'échec : l'enregistrer écraserait la recette
  if (loadError) return <section className="page"><p className="error" role="alert">{loadError}</p><Link to="/recettes">← Recettes</Link></section>
  if (loading) return <section className="page"><p className="muted">Chargement…</p></section>

  const saveBar = (secondary: ReactNode) => (
    <div className="save-bar">
      {secondary}
      <button className="btn primary" disabled={saving || !draft.name.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </div>
  )

  if (reviewing) {
    const lines = rows.filter((r) => r.name.trim())
    const steps = stepsText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    const total = (draft.prep_minutes ?? 0) + (draft.cook_minutes ?? 0)
    return (
      <form className="page" onSubmit={submit}>
        <div className="row between">
          <button type="button" className="btn ghost back" onClick={() => navigate(-1)}>Annuler</button>
        </div>
        <div className="import-done inline-icon"><Check size={18} /> Recette importée : vérifie-la puis enregistre.</div>
        {duplicate && (
          <p className="warn small" style={{ margin: 0 }}>
            Tu as déjà cette recette : <Link to={`/recettes/${duplicate.id}`}>{duplicate.name}</Link>
          </p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <header className="stack" style={{ gap: 6 }}>
          <h1 style={{ margin: 0 }}>{draft.name}</h1>
          <div className="muted small">
            {[draft.is_simple ? 'Repas sans recette' : draft.category, `Pour ${yieldLabel(draft.servings, draft.yield_unit)}`,
              total ? formatDuration(total) : null, draft.seasons.length ? draft.seasons.join(', ') : null].filter(Boolean).join(' · ')}
          </div>
        </header>
        <div className="card stack">
          <h2>{draft.is_simple ? 'À acheter' : 'Ingrédients'} <span className="muted small">{lines.length}</span></h2>
          <ul className="preview-list">
            {lines.map((r) => <li key={r.key}><strong>{[r.qty, r.unit].filter(Boolean).join(' ')}</strong> {r.name}</li>)}
          </ul>
        </div>
        {steps.length > 0 && (
          <div className="card stack">
            <h2>Étapes</h2>
            <ol className="preview-steps">{steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
          </div>
        )}
        {draft.notes && <div className="card"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{draft.notes}</p></div>}
        {saveBar(<button type="button" className="btn" onClick={() => setReviewing(false)}><Pencil size={16} /> Modifier</button>)}
      </form>
    )
  }

  return (
    <form className="page" onSubmit={submit}>
      <div className="row between">
        <button type="button" className="btn ghost back" onClick={() => navigate(-1)}>Annuler</button>
      </div>
      <h1 style={{ margin: 0 }}>{id ? 'Modifier la recette' : 'Nouvelle recette'}</h1>
      {error && <p className="error" role="alert">{error}</p>}

      {!id && !imported && (
        <div className="card stack import-card">
          <h2 className="inline-icon"><Sparkles size={20} /> {importing && importKind === 'adapt' ? 'Adaptation par Claude' : 'Importer'}</h2>
          <textarea rows={3} value={importInput} onChange={(e) => setImportInput(e.target.value)} disabled={importing}
            placeholder="Colle le lien d'une recette (Marmiton, 750g, un blog…) ou le texte complet d'une recette" />
          {importing ? <ImportProgress kind={importKind} /> : (
            <>
              <button type="button" className="btn primary" onClick={() => runImport()} disabled={!importInput.trim()}>Importer</button>
              <label className="btn">
                <Camera size={18} /> Depuis une photo (livre, fiche…)
                <input type="file" accept="image/*" multiple hidden
                  onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; void runImport(f) }} />
              </label>
            </>
          )}
          {importError && <p className="error" role="alert" style={{ margin: 0 }}>{importError}</p>}
          <p className="muted small" style={{ margin: 0 }}>Ou remplis la fiche à la main ci-dessous.</p>
        </div>
      )}
      {imported && duplicate && (
        <p className="warn small" style={{ margin: 0 }}>Tu as déjà cette recette : <Link to={`/recettes/${duplicate.id}`}>{duplicate.name}</Link></p>
      )}

      <div className="segmented" role="group" aria-label="Type">
        <button type="button" className={!draft.is_simple ? 'active' : ''} aria-pressed={!draft.is_simple} onClick={() => set('is_simple', false)}>
          <BookOpen size={16} /> Recette
        </button>
        <button type="button" className={draft.is_simple ? 'active' : ''} aria-pressed={draft.is_simple} onClick={() => set('is_simple', true)}>
          <ShoppingBasket size={16} /> Repas sans recette
        </button>
      </div>
      {draft.is_simple && (
        <p className="muted small" style={{ margin: 0 }}>
          Raclette, fondue, apéro dînatoire, pizzas… Juste la liste de ce qu'il faut acheter. Les quantités s'adaptent au nombre de convives.
        </p>
      )}

      <label className="field">
        <span>Nom</span>
        <input required value={draft.name} onChange={(e) => set('name', e.target.value)}
          placeholder={draft.is_simple ? 'Raclette' : "Minestrone d'hiver"} />
      </label>

      <div className="field">
        <span>Photo du plat</span>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {(photo && photo !== 'remove' ? photo.preview : photo === 'remove' ? null : draft.photo_url) && (
            <img className="thumb big" src={photo && photo !== 'remove' ? photo.preview : draft.photo_url!} alt="" />
          )}
          <label className="btn small-btn">
            <Camera size={16} /> {draft.photo_url || (photo && photo !== 'remove') ? 'Changer' : 'Choisir'}
            <input type="file" accept="image/*" hidden onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) setPhoto({ file: f, preview: URL.createObjectURL(f) })
            }} />
          </label>
          {(draft.photo_url || (photo && photo !== 'remove')) && photo !== 'remove' && (
            <button type="button" className="btn ghost small-btn" onClick={() => setPhoto(draft.photo_url ? 'remove' : null)}>Retirer</button>
          )}
        </div>
      </div>

      <div className="grid-2">
        <label className="field">
          <span>Catégorie</span>
          <select value={draft.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <div className="field">
          <span>Pour</span>
          <div className="yield-row">
            <input type="number" min={1} inputMode="numeric" value={draft.servings} aria-label="Quantité produite"
              onChange={(e) => set('servings', Math.max(1, Number(e.target.value) || 1))} />
            <input list="yield-units" placeholder="personnes" aria-label="Unité (vide = personnes)"
              value={draft.yield_unit ?? ''} onChange={(e) => set('yield_unit', e.target.value || null)} />
            <datalist id="yield-units">
              {['cookies', 'pièces', 'parts', 'muffins', 'crêpes', 'pots', 'verrines', 'cake', 'tarte', 'bocaux'].map((u) => <option key={u} value={u} />)}
            </datalist>
          </div>
        </div>
        {!draft.is_simple && <>
        <label className="field">
          <span>Préparation (min)</span>
          <input type="number" min={0} inputMode="numeric" value={draft.prep_minutes ?? ''}
            onChange={(e) => set('prep_minutes', e.target.value ? Number(e.target.value) : null)} />
        </label>
        <label className="field">
          <span>Cuisson (min)</span>
          <input type="number" min={0} inputMode="numeric" value={draft.cook_minutes ?? ''}
            onChange={(e) => set('cook_minutes', e.target.value ? Number(e.target.value) : null)} />
        </label>
        </>}
      </div>

      <div className="field">
        <span>Saison <small className="muted">(aucune = toute l'année)</small></span>
        <div className="chips">
          {SEASONS.map((s) => {
            const on = draft.seasons.includes(s)
            return (
              <button type="button" key={s} className={on ? 'chip on' : 'chip'} aria-pressed={on}
                onClick={() => set('seasons', on ? draft.seasons.filter((x) => x !== s) : [...draft.seasons, s])}>{s}</button>
            )
          })}
        </div>
      </div>

      <div className="field">
        <span>Note</span>
        <div className="stars" role="radiogroup" aria-label="Note">
          {[1, 2, 3, 4, 5].map((n) => (
            <button type="button" key={n} role="radio" aria-checked={draft.rating === n} aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
              className={draft.rating && n <= draft.rating ? 'star on' : 'star'}
              onClick={() => set('rating', draft.rating === n ? null : n)}>★</button>
          ))}
        </div>
      </div>

      <div className="card stack">
        <div className="row between">
          <h2>{draft.is_simple ? 'À acheter' : 'Ingrédients'}</h2>
          <button type="button" className="btn ghost small-btn" onClick={() => setPaste(paste === null ? '' : null)}>
            {paste === null ? 'Coller une liste' : 'Fermer'}
          </button>
        </div>
        {paste !== null && (
          <div className="stack">
            <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} autoFocus
              placeholder={'Une ligne par ingrédient :\n200 g de farine\n3 œufs\n1 c. à s. d\'huile d\'olive\n2 oignons, émincés'} />
            <button type="button" className="btn" onClick={applyPaste} disabled={!paste.trim()}>Ajouter ces ingrédients</button>
          </div>
        )}
        <datalist id="ing-names">{ingredients.map((i) => <option key={i.id} value={i.name} />)}</datalist>
        <datalist id="ing-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
        <ul className="ing-rows">
          {rows.map((r) => {
            const base = splitName(r.name).name
            const isNew = !!base && !known.has(ingKey(base))
            return (
              <li key={r.key}>
                <div className="ing-row">
                  <input className="ing-qty" inputMode="decimal" placeholder="Qté" aria-label="Quantité"
                    value={r.qty} onChange={(e) => updateRow(r.key, { qty: e.target.value })} />
                  <input className="ing-unit" list="ing-units" placeholder="Unité" aria-label="Unité"
                    value={r.unit} onChange={(e) => updateRow(r.key, { unit: e.target.value })} />
                  <input className="ing-name" list="ing-names" placeholder="Ingrédient, précision" aria-label="Ingrédient"
                    value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} />
                  {r.name.trim() ? (
                    <button type="button" className="btn ghost icon" aria-label="Retirer" onClick={() => removeRow(r.key)}><X size={18} /></button>
                  ) : <span className="icon-spacer" />}
                </div>
                {isNew && (
                  <div className="ing-new small">
                    <span className="muted">Nouvel ingrédient · rayon</span>
                    <select value={r.aisle_id ?? ''} aria-label={`Rayon de ${base}`}
                      onChange={(e) => updateRow(r.key, { aisle_id: e.target.value || null, aisleTouched: true })}>
                      <option value="">—</option>
                      {aisles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <p className="muted small" style={{ margin: 0 }}>
          Astuce : « Oignon, émincé » enregistre l'ingrédient « Oignon » avec la précision « émincé ».
          {rows.some((r) => r.qty && parseQty(r.qty) == null) && <> <span className="error">Une quantité n'est pas un nombre.</span></>}
        </p>
      </div>

      {!draft.is_simple && (
      <label className="field">
        <span>Étapes <small className="muted">(une par ligne)</small></span>
        <textarea rows={8} value={stepsText} onChange={(e) => setStepsText(e.target.value)}
          placeholder={'Émincer les oignons.\nFaire revenir 5 min dans l\'huile.\n…'} />
      </label>
      )}

      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>

      <label className="field">
        <span>Tags <small className="muted">(séparés par des virgules)</small></span>
        <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="végétarien, batch cooking" />
      </label>

      <label className="field">
        <span>Lien source</span>
        <input type="url" inputMode="url" value={draft.source_url ?? ''} onChange={(e) => set('source_url', e.target.value)} placeholder="https://…" />
      </label>

      {saveBar(<button type="button" className="btn ghost" onClick={() => navigate(-1)}>Annuler</button>)}
    </form>
  )
}
