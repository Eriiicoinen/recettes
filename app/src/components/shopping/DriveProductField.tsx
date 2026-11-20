import { ExternalLink, Search } from 'lucide-react'
import { useState } from 'react'
import { parseProductLink, searchUrl, STORE_NAME, type StoreProduct } from '../../lib/drive'

/** Produit habituel au drive pour cet article : lien collé depuis le site du magasin. */
export default function DriveProductField({ label, product, onSave, onForget }: {
  label: string; product: StoreProduct | undefined
  onSave: (url: string, title: string | null) => Promise<void>; onForget: () => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const parsed = parseProductLink(value)
    if (!parsed) { setError(`Colle le lien d'une fiche produit ${STORE_NAME} (il contient « /produit/ »).`); return }
    setBusy(true)
    setError('')
    try { await onSave(parsed.url, parsed.title); setValue('') } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  return (
    <div className="field">
      <span>Produit au drive {STORE_NAME}</span>
      {product ? (
        <div className="drive-product">
          <a href={product.url} target="_blank" rel="noreferrer" className="inline-icon"><ExternalLink size={16} /> {product.title ?? 'Produit habituel'}</a>
          <button type="button" className="btn ghost small-btn" disabled={busy}
            onClick={() => { setBusy(true); void onForget().finally(() => setBusy(false)) }}>Oublier</button>
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: 6 }}>
            <input style={{ flex: 1, minWidth: 0 }} value={value} onChange={(e) => { setValue(e.target.value); setError('') }}
              placeholder="Colle le lien du produit" inputMode="url" aria-label="Lien du produit" />
            <button type="button" className="btn" disabled={busy || !value.trim()} onClick={save}>Retenir</button>
          </div>
          <a className="small inline-icon" href={searchUrl(label)} target="_blank" rel="noreferrer"><Search size={14} /> Chercher « {label} » sur {STORE_NAME}</a>
          <small className="muted">Sur la fiche du produit choisi : Partager → Copier le lien, puis colle-le ici. Ensuite, le bouton ↗ ouvrira directement ce produit.</small>
        </>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  )
}
