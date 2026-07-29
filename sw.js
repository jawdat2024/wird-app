/* Wird service worker.
   Two jobs: (1) let the page trigger an update via SKIP_WAITING, matching
   the "New version available — Refresh" toast in index.html; (2) show a
   notification when an FCM push arrives while the app isn't focused. */

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyA7eGFicHqUZTVJkxqIHjPUZePqdRJ3B9o",
  authDomain: "wird-1b97b.firebaseapp.com",
  projectId: "wird-1b97b",
  storageBucket: "wird-1b97b.firebasestorage.app",
  messagingSenderId: "300106896712",
  appId: "1:300106896712:web:bb669231b1c0c220cccf7d"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // When a push carries a `notification` payload, the FCM SDK has already
  // called showNotification() itself before invoking this handler (onPush in
  // @firebase/messaging shows it, then calls onBackgroundMessage). Showing one
  // here too produced a second, duplicate banner for every prayer. Server
  // sends a notification payload, so this is now only a fallback for
  // data-only pushes.
  if (payload.notification) return;
  const d = payload.data || {};
  self.registration.showNotification(d.title || "وِرد", {
    body: d.body || "",
    tag: d.tag || "wird-prayer",
    data: d
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({type: "window", includeUncontrolled: true}).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
