import { useEffect, useState } from 'react'
import { listPastWeeks, relativeWeek, weekLabel, type PastWeek } from '../../lib/week'
import Sheet from '../Sheet'

/** Choix d'une semaine passée dont on reprend le menu. */
export default function CopyWeekSheet({ householdId, before, onPick, onClose }: {
  householdId: string; before: string; onPick: (w: PastWeek) => void; onClose: () => void
}) {
  const [weeks, setWeeks] = useState<PastWeek[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listPastWeeks(householdId, before).then(setWeeks).catch((e) => setError((e as Error).message))
  }, [householdId, before])

  return (
    <Sheet title="Reprendre une semaine" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Mêmes plats, mêmes jours, mêmes quantités. Les créneaux déjà remplis et les jours passés ne sont pas touchés.
        </p>
        {error && <p className="error">{error}</p>}
        {weeks === null && !error ? <p className="muted">Chargement…</p> : weeks?.length === 0 ? (
          <p className="muted">Aucune semaine passée avec un menu.</p>
        ) : weeks?.map((w) => {
          const names = [...new Set(w.items.map((i) => i.recipes?.name ?? i.free_text).filter(Boolean))]
          return (
            <button key={w.start} className="pick-row copy-week" onClick={() => onPick(w)}>
              <span>
                <strong>{relativeWeek(w.start)}</strong> <span className="muted small">({weekLabel(w.start)})</span>
                <span className="muted small copy-week-names">{names.slice(0, 6).join(' · ')}{names.length > 6 ? ' …' : ''}</span>
              </span>
              <span className="muted small">{w.items.length} repas</span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
