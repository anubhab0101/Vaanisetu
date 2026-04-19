// Vaanisethu Service Worker — v1
// Handles: Push Notifications + basic offline detection

const CACHE_NAME = 'vaanisethu-v1';

// ── Push Event: received from server ────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) { data = { title: 'Vaanisethu', body: event.data?.text() || '' }; }

  const title   = data.title   || '🎬 Vaanisethu';
  const options = {
    body:    data.body    || 'New update from Vaanisethu!',
    icon:    data.icon    || '/logo.png',
    badge:   '/logo.png',
    image:   data.image   || undefined,
    tag:     data.tag     || 'vaanisethu-notif',
    renotify: true,
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
      timestamp: Date.now()
    },
    actions: data.actions || [
      { action: 'open',    title: '▶ Open App' },
      { action: 'dismiss', title: '✕ Dismiss'  }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification Click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Install + Activate (minimal — no caching to keep bandwidth low) ──────────
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
