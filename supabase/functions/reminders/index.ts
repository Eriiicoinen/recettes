// Rappels par notification.
// - Appel planifié (chaque soir, en-tête x-reminder-key ; envoi la veille du début de semaine de chaque foyer) : prévient les foyers dont le menu de la semaine prochaine est vide ou presque.
// - Appel d'un utilisateur connecté (bouton « Tester ») : notification de test sur ses propres téléphones.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'
import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Sub = { endpoint: string; p256dh: string; auth: string; household_id: string; user_id: string }
type Payload = { title: string; body: string; url: string }

/** Demain (heure de Paris), au format AAAA-MM-JJ, et son jour de la semaine (0 = dimanche). */
function tomorrow() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return { iso: d.toISOString().slice(0, 10), dow: d.getUTCDay() }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST uniquement' }, 405)

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const fromCron = !!Deno.env.get('REMINDER_KEY') && req.headers.get('x-reminder-key') === Deno.env.get('REMINDER_KEY')
  let subs: Sub[]
  let payloadFor: (householdId: string) => Promise<Payload | null>

  if (fromCron) {
    const { data, error } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, household_id, user_id')
    if (error) return json({ error: error.message }, 500)
    subs = data as Sub[]
    // Appel quotidien : seuls les foyers dont la semaine commence demain sont prévenus (la veille au soir)
    const next = tomorrow()
    payloadFor = async (householdId) => {
      const { data: hh } = await admin.from('households').select('week_start_dow').eq('id', householdId).single()
      if ((hh?.week_start_dow ?? 1) !== next.dow) return null
      const { count } = await admin.from('week_items').select('id', { count: 'exact', head: true })
        .eq('household_id', householdId).eq('week_start', next.iso)
      const url = `#/semaine?s=${next.iso}`
      if (!count) return { title: '📅 Menu de la semaine prochaine', body: "Rien n'est encore prévu. Touche ici puis « ✨ Remplir ma semaine ».", url }
      if (count < 4) return { title: '📅 Menu de la semaine prochaine', body: `Seulement ${count} repas prévu${count > 1 ? 's' : ''} pour l'instant.`, url }
      return null
    }
  } else {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) return json({ error: 'Non connecté' }, 401)
    const { data, error } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, household_id, user_id').eq('user_id', user.id)
    if (error) return json({ error: error.message }, 500)
    subs = data as Sub[]
    if (!subs.length) return json({ error: 'Aucun téléphone abonné : active d\'abord les notifications.' }, 404)
    payloadFor = () => Promise.resolve({ title: '🔔 Notifications activées', body: 'Tu recevras un rappel le dimanche soir si le menu de la semaine suivante est vide.', url: '#/semaine' })
  }

  const cache = new Map<string, Payload | null>()
  let sent = 0
  let removed = 0
  for (const s of subs) {
    if (!cache.has(s.household_id)) cache.set(s.household_id, await payloadFor(s.household_id))
    const payload = cache.get(s.household_id)
    if (!payload) continue
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 12 * 3600 })
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      // Abonnement expiré (application désinstallée, notifications coupées) : supprimé
      if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        removed++
      }
    }
  }
  return json({ sent, removed })
})
