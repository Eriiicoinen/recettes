import { supabase } from './supabase'

// Liens qui ouvrent l'app avec une intention :
// - lien « mot de passe oublié » reçu par e-mail : #access_token=…&type=recovery (ou #error=… si expiré)
// - lien d'invitation : ?invite=CODE
// Lus une fois au lancement, avant le routeur (dont l'adresse utilise aussi le #).

const RECOVERY = 'recettes.recovery'
const INVITE = 'recettes.invite'
const AUTH_ERROR = 'recettes.authError'

function store(kind: 'session' | 'local', key: string, value: string | null) {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage
    if (value == null) s.removeItem(key)
    else s.setItem(key, value)
  } catch { /* stockage indisponible */ }
}
function read(kind: 'session' | 'local', key: string) {
  try { return (kind === 'session' ? sessionStorage : localStorage).getItem(key) } catch { return null }
}

export async function captureLaunchLinks() {
  const url = new URL(window.location.href)
  const invite = url.searchParams.get('invite')
  if (invite && /^[A-Za-z0-9]{4,12}$/.test(invite)) {
    store('local', INVITE, invite.toUpperCase())
    url.searchParams.delete('invite')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }

  const hash = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''))
  if (hash.get('error_description')) {
    store('session', AUTH_ERROR, 'Ce lien a expiré ou a déjà servi. Redemande un lien.')
    window.history.replaceState(null, '', url.pathname + url.search)
    return
  }
  const access = hash.get('access_token')
  const refresh = hash.get('refresh_token')
  if (access && refresh) {
    window.history.replaceState(null, '', url.pathname + url.search)
    const { error } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh })
    if (error) store('session', AUTH_ERROR, 'Ce lien ne fonctionne plus. Redemande un lien.')
    else if (hash.get('type') === 'recovery') store('session', RECOVERY, '1')
  }
}

export const isRecovery = () => read('session', RECOVERY) === '1'
export const endRecovery = () => store('session', RECOVERY, null)
export const pendingInvite = () => read('local', INVITE)
export const clearInvite = () => store('local', INVITE, null)
export function takeAuthError() {
  const e = read('session', AUTH_ERROR)
  store('session', AUTH_ERROR, null)
  return e
}

/** Lien qui ouvre l'app avec le code d'invitation déjà rempli. */
export const inviteLink = (code: string) => `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(code)}`
