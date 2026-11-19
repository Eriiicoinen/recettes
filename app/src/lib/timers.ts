import { useCallback, useEffect, useRef, useState } from 'react'

export type Duration = { label: string; seconds: number }

/**
 * Durées trouvées dans une étape : « 20 min », « 1 h 30 », « 1h », « 10 à 15 minutes » (la plus courte, pour vérifier),
 * « 30 secondes ». Les températures (« 180° ») et les quantités ne sont pas prises.
 */
export function findDurations(text: string): Duration[] {
  const out: Duration[] = []
  const re = /(\d+)(?:\s*(?:à|a|-|–|ou)\s*\d+)?\s*(h(?:eures?)?|min(?:utes?)?|mn|sec(?:ondes?)?)(?![a-zà-ÿ])\.?(?:\s*(\d{1,2})(?!\s*(?:°|g\b|cl|ml)))?/gi
  for (const m of text.matchAll(re)) {
    const n = Number(m[1])
    const unit = m[2].toLowerCase()
    let seconds: number
    if (unit.startsWith('h')) seconds = n * 3600 + (m[3] ? Number(m[3]) * 60 : 0)
    else if (unit.startsWith('s')) seconds = n
    else seconds = n * 60
    if (!seconds || seconds > 24 * 3600) continue
    if (out.some((d) => d.seconds === seconds)) continue
    out.push({ seconds, label: formatClock(seconds, true) })
  }
  return out
}

export function formatClock(total: number, short = false) {
  const s = Math.max(0, Math.round(total))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (short) {
    if (h) return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
    if (m) return sec ? `${m} min ${sec} s` : `${m} min`
    return `${sec} s`
  }
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export type Timer = { id: number; label: string; end: number; done: boolean }

/** Minuteurs du mode cuisine. Le temps restant est calculé depuis l'heure de fin : juste même après une mise en veille. */
export function useTimers() {
  const [timers, setTimers] = useState<Timer[]>([])
  const [now, setNow] = useState(() => Date.now())
  const audio = useRef<AudioContext | null>(null)
  const nextId = useRef(1)

  const ring = useCallback((label: string) => {
    navigator.vibrate?.([400, 200, 400, 200, 400])
    const ctx = audio.current
    if (ctx) {
      void ctx.resume()
      for (let i = 0; i < 3; i++) {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.value = 880
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.5)
        g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + i * 0.5 + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.5 + 0.35)
        o.connect(g).connect(ctx.destination)
        o.start(ctx.currentTime + i * 0.5)
        o.stop(ctx.currentTime + i * 0.5 + 0.4)
      }
    }
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification('⏰ Minuteur terminé', { body: label })
      }
    } catch { /* notifications indisponibles */ }
  }, [])

  const active = timers.some((t) => !t.done)
  useEffect(() => {
    if (!active) return
    const tick = () => {
      const t = Date.now()
      setNow(t)
      setTimers((list) => list.map((x) => {
        if (x.done || x.end > t) return x
        ring(x.label)
        return { ...x, done: true }
      }))
    }
    const iv = setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', tick) }
  }, [active, ring])

  const start = useCallback((label: string, seconds: number) => {
    // Le son doit être autorisé par un geste de l'utilisateur : on prépare l'audio au moment du toucher
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!audio.current && Ctx) audio.current = new Ctx()
      void audio.current?.resume()
    } catch { /* pas de son */ }
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => {})
    setNow(Date.now())
    setTimers((list) => [...list, { id: nextId.current++, label, end: Date.now() + seconds * 1000, done: false }])
  }, [])

  const stop = useCallback((id: number) => setTimers((list) => list.filter((t) => t.id !== id)), [])

  return { timers, now, start, stop }
}
