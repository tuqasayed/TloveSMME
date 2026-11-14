importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCEICcdQzue6QmOwlpqX5HMsD_jloJjA20",
  authDomain: "bubble-chat-32bdd.firebaseapp.com",
  projectId: "bubble-chat-32bdd",
  storageBucket: "bubble-chat-32bdd.firebasestorage.app",
  messagingSenderId: "235155894168",
  appId: "1:235155894168:web:e917e65563a4f06faa85ed"
});

const messaging = firebase.messaging();

// Keep one notification per conversation. New messages update that notification
// instead of creating a separate notification for every message.
messaging.onBackgroundMessage(payload => {
  const data = payload.data || {};
  const title = payload.notification?.title || "Bubble Chat 🫧";
  const options = {
    body: payload.notification?.body || "عندك رسالة جديدة ♡",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data,
    tag: data.threadId ? `bubble-chat-${data.threadId}` : "bubble-chat-messages",
    renotify: false,
    requireInteraction: false,
    timestamp: Date.now()
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const threadId = event.notification.data?.threadId || "";
  const targetUrl = threadId
    ? `./?thread=${encodeURIComponent(threadId)}`
    : "./";

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(targetUrl);
        return;
      }
    }
    await clients.openWindow(targetUrl);
  })());
});
