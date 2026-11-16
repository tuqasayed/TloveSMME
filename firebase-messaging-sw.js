// Bubble Chat web push service worker.
// Firebase Messaging is intentionally not imported here: the browser's native
// push event is enough for data-only FCM messages and avoids SDK evaluation errors.

const APP_URL = new URL('./', self.location.href).href;
const ICON_URL = new URL('./icons/icon-192.png', self.location.href).href;
const BADGE_URL = ICON_URL;
const DB_NAME = 'bubble-chat-push-state';
const DB_VERSION = 1;
const RECENT_WINDOW_MS = 15000;
const COALESCE_KEY = 'recent-notification-batch';

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

async function updateNotificationBatch() {
  const db = await openStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    const store = tx.objectStore('state');
    const request = store.get(COALESCE_KEY);
    let count = 1;
    request.onsuccess = () => {
      const previous = request.result || {};
      count = Date.now() - Number(previous.at || 0) <= RECENT_WINDOW_MS ? Number(previous.count || 0) + 1 : 1;
      store.put({ at: Date.now(), count }, COALESCE_KEY);
    };
    tx.oncomplete = () => { db.close(); resolve(count); };
    tx.onerror = () => { db.close(); reject(tx.error); };
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
    let messageBody = String(data.body || 'افتح المحادثة لقراءة رسائلك الجديدة').slice(0, 240);
    let title = 'رسالة جديدة ♡';

    // Suppress system notifications while Bubble Chat is visible in the foreground.
    // Background tabs and closed PWA windows continue to receive notifications.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appIsForeground = windows.some(client => client.visibilityState === 'visible' && client.focused);
    if (appIsForeground) return;

    let batchCount = 1;
    try { batchCount = await updateNotificationBatch(); } catch (error) { console.warn('Notification batch state failed:', error); }
    if (batchCount > 1) {
      title = 'لديك رسائل جديدة ♡';
      messageBody = 'لديك رسائل جديدة ♡';
    }
    await self.registration.showNotification(title, {
      body: messageBody,
      icon: ICON_URL,
      badge: BADGE_URL,
      data: { threadId },
      // Use one shared notification for messages from every conversation.
      // Each new message updates this same notification instead of stacking another one.
      tag: 'bubble-chat-new-messages',
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
