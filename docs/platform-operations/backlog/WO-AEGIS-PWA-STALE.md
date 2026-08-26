# WO-AEGIS-PWA-STALE — retire the stale aegis. PWA (BLOCKED at Step 1)

**Opened:** 2026-08-22
**Status:** **ACCEPTED INTERIM** — aegis stays **LIVE** until the primary app is an installable PWA. Retire
is **contingent on the primary app gaining manifest + service worker + icons, NOT on time.** Do NOT remove
the custom domain / CNAME or archive the repo — aegis is a **live dependency** until the primary app can
replace it.
**Ruling (operator, 2026-08-22):** RETIRE eventually (single user = operator only, no client base, no loss),
but **keep aegis live in the interim** (ruling (a)). aegis (`aegis.silentshieldsecurity.com`) remains the
**only installable client**; it is **authenticated** (all routes behind `<ProtectedRoute>`; `aegis-chat`
verify_jwt=true + 503 stub) with **no anonymous input path**, **single operator user**, no client base.

## What aegis. is
`aegis.silentshieldsecurity.com` (CNAME → `slow-and-steady-love.pages.dev`) serves a **complete, standalone
copy of the Fortress client app** (repo `slow-and-steady-love`), built from commit `326315b` (**2026-05-02,
~3.5 months stale**). Backend = **Fortress prod `kpuqukppbmwebiptqmog`** (ships the prod publishable key,
wires ~15 prod edge functions incl. `send-sms`, `list-communications`, `respond-as-agent`,
`create-operator-invite`). All app routes are behind client-side `<ProtectedRoute>`; the `aegis-chat`
endpoint is `verify_jwt=true` + a 503 stub. It **is a real installable PWA** (VitePWA + `manifest.json`
`application/json` + `icon-192/512`) — which is why it is installed on the operator's phone.

## Operator retire sequence (gated, one step at a time, proof at each)
1. Confirm the **primary** client app is installable as a PWA + serves a working auth flow; report install URL. **← BLOCKED (see below)**
2. Diff `slow-and-steady-love @326315b` vs the primary app; list client-side features/fixes ONLY in slow-and-steady-love. If non-empty, stop and report before removing anything.
3. Remove the `aegis.silentshieldsecurity.com` custom domain from the Pages project + remove the aegis CNAME.
4. Archive the `slow-and-steady-love` repo. Do NOT delete the Pages project this session.
5. Close this WO as **retired** (not remediated), reasoning recorded.

## Step 1 finding — why aegis stays live (2026-08-22)
**The primary client app (`fortress.silentshieldsecurity.com` / repo `silent-shield-signal`) is NOT an
installable PWA.** Evidence:
- Repo: no `vite-plugin-pwa`/`VitePWA`, no `<link rel="manifest">` in `index.html`, no `public/manifest*` or icons.
- Live: `GET /manifest.json` → **200 `content-type: text/html`** (the SPA shell, not a manifest); `GET /sw.js` → **200 text/html** (shell); no manifest/apple-touch-icon/theme-color in the served `<head>`.
- Auth flow works: `GET /auth` → 200.
- Contrast: aegis `GET /manifest.json` → **200 `application/json`** real manifest + VitePWA + icons.

→ Retiring aegis now removes the operator's **only installable mobile app**. Step 1's gate correctly caught this.

## Retire trigger condition (ruling (a), 2026-08-22)
Retire proceeds ONLY after the primary app becomes an installable PWA **and** the operator installs +
confirms it on their phone. That work is tracked in **WO-PRIMARY-APP-PWA** (primary-app repo
`silent-shield-signal`). Until that WO is DONE (verified install), aegis stays live and Steps 2–5 above
stay parked. **Retire is contingent on that deliverable, not on elapsed time.**
