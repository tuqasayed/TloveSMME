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
messaging.onBackgroundMessage(async payload => {
  const title = payload.notification?.title || "Bubble Chat 🫧";
  const options = {
    body: payload.notification?.body || "عندك رسالة جديدة ♡",
    icon: "./icons/icon-192.png",
    data: payload.data || {},
    tag: payload.data?.threadId ? `bubble-chat-${payload.data.threadId}` : "bubble-chat-message",
    renotify: false,
    timestamp: Date.now()
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if ("focus" in client) return client.focus();
    }
    return clients.openWindow("./");
  }));
});
