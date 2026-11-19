import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'

export type ImportKind = 'url' | 'text' | 'photo' | 'adapt'

// Étapes indicatives (l'import est un seul appel au serveur) : elles avancent avec le temps écoulé
const STAGES: Record<ImportKind, [number, string][]> = {
  adapt: [[0, 'Lecture de la recette'], [4, 'Adaptation des ingrédients'], [10, 'Réécriture des étapes'], [18, 'Rangement par rayon']],
  url: [[0, 'Lecture de la page'], [4, 'Repérage des ingrédients'], [10, 'Rédaction des étapes'], [18, 'Rangement par rayon']],
  text: [[0, 'Lecture du texte'], [3, 'Repérage des ingrédients'], [8, 'Rédaction des étapes'], [15, 'Rangement par rayon']],
  photo: [[0, 'Lecture de la photo'], [5, 'Déchiffrage du texte'], [11, 'Repérage des ingrédients'], [18, 'Rédaction des étapes']],
}

/** Avancement de l'import (10 à 30 s) : étapes cochées au fil du temps et barre qui ralentit vers la fin. */
export default function ImportProgress({ kind }: { kind: ImportKind }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t0 = Date.now()
    const iv = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250)
    return () => clearInterval(iv)
  }, [])

  const stages = STAGES[kind]
  const current = stages.reduce((n, [at], i) => (elapsed >= at ? i : n), 0)
  // Approche 92 % sans jamais l'atteindre : la fin réelle arrive avec la réponse
  const pct = 92 * (1 - Math.exp(-elapsed / 12))

  return (
    <div className="import-progress" role="status" aria-live="polite">
      <div className="meter"><span style={{ width: `${pct}%` }} /></div>
      <ul className="plain">
        {stages.map(([, label], i) => (
          <li key={label} className={i < current ? 'done' : i === current ? 'active' : 'todo'}>
            {i < current ? <Check size={16} /> : i === current ? <LoaderCircle size={16} className="spin" /> : <span className="dot" />}
            {label}{i === current ? '…' : ''}
          </li>
        ))}
      </ul>
      {elapsed > 30 && <p className="muted small" style={{ margin: 0 }}>Plus long que d'habitude, encore un instant…</p>}
    </div>
  )
}
