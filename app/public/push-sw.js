// Notifications reçues par le service worker (importé par sw.js)
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(data.title || 'Recettes & Menus', {
    body: data.body || '',
    icon: 'pwa-192x192.png',
    badge: 'pwa-64x64.png',
    data: { url: data.url || '#/semaine' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data && event.notification.data.url || '', self.registration.scope).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => {}); return c.focus() }
    }
    return self.clients.openWindow(url)
  }))
})
