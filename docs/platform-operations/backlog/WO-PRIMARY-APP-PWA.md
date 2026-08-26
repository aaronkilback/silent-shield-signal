# WO-PRIMARY-APP-PWA — make the primary client app installable

**Opened:** 2026-08-22
**Status:** OPEN — not started. **Do NOT work this session.**
**Repo:** `silent-shield-signal` (primary Fortress client app, served as a Cloudflare **Worker** at
`fortress.silentshieldsecurity.com`).

## Why
The primary app is **not currently an installable PWA** (verified 2026-08-22): no `vite-plugin-pwa`, no
`<link rel="manifest">`, no service worker, no app icons. Live `GET /manifest.json` and `GET /sw.js` return
`content-type: text/html` (SPA soft-200 fallbacks, not real files); `GET /auth` works (200). The only
installable client today is the stale aegis PWA (`slow-and-steady-love`), which is why it cannot be retired
(see **WO-AEGIS-PWA-STALE**, ACCEPTED INTERIM).

## Scope — deliver an installable PWA on the primary app
1. **Web app manifest** — `manifest.webmanifest` (or `manifest.json`) with `name`, `short_name`,
   `start_url`, `display: standalone`, `theme_color`, `background_color`, and an `icons` array; linked via
   `<link rel="manifest">` in `index.html`.
2. **Service worker** — offline shell + asset caching (e.g. `vite-plugin-pwa` / Workbox), registered on load.
   Note the app is Worker-served, not Pages — confirm the SW scope + that the Worker serves the SW file with
   the correct `content-type: application/javascript` (not the SPA HTML fallback).
3. **Icons** — at minimum `icon-192.png` + `icon-512.png` (+ maskable + `apple-touch-icon` for iOS install).
4. **Install flow** — installable on Android (beforeinstallprompt) and iOS (Add to Home Screen); standalone
   display; correct name/icon on the home screen.
5. **Auth in standalone** — confirm the auth flow (MFA included) works inside the installed standalone
   context (no broken redirects when launched from the home-screen icon).

## Acceptance (the gate)
- Live `GET /manifest.json` returns `application/json` (a real manifest), `GET /sw.js` returns a real service
  worker (`application/javascript`), both served by the Worker — NOT the SPA HTML fallback.
- **Operator installs it on their phone and confirms** it launches standalone with working auth. (Analogous
  to how the aegis PWA is currently installed.)
- Only then does **WO-AEGIS-PWA-STALE** unblock and the aegis retire sequence (Steps 2–5) may run.

## Non-goals
- No copy/marketing changes (that's the `silent-shield-fortress` repo).
- Not this session.
