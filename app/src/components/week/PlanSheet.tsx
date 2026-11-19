import { ChevronRight, Copy, Lightbulb, Plus, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { currentSeason, type Recipe } from '../../lib/recipes'
import { pickIdeas } from '../../lib/week'
import Sheet from '../Sheet'

/** « Planifier » : toutes les façons de remplir la semaine, au même endroit. */
export default function PlanSheet({ recipes, lastCooked, exclude, onFill, onCopy, onAddUnplaced, onAddIdea, onClose }: {
  recipes: Recipe[]; lastCooked: Map<string, string | null>; exclude: Set<string>
  onFill: () => void; onCopy: () => void; onAddUnplaced: () => void; onAddIdea: (r: Recipe) => void; onClose: () => void
}) {
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [ideas, setIdeas] = useState(() => pickIdeas(recipes, lastCooked, exclude, currentSeason()))

  return (
    <Sheet title="Planifier la semaine" onClose={onClose}>
      <div className="stack">
        <button className="plan-option primary" onClick={onFill}>
          <Sparkles size={22} />
          <span><strong>Remplir automatiquement</strong><span className="muted small">Plats de saison, variés, rapides en semaine. Tu valides avant.</span></span>
          <ChevronRight size={18} className="muted" />
        </button>
        <button className="plan-option" onClick={onCopy}>
          <Copy size={22} />
          <span><strong>Reprendre une semaine passée</strong><span className="muted small">Mêmes plats, mêmes jours.</span></span>
          <ChevronRight size={18} className="muted" />
        </button>
        <button className="plan-option" onClick={onAddUnplaced}>
          <Plus size={22} />
          <span><strong>Ajouter une recette sans jour</strong><span className="muted small">Pour les courses ; tu la places plus tard.</span></span>
          <ChevronRight size={18} className="muted" />
        </button>

        {ideas.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row between">
              <h2 className="inline-icon"><Lightbulb size={20} /> Idées du carnet</h2>
              <button className="btn ghost small-btn" onClick={() => { setIdeas(pickIdeas(recipes, lastCooked, new Set([...exclude, ...added]), currentSeason())) }}>
                Autres idées
              </button>
            </div>
            <ul className="plain">
              {ideas.map((r) => (
                <li key={r.id} className="row between">
                  <Link to={`/recettes/${r.id}`} onClick={onClose}>{r.name}</Link>
                  {added.has(r.id) ? <span className="ok small">Ajoutée</span> : (
                    <button className="btn small-btn" onClick={() => { onAddIdea(r); setAdded(new Set([...added, r.id])) }}><Plus size={16} /> Semaine</button>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted small" style={{ margin: 0 }}>De saison, pas cuisinées depuis un mois. Elles arrivent dans « À placer ».</p>
          </div>
        )}
        <Link to="/idees" className="btn soft" onClick={onClose}><Lightbulb size={18} /> Que faire avec ce que j'ai ?</Link>
      </div>
    </Sheet>
  )
}
