import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { askClaude, ideaText, matchBook, type BookMatch, type Idea } from '../lib/ideas'
import { formatDuration, listIngredients, type Ingredient } from '../lib/recipes'
import { useSession } from '../lib/session'

/** « Que faire avec ce que j'ai ? » : recettes du carnet, puis idées de Claude. */
export default function Ideas() {
  const { household } = useSession()
  const navigate = useNavigate()
  const [have, setHave] = useState<string[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('ideas.have') ?? '[]') as string[] } catch { return [] }
  })
  const [input, setInput] = useState('')
  const [known, setKnown] = useState<Ingredient[]>([])
  const [book, setBook] = useState<BookMatch[] | null>(null)
  const [ideas, setIdeas] = useState<Idea[] | null>(null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<number | null>(null)

  useEffect(() => {
    if (household) void listIngredients(household.id).then(setKnown).catch(() => {})
  }, [household])

  useEffect(() => {
    try { sessionStorage.setItem('ideas.have', JSON.stringify(have)) } catch { /* indisponible */ }
    setIdeas(null)
    if (!household || !have.length) { setBook(null); return }
    let cancelled = false
    matchBook(household.id, have).then((m) => { if (!cancelled) setBook(m) }).catch((e) => setError((e as Error).message))
    return () => { cancelled = true }
  }, [have, household])

  function add(e?: FormEvent) {
    e?.preventDefault()
    // « courgettes, feta, œufs » ajoute trois ingrédients d'un coup
    const parts = input.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) return
    setHave((h) => [...h, ...parts.filter((p) => !h.some((x) => x.toLowerCase() === p.toLowerCase()))])
    setInput('')
  }

  async function ask() {
    setAsking(true)
    setError('')
    try { setIdeas(await askClaude(have)) } catch (e) { setError((e as Error).message) }
    setAsking(false)
  }

  return (
    <section className="page">
      <div className="row between">
        <button className="btn ghost back" onClick={() => navigate(-1)}>← Retour</button>
      </div>
      <h1 style={{ margin: 0 }}>Que faire avec ce que j'ai ?</h1>
      <p className="muted small" style={{ margin: 0 }}>Ce qui reste dans le frigo ou les placards. Sel, huile et épices sont supposés acquis.</p>

      <form className="row" onSubmit={add}>
        <input style={{ flex: 1, minWidth: 0 }} value={input} onChange={(e) => setInput(e.target.value)} list="ideas-known"
          placeholder="courgettes, feta, œufs…" aria-label="Ingrédient disponible" enterKeyHint="done" />
        <button className="btn primary" disabled={!input.trim()}>Ajouter</button>
        <datalist id="ideas-known">{known.map((k) => <option key={k.id} value={k.name} />)}</datalist>
      </form>
      {have.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {have.map((h) => (
            <button key={h} className="chip on" onClick={() => setHave(have.filter((x) => x !== h))} aria-label={`Retirer ${h}`}>{h} ×</button>
          ))}
          <button className="chip" onClick={() => setHave([])}>Tout effacer</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {book && (
        <div className="card stack">
          <h2>📖 Dans ton carnet</h2>
          {book.length === 0 ? <p className="muted small" style={{ margin: 0 }}>Aucune recette avec ces ingrédients.</p> : (
            <ul className="plain stack" style={{ gap: 10 }}>
              {book.map((m) => (
                <li key={m.id}>
                  <Link to={`/recettes/${m.id}`}><strong>{m.name}</strong></Link>
                  <div className="muted small">
                    {[`utilise ${m.matched.join(', ')}`, m.minutes ? formatDuration(m.minutes) : null].filter(Boolean).join(' · ')}
                  </div>
                  <div className="small">{m.missing.length ? <>À acheter : {m.missing.join(', ')}</> : <span className="ok">✓ Rien à acheter</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {have.length > 0 && !ideas && (
        <button className="btn" onClick={ask} disabled={asking}>{asking ? 'Claude réfléchit… (10 à 20 s)' : '✨ Idées de Claude'}</button>
      )}
      {ideas && (
        <div className="card stack">
          <div className="row between">
            <h2>✨ Idées de Claude</h2>
            <button className="btn ghost small-btn" onClick={ask} disabled={asking}>{asking ? '…' : 'Autres idées'}</button>
          </div>
          {ideas.map((i, n) => (
            <div key={i.name} className="idea">
              <button className="idea-head" onClick={() => setOpen(open === n ? null : n)} aria-expanded={open === n}>
                <strong>{i.name}</strong>
                <span className="muted small">{i.pitch} · {formatDuration(i.minutes)}</span>
                <span className="small">{i.missing.length ? `À acheter : ${i.missing.join(', ')}` : '✓ Rien à acheter'}</span>
              </button>
              {open === n && (
                <div className="stack" style={{ gap: 6 }}>
                  <ul className="small" style={{ margin: 0 }}>{i.ingredients.map((x) => <li key={x}>{x}</li>)}</ul>
                  <ol className="small" style={{ margin: 0 }}>{i.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  <button className="btn small-btn primary"
                    onClick={() => navigate(`/recettes/nouvelle?import=${encodeURIComponent(ideaText(i))}`)}>
                    ➕ Garder dans mon carnet
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
