# WO-STRATEGY-DOC-BUNDLE-EXPOSURE — internal strategy doc shipped in the public bundle

**Status:** RULED **SENSITIVE** (operator, 2026-08-03) → **fixed by REMOVAL**, committed `305cb59` on `feat/crm-slice1`. Route + import dropped from `App.tsx`, `src/pages/Strategy.tsx` deleted, `docs/FORTRESS_ACADEMY_STRATEGY.md` KEPT (editor-read only, no client viewer). Navigate bug disposed of with the file. **Pre-deploy build proof green** (`What Makes It Different` = 0 files in `dist`; CRM ref still present). **ACCEPTANCE TEST OPEN:** grep the LIVE production bundle for `"What Makes It Different"` after the next deploy → must be **0 hits**. Not closed until the live grep passes. Sequenced with the CRM deploy (same push/build/verify). Discovered 2026-08-03 during the `/strategy` gate review.

## The exposure

`silent-shield-fortress/src/pages/Strategy.tsx:5` does `import strategyRaw from "../../docs/FORTRESS_ACADEMY_STRATEGY.md?raw"`. Vite `?raw` inlines the **entire 1,908-line internal doc** (*"Fortress Academy™ — Strategy & Build Document"*, v1.0) as a string at build time. `Strategy` is a **static** import in `App.tsx:17` (not lazy), so the doc lands in the **main entry bundle served on every route, including `/`**.

**Proven live:** the production bundle at `https://silentshieldsecurity.com/` (`index-BYwPq_am.js`) contains the doc text (`"What Makes It Different"`). Anyone can read the whole document today by fetching the homepage JS — no `/strategy` visit, no password, no URL discovery.

- The client-side password gate (`Strategy.tsx:10`, `VITE_STRATEGY_PASSWORD || "fortress2026"`) is **cosmetic** — it gates rendering, not content. The hardcoded fallback ships publicly and is guessable; but even a strong password is irrelevant because the content is already in the bundle.
- `/strategy` is **unlisted** (only `App.tsx:42` route; no links) and **static** (no data reads). No `noindex` anywhere (`robots.txt` is `Allow: /`, no `Disallow`), but as an SPA a crawler rendering `/strategy` sees only the password form, so search-index exposure of the rendered doc is low. The exposure is the **bundle**, not indexing.

## Fix options (operator rules on sensitivity first)

- **If sensitive:** the content must LEAVE the client bundle — stop `?raw`-embedding it; move the markdown to an auth-gated source (Supabase table/storage under RLS, or a CF-Access-gated fetch) and load at runtime after auth. **Removing the embed is load-bearing; Cloudflare Access on `/strategy` alone is insufficient** because the doc is in the shared homepage bundle, not just the `/strategy` path.
- **If not sensitive:** delete the gate entirely (password prompt + `localStorage` flag) and serve plainly — a fake lock implies a confidentiality the bundle doesn't honor.

## Pattern check — is this systemic? NO, isolated to this one doc

Swept all three repos for `?raw` / `?inline` / `?url` / `readFileSync` / `.md` imports that embed file contents into a client bundle:

| Repo | Result |
|---|---|
| `silent-shield-fortress` (marketing, Vite/Pages) | **1 embed** — `FORTRESS_ACADEMY_STRATEGY.md` (the finding above). No other `?raw`/`?inline`/`?url`/doc import. |
| `silent-shield-signal` (Fortress app, Vite) | **0 client-bundle embeds.** No `?raw`/`?inline`/`?url`. The `readFileSync` hits are all under `src/test/**` (Node test harnesses, never bundled to browser). Clean. |
| `silent-shield-delivery` (3 Workers) | No `?raw`/`?inline`. Two HTML module imports into workers — `silent-shield-protection-page.html` (protection-worker) + `thank-you-fortified16.html` (page-worker) — both **public-by-design** post-sale/marketing pages. F16 PDF served from R2 at runtime by delivery-worker (paid product, not bundle-embedded). `hero-copy-protective-intelligence.md` is an unreferenced repo artifact, not served. **No internal doc embedded in a client bundle.** |

Conclusion: the strategy-doc embed is a **one-off**, not a repeated pattern.

## Also logged (do not fix) — latent bug in the same file

`Strategy.tsx:177` calls `navigate(-1)` but `navigate` is never imported/defined (no `useNavigate`). The "Back" button throws a `ReferenceError` at runtime. Unrelated to the exposure; captured here to avoid losing it.
