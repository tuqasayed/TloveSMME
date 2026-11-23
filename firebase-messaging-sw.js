// Bubble Chat web push service worker.
// Firebase Messaging is intentionally not imported here: the browser's native
// push event is enough for data-only FCM messages and avoids SDK evaluation errors.

const APP_URL = new URL('./', self.location.href).href;
const ICON_URL = new URL('./icons/notification-icon.png', self.location.href).href;
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

async function readState(key) {
  const db = await openStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readonly');
    const request = tx.objectStore('state').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function updateNotificationBatch(item) {
  const db = await openStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    const store = tx.objectStore('state');
    const request = store.get(COALESCE_KEY);
    request.onsuccess = () => {
      const previous = request.result || {};
      const fresh = Date.now() - Number(previous.at || 0) <= RECENT_WINDOW_MS;
      const identities = fresh ? (previous.identities || []) : [];
      const identity = `${item.threadId}::${item.senderId}`;
      if (!identities.includes(identity)) identities.push(identity);
      const messages = fresh && identities.length === 1 ? (previous.messages || []) : [];
      if (identities.length === 1) {
        messages.push(item.preview);
        while (messages.length > 5) messages.shift();
      }
      const next = { at: Date.now(), identities, messages, threadId: item.threadId };
      store.put(next, COALESCE_KEY);
      resolve(next);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch (_) {
      try { payload = { data: { body: event.data?.text() || '' } }; } catch (_) {}
    }

    const data = payload.data || payload;
    const threadId = String(data.threadId || '');
    const senderId = String(data.senderId || '');
    const senderName = String(data.senderName || 'صديق');
    const groupName = String(data.groupName || '');
    const preview = String(data.body || 'رسالة جديدة').slice(0, 180);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appIsForeground = windows.some(client => client.visibilityState === 'visible' && client.focused);
    if (appIsForeground) return;

    // Respect a locally muted conversation while its mute period is active.
    try {
      const mutedUntil = Number(await readState(`muted:${threadId}`) || 0);
      if (mutedUntil > Date.now()) return;
    } catch (error) { console.warn('Could not read mute preference:', error); }

    let batch = { identities: [ `${threadId}::${senderId}` ], messages: [preview] };
    try { batch = await updateNotificationBatch({ threadId, senderId, preview }); }
    catch (error) { console.warn('Notification batch state failed:', error); }

    let messageBody;
    if ((batch.identities || []).length > 1) {
      messageBody = 'لديك رسائل جديدة ♡';
    } else {
      const lines = [];
      if (groupName) lines.push(`• ${groupName}:`);
      lines.push(`• ${senderName}:`);
      (batch.messages || [preview]).slice(-5).forEach(message => lines.push(`• ${message}`));
      messageBody = lines.join('\n');
    }

    await self.registration.showNotification('Bubble Chat', {
      body: messageBody,
      icon: ICON_URL,
      badge: BADGE_URL,
      data: { threadId },
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
