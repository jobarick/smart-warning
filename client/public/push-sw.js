// Push handlers, imported into the generated Workbox service worker via
// `workbox.importScripts` (see vite.config.ts). Runs in the same SW registration
// as the PWA precache, so there's a single service worker for the app.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Emergency alert', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Emergency alert';
  const urgent = data.severity === 'critical' || data.severity === 'high';
  const options = {
    body: data.body || '',
    tag: data.tag || 'sw-alert',
    renotify: true,
    requireInteraction: urgent,
    vibrate: urgent ? [200, 100, 200, 100, 200] : [200],
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab if the app is already open, otherwise open one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const url = (event.notification.data && event.notification.data.url) || '/';
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })(),
  );
});
