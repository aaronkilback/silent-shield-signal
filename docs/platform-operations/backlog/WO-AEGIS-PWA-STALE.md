# WO-AEGIS-PWA-STALE — retire the stale aegis. PWA (BLOCKED at Step 1)

**Opened:** 2026-08-22
**Status:** OPEN — **retire BLOCKED at Step 1** (primary app is not an installable PWA). Do NOT remove the
custom domain / CNAME or archive the repo until unblocked.
**Ruling (operator, 2026-08-22):** RETIRE `aegis.silentshieldsecurity.com` — single user (operator only),
no client base, no loss. Not remediate.

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

## BLOCKER (Step 1, 2026-08-22)
**The primary client app (`fortress.silentshieldsecurity.com` / repo `silent-shield-signal`) is NOT an
installable PWA.** Evidence:
- Repo: no `vite-plugin-pwa`/`VitePWA`, no `<link rel="manifest">` in `index.html`, no `public/manifest*` or icons.
- Live: `GET /manifest.json` → **200 `content-type: text/html`** (the SPA shell, not a manifest); `GET /sw.js` → **200 text/html** (shell); no manifest/apple-touch-icon/theme-color in the served `<head>`.
- Auth flow works: `GET /auth` → 200.
- Contrast: aegis `GET /manifest.json` → **200 `application/json`** real manifest + VitePWA + icons.

→ Retiring aegis now removes the operator's **only installable mobile app**. Step 1's gate correctly caught this.

## Prerequisite before the retire sequence may resume
Either **(a)** add PWA support to the primary app (`silent-shield-signal`): VitePWA manifest + service worker
+ `icon-192/512`, deploy to `fortress.silentshieldsecurity.com`, and the operator installs + confirms on
their phone; **or (b)** the operator explicitly accepts losing the installable mobile app and proceeds to
retire aegis without a PWA replacement.

**Awaiting operator ruling on (a) vs (b) before Steps 2–5.**
