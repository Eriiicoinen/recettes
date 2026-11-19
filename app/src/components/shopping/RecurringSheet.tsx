import { useState } from 'react'
import type { RecurringItem } from '../../lib/shopping'
import Sheet from '../Sheet'

/** Articles ajoutés automatiquement à chaque nouvelle semaine (lait, pain, café…). */
export default function RecurringSheet({ items, onClose, onAdd, onRemove }: {
  items: RecurringItem[]; onClose: () => void; onAdd: (label: string) => void; onRemove: (id: string) => void
}) {
  const [label, setLabel] = useState('')
  return (
    <Sheet title="Articles de chaque semaine" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Ajoutés automatiquement à la liste de chaque nouvelle semaine. « Pas besoin cette semaine » les retire juste pour une semaine.
        </p>
        <form className="row" onSubmit={(e) => {
          e.preventDefault()
          const l = label.trim()
          if (!l) return
          onAdd(l.charAt(0).toUpperCase() + l.slice(1))
          setLabel('')
        }}>
          <input style={{ flex: 1, minWidth: 0 }} value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="Lait, pain, café…" aria-label="Nouvel article régulier" />
          <button className="btn primary" disabled={!label.trim()}>Ajouter</button>
        </form>
        {items.length === 0 ? <p className="muted small">Aucun pour l'instant.</p> : (
          <ul className="plain">
            {items.map((r) => (
              <li key={r.id} className="row between">
                <span>{r.label}</span>
                <button className="btn ghost small-btn danger" onClick={() => onRemove(r.id)} aria-label={`Retirer ${r.label}`}>Retirer</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
