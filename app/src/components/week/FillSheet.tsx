import { useState } from 'react'
import { currentSeason, type Recipe } from '../../lib/recipes'
import { dayLabel, dropProposal, MEALS, proposeWeek, swapProposal, type Meal, type Proposal, type WeekItem } from '../../lib/week'
import Sheet from '../Sheet'

/** « Remplir ma semaine » : propositions modifiables avant validation. */
export default function FillSheet({ start, today, items, recipes, lastCooked, onClose, onApply }: {
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
