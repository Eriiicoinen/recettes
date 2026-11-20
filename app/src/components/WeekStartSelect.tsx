import { useState } from 'react'
import { useSession } from '../lib/session'
import { changeWeekStart, DOW_NAMES } from '../lib/week'

// Ordre d'affichage : lundi → dimanche
const ORDER = [1, 2, 3, 4, 5, 6, 0]

/** « La semaine commence le … » : change la découpe du menu et des courses pour tout le foyer. */
export default function WeekStartSelect({ compact = false }: { compact?: boolean }) {
  const { household, reloadHousehold } = useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!household) return null

  async function change(dow: number) {
    setBusy(true)
    setError('')
    try {
      await changeWeekStart(household!.id, dow)
      await reloadHousehold()
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className={compact ? 'week-start compact' : 'week-start'}>
      <label className="inline-icon">
        <span className={compact ? 'muted small' : ''}>La semaine commence le</span>
        <select value={household.week_start_dow} disabled={busy} onChange={(e) => void change(Number(e.target.value))}
          className={compact ? 'chip' : undefined} aria-label="Jour de début de semaine">
          {ORDER.map((d) => <option key={d} value={d}>{DOW_NAMES[d]}</option>)}
        </select>
      </label>
      {busy && <span className="muted small">Regroupement…</span>}
      {error && <span className="error small">{error}</span>}
    </div>
  )
}
