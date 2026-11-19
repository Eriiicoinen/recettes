import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

const PUBLIC_KEY = import.meta.env?.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState = 'unsupported' | 'install-first' | 'denied' | 'off' | 'on'

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export async function pushState(): Promise<PushState> {
  if (!PUBLIC_KEY) return 'unsupported'
  // Sur iPhone, les notifications ne marchent que dans l'app installée sur l'écran d'accueil
  if (isIOS() && !standalone()) return 'install-first'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

export async function enablePush(householdId: string, userId: string) {
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages du téléphone.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY!) })
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.from('push_subscriptions').upsert({
    endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: userId, household_id: householdId,
  })
  if (error) throw error
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

export async function testPush() {
  const { error } = await supabase.functions.invoke('reminders', { body: { test: true } })
  if (error) {
    const payload = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
    throw new Error(payload?.error ?? 'Envoi impossible.')
  }
}
