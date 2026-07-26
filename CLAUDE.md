# Wird (وِرد) — Islamic daily habit tracker

## Product
Worship habit tracker for UAE/Gulf Muslims: 5-prayer checklist with
computed prayer times (Umm al-Qura + user offsets), tasbih counter,
morning/evening adhkar (Hisnul Muslim), Quran reader with khatmah
bookmark + Listen mode (mp3quran.net API) + Hifz plans/testing,
Hijri calendar with events, Friday/Jumu'ah mode, athan voices (local
files in public/assets/athan/), multilingual (en/ar/fil/ur/es, ar+ur
are RTL), Support Us (Ziina payment links), Wird Plus premium screen.
Freemium: core worship features always free.

## Stack & deployment
- Vite + static hosting on Netlify (repo → GitHub → auto-deploy)
- Firebase: Auth (Google/email/anonymous guest), Firestore, planned FCM
- CRITICAL: no bundler assumptions beyond Vite defaults. All library
  imports must be CDN ESM URLs (e.g. gstatic firebasejs), NEVER bare
  npm specifiers — bare imports crashed production before.
- Static files (audio/images) live in public/ (Vite rule).
- Firestore structure: users/{uid} profile+settings; users/{uid}/days/
  {YYYY-MM-DD}; users/{uid}/meta/khatmah; users/{uid}/sadaqah. All
  data access through the db.js module only.

## Design system (LOCKED)
- Fonts: Amiri (Arabic) + Manrope (UI). No new fonts/icon packs/CSS
  frameworks. Icons via the inline SVG icon module.
- Colors only: #0B1D1B #143A35 #1E4A44 #C6A15B #E3C989 #F3EEE3
  #9DB8B2 #6FBF9B (+ reader themes: sepia/light palettes as coded).
- Dark "mosque at night" aesthetic; styled custom controls only —
  native selects/checkboxes are forbidden.

## Content rules (NON-NEGOTIABLE)
- NEVER alter, rephrase, truncate, or reformat Quranic text, adhkar,
  or duas. Only authentic texts with sources (Hisnul Muslim).
- Respectful tone; streaks encourage habit, never gamify worship.
- Hijri event dates always carry the moon-sighting disclaimer.
- Support Us wording: supporting app development — never "sadaqah"/
  "charity"/"donation".

## Engineering rules
- Surgical edits: change only what the task needs. Never regenerate
  whole files, never "clean up" working code, never rename existing
  identifiers/IDs/Firestore keys without being asked.
- Navigation/rendering goes through the single view-state model
  (currentTab/subview/overlay) — no ad-hoc show/hide.
- Async lists always render loading/content/error states.
- Reader bookmark rules: hifz/test/jump sessions never move the
  khatmah bookmark; progress counts pages once (furthestPageCounted).
- Boot must never hang: 10s timeout → Retry error screen.
- Free tiers only (Firebase Spark, Netlify free).
- After changes: verify the app runs, then commit with a clear
  message. Ask before any destructive operation (deletes, resets,
  force pushes).

## Repo layout notes
- The whole app currently lives in `index.html` (styles + markup +
  one `<script type="module">`). The `src/` React scaffold
  (main.tsx/App.tsx) is unused AI Studio boilerplate — `index.html`
  does not reference it.
- Firebase is imported from https://www.gstatic.com/firebasejs/ CDN
  ESM URLs inside `index.html`.
