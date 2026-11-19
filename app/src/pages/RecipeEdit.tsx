import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { guessAisle } from '../lib/aisleGuess'
import { findBySource, importRecipe } from '../lib/importRecipe'
import { parseIngredientLine } from '../lib/parseLine'
import {
  CATEGORIES, emptyDraft, getRecipe, listAisles, listIngredients, ingKey, parseQty, saveRecipe, SEASONS, UNITS,
  type Aisle, type Ingredient, type RecipeDraft, type RecipeLine,
} from '../lib/recipes'
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
  const [draft, setDraft] = useState<RecipeDraft>(emptyDraft)
  const [rows, setRows] = useState<Row[]>([blankRow()])
  const [stepsText, setStepsText] = useState('')
  const [tagsText, setTagsText] = useState('')
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [aisles, setAisles] = useState<Aisle[]>([])
  const [paste, setPaste] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()
  const [importInput, setImportInput] = useState(() => searchParams.get('import') ?? '')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [imported, setImported] = useState(false)
  const [duplicate, setDuplicate] = useState<{ id: string; name: string } | null>(null)
  const autoImportDone = useRef(false)

  useEffect(() => {
    if (!household) return
    void listIngredients(household.id).then(setIngredients)
    void listAisles(household.id).then(setAisles)
  }, [household])

  async function runImport(input = importInput) {
    if (!household || !input.trim()) return
    setImporting(true)
    setImportError('')
    setDuplicate(null)
    try {
      const a = aisles.length ? aisles : await listAisles(household.id)
      const { draft: d, lines } = await importRecipe(input, a)
      setDraft(d)
      setRows([...lines.map(toRow), blankRow()])
      setStepsText(d.steps.join('\n'))
      setTagsText(d.tags.join(', '))
      setImported(true)
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
    if (!shared || !household || autoImportDone.current) return
    autoImportDone.current = true
    setSearchParams({}, { replace: true })
    void runImport(shared)
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
      navigate(`/recettes/${saved}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  // Pas de formulaire vide en cas d'échec : l'enregistrer écraserait la recette
  if (loadError) return <section className="page"><p className="error" role="alert">{loadError}</p><Link to="/recettes">← Recettes</Link></section>
  if (loading) return <section className="page"><p className="muted">Chargement…</p></section>

  return (
    <form className="page" onSubmit={submit}>
      <div className="row between">
        <button type="button" className="btn ghost back" onClick={() => navigate(-1)}>Annuler</button>
        <button className="btn primary" disabled={saving || !draft.name.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
      <h1 style={{ margin: 0 }}>{id ? 'Modifier la recette' : 'Nouvelle recette'}</h1>
      {error && <p className="error" role="alert">{error}</p>}

      {!id && !imported && (
        <div className="card stack import-card">
          <h2>✨ Importer</h2>
          <textarea rows={3} value={importInput} onChange={(e) => setImportInput(e.target.value)} disabled={importing}
            placeholder="Colle le lien d'une recette (Marmiton, 750g, un blog…) ou le texte complet d'une recette" />
          <button type="button" className="btn primary" onClick={() => runImport()} disabled={importing || !importInput.trim()}>
            {importing ? 'Lecture de la recette…' : 'Importer'}
          </button>
          {importing && <p className="muted small" style={{ margin: 0 }}>Ça prend 10 à 30 secondes.</p>}
          {importError && <p className="error" role="alert" style={{ margin: 0 }}>{importError}</p>}
          <p className="muted small" style={{ margin: 0 }}>Ou remplis la fiche à la main ci-dessous.</p>
        </div>
      )}
      {imported && (
        <div className="card import-done">
          <strong>Recette importée.</strong> Vérifie la fiche, puis touche <strong>Enregistrer</strong>.
          {duplicate && (
            <p style={{ margin: '8px 0 0' }}>
              ⚠️ Tu as déjà cette recette : <Link to={`/recettes/${duplicate.id}`}>{duplicate.name}</Link>
            </p>
          )}
        </div>
      )}

      <label className="field">
        <span>Nom</span>
        <input required value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Minestrone d'hiver" />
      </label>

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
          <h2>Ingrédients</h2>
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
                    <button type="button" className="btn ghost icon" aria-label="Retirer" onClick={() => removeRow(r.key)}>×</button>
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

      <label className="field">
        <span>Étapes <small className="muted">(une par ligne)</small></span>
        <textarea rows={8} value={stepsText} onChange={(e) => setStepsText(e.target.value)}
          placeholder={'Émincer les oignons.\nFaire revenir 5 min dans l\'huile.\n…'} />
      </label>

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

      <button className="btn primary" disabled={saving || !draft.name.trim()}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
    </form>
  )
}
