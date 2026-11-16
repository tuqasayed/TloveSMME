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

async function registerRecentSender(senderId, senderName) {
  // IndexedDB survives service-worker termination, unlike ordinary globals.
  try {
    const db = await openStateDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      const store = tx.objectStore('state');
      const get = store.get('recent-senders');
      get.onsuccess = () => {
        const now = Date.now();
        const previous = (get.result || []).filter(item => now - item.at < RECENT_WINDOW_MS);
        const key = senderId || senderName || 'unknown';
        const updated = previous.filter(item => item.key !== key);
        updated.push({ key, name: senderName || 'شخص ما', at: now });
        store.put(updated, 'recent-senders');
        resolve(new Set(updated.map(item => item.key)).size > 1);
      };
      get.onerror = () => reject(get.error);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return result;
  } catch (error) {
    console.warn('Could not update push aggregation state:', error);
    return false;
  }
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    // Suppress the system notification only while a Bubble Chat page
    // inside this service worker's scope is visibly on screen. A hidden tab
    // (background) or a closed app must still receive the notification.
    try {
      const scopePath = new URL(APP_URL).pathname;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const appIsVisible = windows.some(client => {
        let clientPath = '';
        try { clientPath = new URL(client.url).pathname; } catch (_) { return false; }
        return clientPath.startsWith(scopePath) && client.visibilityState === 'visible';
      });
      if (appIsVisible) return;
    } catch (error) {
      // If foreground detection fails, continue with notification delivery
      // rather than silently dropping messages.
      console.warn('Could not detect foreground app state:', error);
    }

    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (_) {
      try { payload = { data: { body: event.data?.text() || '' } }; } catch (_) {}
    }
    // FCM data-only messages expose our fields under payload.data.
    const data = payload.data || payload;
    const threadId = String(data.threadId || '');
    const senderId = String(data.senderId || data.senderName || '');
    const senderName = String(data.senderName || 'صديق');
    const messageBody = String(data.body || 'عندك رسالة جديدة ♡').slice(0, 180);
    const multipleSenders = await registerRecentSender(senderId, senderName);

    const title = multipleSenders
      ? 'لديك رسائل جديدة..'
      : String(data.title || 'Bubble Chat 🫧').slice(0, 80);
    const body = multipleSenders
      ? 'لديك رسائل جديدة من أكثر من شخص. افتح المحادثات لعرضها.'
      : messageBody;

    if (multipleSenders) {
      const oldNotifications = await self.registration.getNotifications();
      oldNotifications.forEach(notification => notification.close());
    }

    await self.registration.showNotification(title, {
      body,
      icon: ICON_URL,
      badge: BADGE_URL,
      data: { threadId: multipleSenders ? '' : threadId },
      // Same conversation => update its existing notification, not a new one.
      // Different senders in the short aggregation window => one combined alert.
      tag: multipleSenders ? 'bubble-chat-multiple-senders' : (threadId ? `bubble-chat-${threadId}` : 'bubble-chat-messages'),
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
