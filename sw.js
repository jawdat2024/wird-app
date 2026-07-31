/* Wird service worker.
   Two jobs: (1) let the page trigger an update via SKIP_WAITING, matching
   the "New version available — Refresh" toast in index.html; (2) show a
   notification when an FCM push arrives while the app isn't focused. */

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* Jumu'ah audio, precached on install so the tap-through screen starts
   instantly and works offline. Netlify serves this repo's root, so these live
   under /public/ — same convention as the athan files. The .caf is iOS-native
   only and is deliberately not cached: web push cannot use it. */
const JUMUAH_CACHE = "wird-audio-v1";
const JUMUAH_AUDIO = [
  "/public/audio/jumuah-62-9.mp3",
  "/public/audio/jumuah-tone.mp3"
];
self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Precaching must never block activation — a failed fetch here would leave
  // the worker stuck and take the update toast down with it.
  event.waitUntil(
    caches.open(JUMUAH_CACHE)
      .then((c) => c.addAll(JUMUAH_AUDIO))
      .catch(() => {})
  );
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/* Serve the precached audio offline. Everything else falls through to the
   network untouched. */
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!JUMUAH_AUDIO.includes(url.pathname)) return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request))
  );
});

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
  /* Jumu'ah notifications land on /jumuah, which plays the ayah. For pushes
     carrying a `notification` payload the FCM SDK handles the click first
     (using webpush.fcmOptions.link) and stops propagation, so this runs only
     for data-only pushes — it has to route them the same way. */
  const d = event.notification.data || {};
  const isJumuah = d.kind === "jumuah" || /(^|-)jumuah$/.test(d.tag || "");
  const target = isJumuah ? "/jumuah" : "/";
  event.waitUntil(
    self.clients.matchAll({type: "window", includeUncontrolled: true}).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          // Tell the page which screen to show; focusing alone would leave a
          // already-open tab sitting on whatever it was displaying.
          if (isJumuah && "postMessage" in c) c.postMessage({type: "OPEN_JUMUAH"});
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
