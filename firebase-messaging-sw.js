importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCP2k-VJURlMV3-UNPVYMD4q9-wwNjiiQc",
  authDomain: "auna-board.firebaseapp.com",
  projectId: "auna-board",
  storageBucket: "auna-board.firebasestorage.app",
  messagingSenderId: "542600310440",
  appId: "1:542600310440:web:3b33ba175b862dc96a5c9d"
});

const messaging = firebase.messaging();

// The backend sends a "notification" payload, so Firebase displays background notifications
// by itself; this is only for logging.
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
});

// Tapping a notification opens (or focuses) the admin panel.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL('admin.html', self.registration.scope).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => w.url.startsWith(target));
      return existing ? existing.focus() : clients.openWindow(target);
    })
  );
});
