import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import Sheet from './Sheet'

const PRESETS = ['Végétarienne', 'Sans lactose', 'Sans gluten', 'Plus légère', 'Pour les enfants', 'Plus rapide', 'Pour 2 personnes', 'Sans four']

/** « Adapter avec Claude » : la demande ; la variante s'ouvre ensuite en aperçu, prête à enregistrer. */
export default function AdaptSheet({ onAdapt, onClose }: { onAdapt: (request: string) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  return (
    <Sheet title="Adapter avec Claude" onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>
          Claude réécrit la recette selon ta demande. Tu la vérifies, puis elle est enregistrée comme nouvelle fiche ; l'originale ne change pas.
        </p>
        <div className="row wrap" style={{ gap: 6 }}>
          {PRESETS.map((p) => (
            <button key={p} className="chip" onClick={() => onAdapt(`Version ${p.toLowerCase()}`)}>{p}</button>
          ))}
        </div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAdapt(text.trim()) }}>
          <label className="field">
            <span>Ou ta demande</span>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300}
              placeholder="Avec du poulet à la place du bœuf, sans oignon…" />
          </label>
          <button className="btn primary" disabled={!text.trim()}><Sparkles size={18} /> Adapter</button>
        </form>
      </div>
    </Sheet>
  )
}
