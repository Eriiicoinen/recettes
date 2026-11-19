import { useState } from 'react'
import { PACK_LABELS, unitKey } from '../../lib/shopping'

/** « Vendu par : [150] g, [paquet] » — retenu sur l'ingrédient pour toutes les listes suivantes. */
export default function PackEditor({ unit, size, label, onSave }: {
  unit: string | null; size: number | null; label: string | null
  onSave: (size: number | null, label: string | null) => void
}) {
  const [value, setValue] = useState(size != null ? String(size) : '')
  const [kind, setKind] = useState(label ?? 'paquet')
  const shown = unitKey(unit) || 'pièces'

  function commit(v = value, k = kind) {
    const n = Number(v.replace(',', '.'))
    onSave(v.trim() && n > 0 ? n : null, v.trim() && n > 0 ? k : null)
  }

  return (
    <div className="field">
      <span>Vendu par <small className="muted">(facultatif : la liste indique alors combien en prendre)</small></span>
      <div className="row" style={{ gap: 6 }}>
        <select value={kind} onChange={(e) => { setKind(e.target.value); if (value.trim()) commit(value, e.target.value) }} aria-label="Conditionnement">
          {PACK_LABELS.map((l) => <option key={l}>{l}</option>)}
        </select>
        <span className="muted">de</span>
        <input style={{ width: 90 }} inputMode="decimal" value={value} placeholder="150"
          onChange={(e) => setValue(e.target.value)} onBlur={() => commit()} aria-label="Contenance" />
        <span className="muted">{shown}</span>
      </div>
    </div>
  )
}
