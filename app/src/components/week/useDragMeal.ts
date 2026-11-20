import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent } from 'react'
import type { WeekItem } from '../../lib/week'

/** Cible de dépôt : « basket » (à placer) ou « AAAA-MM-JJ|midi ». Les cases portent l'attribut data-drop. */
export type DropKey = string
export type Drag = { item: WeekItem; label: string; x: number; y: number; over: DropKey | null }

const HOLD_MS = 350
const SLOP_PX = 8

/**
 * Glisser-déposer au doigt (et à la souris) :
 * appui long sur un repas → il se décolle et suit le doigt → relâcher sur une case le déplace.
 * Bouger avant la fin de l'appui long = défilement normal de la page.
 */
export function useDragMeal(onDrop: (item: WeekItem, target: DropKey) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const st = useRef<{ timer?: ReturnType<typeof setTimeout>; x: number; y: number; item?: WeekItem; label: string; active: boolean; fired: boolean; raf: number; lastY: number }>(
    { x: 0, y: 0, label: '', active: false, fired: false, raf: 0, lastY: 0 })
  const dropRef = useRef(onDrop)
  useEffect(() => { dropRef.current = onDrop }, [onDrop])

  useEffect(() => {
    const s = st.current
    const targetAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop ?? null

    const move = (x: number, y: number, e?: Event) => {
      if (!s.active) {
        // Le doigt bouge avant l'appui long : c'est un défilement, pas un glisser
        if (s.timer && Math.hypot(x - s.x, y - s.y) > SLOP_PX) { clearTimeout(s.timer); s.timer = undefined }
        return
      }
      if (e?.cancelable) e.preventDefault() // bloque le défilement pendant le glisser
      s.lastY = y
      setDrag((d) => (d ? { ...d, x, y, over: targetAt(x, y) } : d))
    }
    const end = (x?: number, y?: number) => {
      clearTimeout(s.timer)
      s.timer = undefined
      if (!s.active) return
      s.active = false
      cancelAnimationFrame(s.raf)
      const over = x != null && y != null ? targetAt(x, y) : null
      const item = s.item
      setDrag(null)
      if (over && item) dropRef.current(item, over)
    }

    const onTouchMove = (e: TouchEvent) => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY, e) }
    const onTouchEnd = (e: TouchEvent) => { const t = e.changedTouches[0]; end(t?.clientX, t?.clientY) }
    const onTouchCancel = () => end()
    const onPointerMove = (e: PointerEvent) => { if (e.pointerType !== 'touch') move(e.clientX, e.clientY, e) }
    const onPointerUp = (e: PointerEvent) => { if (e.pointerType !== 'touch') end(e.clientX, e.clientY) }

    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', onTouchCancel)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      clearTimeout(s.timer)
      cancelAnimationFrame(s.raf)
    }
  }, [])

  /** À brancher sur chaque repas déplaçable ; onTap = appui simple. */
  const handlers = (item: WeekItem, label: string, onTap: () => void) => ({
    onPointerDown: (e: RPointerEvent) => {
      if (e.button !== 0) return
      const s = st.current
      s.x = e.clientX
      s.y = e.clientY
      s.lastY = e.clientY
      s.item = item
      s.label = label
      s.fired = false
      clearTimeout(s.timer)
      s.timer = setTimeout(() => {
        s.timer = undefined
        s.active = true
        s.fired = true
        navigator.vibrate?.(15)
        setDrag({ item, label, x: s.x, y: s.y, over: null })
        cancelAnimationFrame(s.raf)
        // Défilement automatique quand le doigt approche du haut ou du bas de l'écran
        s.raf = requestAnimationFrame(function loop() {
          const edge = 90
          const bottom = window.innerHeight - 80
          if (s.lastY < edge) window.scrollBy(0, -10)
          else if (s.lastY > bottom - edge) window.scrollBy(0, 10)
          if (s.active) s.raf = requestAnimationFrame(loop)
        })
      }, HOLD_MS)
    },
    onContextMenu: (e: RMouseEvent) => e.preventDefault(),
    onClick: () => {
      // Le clic qui suit un glisser n'ouvre pas la fiche du repas
      if (st.current.fired) { st.current.fired = false; return }
      onTap()
    },
  })

  return { drag, handlers }
}
