// Bubble Chat web push service worker.
// Firebase Messaging is intentionally not imported here: the browser's native
// push event is enough for data-only FCM messages and avoids SDK evaluation errors.

const APP_URL = new URL('./', self.location.href).href;
const ICON_URL = new URL('./icons/notification-icon.png', self.location.href).href;
const BADGE_URL = ICON_URL;
const DB_NAME = 'bubble-chat-push-state';
const DB_VERSION = 2;
const RECENT_WINDOW_MS = 15000;
const COALESCE_KEY = 'recent-notification-batch';

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function openStateDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      if (!request.result.objectStoreNames.contains('pushMessages')) request.result.createObjectStore('pushMessages');
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

async function persistPushMessage(item) {
  const db = await openStateDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pushMessages', 'readwrite');
    tx.objectStore('pushMessages').put(item, `${item.threadId}::${item.messageId}`);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
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
    const messageId = String(data.messageId || '');
    const senderName = String(data.senderName || 'صديق');
    const groupName = String(data.groupName || '');
    const preview = String(data.body || 'رسالة جديدة').slice(0, 180);
    if (threadId && messageId) { try { await persistPushMessage({threadId,messageId,senderId,senderName,body:String(data.offlineText||preview).slice(0,700),at:Date.now()}); } catch(error) { console.warn('Could not persist received push message:',error); } }
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
      data: { threadId, messageId, senderId, senderName, body: preview },
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

// Offline app-shell cache (coexists with the notification handlers above).
const OFFLINE_CACHE = 'bubble-chat-offline-v2';
const OFFLINE_ASSETS = [
  './', './index.html', './style.css', './app.js', './firebase-config.js',
  './icons/notification-icon.png',
  ...Array.from({length:14}, (_,i)=>`./decorations/${i+1}.png`),
  ...Array.from({length:14}, (_,i)=>`./decorations/${i+1}.gif`)
];
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(OFFLINE_CACHE);
    await Promise.all(OFFLINE_ASSETS.map(async url=>{try{const r=await fetch(new Request(url,{cache:'reload'}));if(r.ok)await cache.put(url,r);}catch(e){console.warn('Could not cache',url);}}));
  })().catch(err=>console.warn('Offline precache partial failure',err)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('bubble-chat-offline-')&&k!==OFFLINE_CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  // Never cache Firebase data/auth requests, uploads, or other dynamic API traffic.
  const isShell=url.origin===self.location.origin;
  const isFirebaseModule=url.hostname==='www.gstatic.com' && url.pathname.includes('/firebasejs/');
  if(!isShell && !isFirebaseModule) return;
  if(isShell && (url.pathname.includes('/api/') || url.pathname.includes('/upload') || url.pathname.includes('/firestore'))) return;
  event.respondWith((async()=>{
    const cache=await caches.open(OFFLINE_CACHE);
    const cached=await cache.match(req);
    if(cached) return cached;
    try{
      const response=await fetch(req);
      if(response && (response.ok || response.type==='opaque')) cache.put(req,response.clone()).catch(()=>{});
      return response;
    }catch(err){
      if(req.mode==='navigate') return cache.match('./index.html');
      throw err;
    }
  })());
});
