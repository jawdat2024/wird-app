/**
 * Wird — scheduled prayer/adhkar push notifications.
 *
 * Runs every minute, computes each user's prayer times from their stored
 * lat/lng/tz (same Umm al-Qura calculation as the client, ported verbatim
 * from index.html so the server and the app never disagree), and sends an
 * FCM push the first time "now" falls inside a prayer's 2-minute window —
 * mirroring reminderTick()/notify() in index.html exactly, just running
 * server-side so it fires even when nobody has the app open.
 */

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");

const FIRESTORE_DATABASE_ID = "ai-studio-17c0b662-8370-4add-8de0-a545a80c3fc5";
// Must match the deployed origin: FCM requires an absolute https URL here, and
// without it a tapped notification closes without opening the app (see below).
const SITE_URL = "https://wirdd.netlify.app/";

initializeApp();
const db = getFirestore(FIRESTORE_DATABASE_ID);
const messaging = getMessaging();

/* ---- prayer time math, ported verbatim from index.html ---- */
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = rad((357.529 + 0.98560028 * D) % 360);
  const q = (280.459 + 0.98564736 * D) % 360;
  const L = rad(q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const e = rad(23.439 - 0.00000036 * D);
  const decl = Math.asin(Math.sin(e) * Math.sin(L));
  let RA = deg(Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))) / 15;
  RA = (RA + 24) % 24;
  const eqt = q / 15 - RA;
  return { decl, eqt };
}
function julian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}
function hourAngle(angle, lat, decl) {
  const cosH = (-Math.sin(rad(angle)) - Math.sin(rad(lat)) * Math.sin(decl)) /
    (Math.cos(rad(lat)) * Math.cos(decl));
  if (cosH < -1 || cosH > 1) return null;
  return deg(Math.acos(cosH)) / 15;
}
function computeTimes(date, lat, lng, tz) {
  const jd = julian(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  const { decl, eqt } = sunPosition(jd);
  const dhuhr = 12 + tz - lng / 15 - eqt;
  const hFajr = hourAngle(18.5, lat, decl);
  const hSun = hourAngle(0.833, lat, decl);
  const asrAngle = -deg(Math.atan(1 / (1 + Math.tan(Math.abs(rad(lat) - decl)))));
  const hAsr = hourAngle(asrAngle, lat, decl);
  const maghrib = dhuhr + (hSun || 0);
  return {
    Fajr: (dhuhr - (hFajr || 0)) * 60,
    Dhuhr: dhuhr * 60 + 2,
    Asr: (dhuhr + (hAsr || 0)) * 60,
    Maghrib: maghrib * 60,
    Isha: maghrib * 60 + 90,
  };
}

/* ---- helpers ---- */
const PRAYER_AR = { Fajr: "الفجر", Dhuhr: "الظهر", Asr: "العصر", Maghrib: "المغرب", Isha: "العشاء" };
const PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
// Must stay in step with DEFAULT_PRAYER_OFFSETS / PRAYER_OFFSET_LIMIT in index.html,
// otherwise a push would arrive at a different minute than the app displays.
const DEFAULT_PRAYER_OFFSETS = { Fajr: 2, Dhuhr: 0, Asr: 0, Maghrib: 3, Isha: 0 };
const PRAYER_OFFSET_LIMIT = 15;

function prayerOffsets(settings) {
  const saved = (settings && settings.prayerOffsets) || {};
  const out = {};
  for (const p of PRAYER_ORDER) {
    const v = Number(saved[p]);
    out[p] = isNaN(v) ? DEFAULT_PRAYER_OFFSETS[p]
      : Math.max(-PRAYER_OFFSET_LIMIT, Math.min(PRAYER_OFFSET_LIMIT, Math.round(v)));
  }
  return out;
}

// Minutes since local midnight at a user's stored UTC offset (tz, in hours),
// computed from the current UTC instant — equivalent to the client's
// device-local nowMins() when the device is physically at that offset.
function localMinutesNow(tz) {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes() + now.getUTCSeconds() / 60;
  return ((utcMinutes + tz * 60) % 1440 + 1440) % 1440;
}
function localDateKey(tz) {
  const now = new Date();
  const shifted = new Date(now.getTime() + tz * 3600 * 1000);
  return shifted.getUTCFullYear() + "-" + String(shifted.getUTCMonth() + 1).padStart(2, "0") +
    "-" + String(shifted.getUTCDate()).padStart(2, "0");
}
// A Date whose UTC fields equal the user's local date, so computeTimes()
// (which reads UTC fields as if they were local, matching the client's use
// of local Date fields) computes the correct day's times for that offset.
function localDateForCalc(tz) {
  const now = new Date();
  return new Date(now.getTime() + tz * 3600 * 1000);
}

async function sendToUser(userId, tokensMap, title, body, tag) {
  const tokens = Object.keys(tokensMap || {});
  if (!tokens.length) return;
  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { tag },
    // Web push specifics. Keeping a real `notification` payload (rather than
    // sending data-only) matters most on iOS: the FCM service worker displays
    // it directly, so the banner does not depend on our own handler running in
    // a cold-started service worker.
    webpush: {
      // A prayer push is only meaningful inside its window. With FCM's default
      // TTL (4 weeks) a push the device was offline for is delivered whenever
      // it next connects — which on iOS, where delivery is already deferred,
      // means an "Asr time" banner can arrive hours after Asr. Expire instead.
      headers: { TTL: "600", Urgency: "high" },
      // Carrying the tag here (not only in `data`) lets the SDK-displayed
      // notification collapse repeats of the same event instead of stacking.
      // `icon` is used by Android/desktop; iOS always uses the home-screen icon.
      notification: { title, body, tag, icon: "/public/icon-192.png" },
      // Without a link, the FCM SDK's own notificationclick handler calls
      // stopImmediatePropagation() and returns, so the notification closed
      // without ever opening Wird.
      fcmOptions: { link: SITE_URL },
    },
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error && r.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        dead.push(tokens[i]);
      } else {
        logger.warn("FCM send failed", { userId, code, message: r.error && r.error.message });
      }
    }
  });
  if (dead.length) {
    const clear = {};
    dead.forEach((t) => { clear[t] = FieldValue.delete(); });
    await db.collection("users").doc(userId).set({ fcmTokens: clear }, { merge: true });
  }
}

exports.checkPrayerReminders = onSchedule("every 1 minutes", async () => {
  const snap = await db.collection("users").get();
  const writes = [];

  for (const docSnap of snap.docs) {
    const u = docSnap.data();
    const settings = u.settings;
    const tokens = u.fcmTokens;
    if (!settings || !tokens || !Object.keys(tokens).length) continue;
    if (!settings.notif) continue;
    if (typeof settings.lat !== "number" || typeof settings.lng !== "number" || typeof settings.tz !== "number") continue;

    const tz = settings.tz;
    const dateKey = localDateKey(tz);
    let state = u.notifState;
    if (!state || state.date !== dateKey) {
      state = { date: dateKey, prayers: [], morningAdhkar: false, eveningAdhkar: false };
    }

    const n = localMinutesNow(tz);
    const times = computeTimes(localDateForCalc(tz), settings.lat, settings.lng, tz);
    const offsets = prayerOffsets(settings);
    for (const p of PRAYER_ORDER) times[p] += offsets[p];
    let changed = false;

    if (settings.notifPrayer) {
      for (const p of ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]) {
        const t = times[p];
        if (n >= t && n < t + 2 && !state.prayers.includes(p)) {
          await sendToUser(docSnap.id, tokens, "🕌 " + p + " time", "حان وقت صلاة " + PRAYER_AR[p], dateKey + "-" + p);
          state.prayers.push(p);
          changed = true;
        }
      }
    }
    if (settings.notifAdhkar) {
      const mStart = times.Fajr + 20;
      if (!state.morningAdhkar && n >= mStart && n < mStart + 2) {
        await sendToUser(docSnap.id, tokens, "📿 Morning adhkar", "أذكار الصباح — start your day protected", dateKey + "-madh");
        state.morningAdhkar = true;
        changed = true;
      }
      const eStart = times.Asr + 30;
      if (!state.eveningAdhkar && n >= eStart && n < eStart + 2) {
        await sendToUser(docSnap.id, tokens, "📿 Evening adhkar", "أذكار المساء — before Maghrib", dateKey + "-eadh");
        state.eveningAdhkar = true;
        changed = true;
      }
    }

    if (changed) writes.push(db.collection("users").doc(docSnap.id).set({ notifState: state }, { merge: true }));
  }

  await Promise.all(writes);
});
