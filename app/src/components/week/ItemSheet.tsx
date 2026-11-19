import { Link } from 'react-router-dom'
import { yieldLabel, type Recipe } from '../../lib/recipes'
import { dayLabel, defaultServings, type WeekItem } from '../../lib/week'
import Sheet from '../Sheet'

/** Actions sur un repas de la semaine : quantité, invités, restes, déplacer, retirer. */
export default function ItemSheet({ item, name, recipe, people, hasLeftovers, onClose, onServings, onMove, onToBasket, onLeftovers, onRemove }: {
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
