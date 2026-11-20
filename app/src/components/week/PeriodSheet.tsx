import { useState } from 'react'
import { addDays, clearCustomPeriod, dayLabel, periodAt, setCustomPeriod } from '../../lib/week'
import Sheet from '../Sheet'
import WeekStartSelect from '../WeekStartSelect'

/** Période sur mesure : date de début + nombre de jours (ex. du samedi au mercredi, 10 jours de vacances…). */
export default function PeriodSheet({ householdId, start, onClose, onSaved }: {
  householdId: string; start: string; onClose: () => void; onSaved: (start: string) => void
}) {
  const current = periodAt(start)
  const [from, setFrom] = useState(current.start)
  const [days, setDays] = useState(current.days)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = addDays(from, days - 1)

  async function run(fn: () => Promise<void>, next: string) {
    setBusy(true)
    setError('')
    try { await fn(); onSaved(next) } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  return (
    <Sheet title="Période" onClose={onClose}>
      <div className="stack">
        <div className="grid-2">
          <label className="field">
            <span>Début</span>
            <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <div className="field">
            <span>Nombre de jours</span>
            <div className="stepper">
              <button type="button" onClick={() => setDays(Math.max(1, days - 1))} aria-label="Un jour de moins">−</button>
              <span>{days} j</span>
              <button type="button" onClick={() => setDays(Math.min(28, days + 1))} aria-label="Un jour de plus">+</button>
            </div>
          </div>
        </div>
        <p className="period-preview">Du <strong>{dayLabel(from)}</strong> au <strong>{dayLabel(end)}</strong></p>
        <p className="muted small" style={{ margin: 0 }}>
          Menu et liste de courses suivent cette période. Les repas déjà prévus gardent leur jour ; la liste de courses se recalcule.
          Après, les semaines normales reprennent (un reste de moins de 4 jours rejoint la semaine voisine).
        </p>
        {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
        <button className="btn primary" disabled={busy} onClick={() => run(() => setCustomPeriod(householdId, from, days), from)}>
          {busy ? 'Regroupement…' : 'Enregistrer la période'}
        </button>
        {current.custom && (
          <button className="btn ghost" disabled={busy} onClick={() => run(() => clearCustomPeriod(householdId, current.start), current.start)}>
            Revenir aux semaines normales
          </button>
        )}
        <div className="sheet-section">Semaines normales</div>
        <WeekStartSelect />
      </div>
    </Sheet>
  )
}
