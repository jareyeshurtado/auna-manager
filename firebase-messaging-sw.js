importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// 1. Initialize Firebase in the Service Worker
firebase.initializeApp({
  apiKey: "AIzaSyCP2k-VJURlMV3-UNPVYMD4q9-wwNjiiQc",
  authDomain: "auna-board.firebaseapp.com",
  projectId: "auna-board",
  storageBucket: "auna-board.firebasestorage.app",
  messagingSenderId: "542600310440",
  appId: "1:542600310440:web:3b33ba175b862dc96a5c9d"
});

// 2. Retrieve an instance of Firebase Messaging
const messaging = firebase.messaging();

// 3. Handle background messages (Optional: Keep for logging, but remove the popup)
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  // We removed the self.registration.showNotification() code here!
  // Firebase will automatically display the notification because our backend
  // sends a "notification" payload.
});