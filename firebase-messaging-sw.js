// Bubble Chat web push service worker.
// Firebase Messaging is intentionally not imported here: the browser's native
// push event is enough for data-only FCM messages and avoids SDK evaluation errors.

const APP_URL = new URL('./', self.location.href).href;
const ICON_URL = new URL('./icons/icon-192.png', self.location.href).href;
const BADGE_URL = ICON_URL;
const DB_NAME = 'bubble-chat-push-state';
const DB_VERSION = 1;
const RECENT_WINDOW_MS = 15000;

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function openStateDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (_) {
      try { payload = { data: { body: event.data?.text() || '' } }; } catch (_) {}
    }

    // Firebase sends data-only messages; handle them in every app state:
    // foreground, background, and fully closed.
    const data = payload.data || payload;
    const threadId = String(data.threadId || '');
    const messageBody = String(data.body || 'عندك رسالة جديدة ♡').slice(0, 180);
    const title = String(data.title || 'Bubble Chat 🫧').slice(0, 80);

    await self.registration.showNotification(title, {
      body: messageBody,
      icon: ICON_URL,
      badge: BADGE_URL,
      data: { threadId },
      // Keep separate conversations as separate stacked notifications.
      // A new message in the same conversation updates that conversation's alert.
      tag: threadId ? `bubble-chat-${threadId}` : `bubble-chat-${Date.now()}`,
      renotify: false,
      requireInteraction: false,
      timestamp: Date.now()
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const threadId = event.notification.data?.threadId || '';
  const targetUrl = threadId
    ? `${APP_URL}?thread=${encodeURIComponent(threadId)}`
    : APP_URL;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(targetUrl);
        return;
      }
    }
    await clients.openWindow(targetUrl);
  })());
});
