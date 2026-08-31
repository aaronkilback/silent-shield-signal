# WO-DEPLOY-LANE-REPAIR — make out-of-band deploys impossible to hide

**Status:** LOGGED (do not start). **Opened:** 2026-08-31 (split from WO-SCANNER-DEPLOY-DRIFT).
**Sibling:** WO-SCANNER-SOURCE-RESTORE (Part A — restores the orphan source; started separately).

This WO fixes the *lane*, so a function can never again reach prod without its source landing in the repo
and without the drift check actually running. Five concrete defects, all measured 2026-08-31:

1. **drift step is skipped on every red run.** `security-gate.yml` "deploy-path drift" step has **no
   `if: always()`**, so when an earlier step fails the drift step is skipped. Empirically skipped in the
   latest run because the "security gate" step was red. → add `if: always()` (or move drift to its own job).
2. **`SUPABASE_ACCESS_TOKEN` secret is not configured**, so even when reached, `drift.mjs` no-ops via its
   inline `[ -n "$TOKEN" ]` guard and emits only a `::warning::`. → set the repo secret; make absence a
   hard fail, not a warning, on `main`.
3. **The red tenant-isolation check blocking the gate.** The "security gate" step currently fails on
   pre-existing tenant-isolation findings (e.g. `analyze-sentiment-drift` check2/check5), which is what
   skips drift. → triage/annotate those findings so the gate is green-or-truly-broken, not chronically red.
4. **drift-baseline hygiene.** `drift-baseline.json` allowlists 30 orphans; 19 more are unbaselined. After
   Part A lands the Fortress-domain source, re-baseline to the true residual (other-product orphans only),
   and enforce the ratchet (baseline may only shrink).
5. **Content-drift dimension is unmonitored.** `drift.mjs` checks only the orphan set (deployed⊄repo); it
   explicitly cannot compare bundled `_shared` content (can't reproduce `ezbr_sha256`). The stale
   ai-gateway hid in exactly this blind spot. → add a content-drift signal (e.g. compare each deployed
   function's bundled `_shared/*` against repo, or track deploy-time-vs-`_shared`-git-mtime). Population-
   first per the ratified Population-Before-Check rule.

## Cross-references
- Provenance: WO-SCANNER-DEPLOY-DRIFT Step-1 report (drift step skipped; token unset; 19 unbaselined orphans;
  content-drift = acknowledged tracked gap). Standing rule: **Population-Before-Check** (CLAUDE.md).
- Same silent-signal class as **WO-ERROR-TABLE-UNWATCHED** (written-but-unread) and **WO-SUBSET-RULE-DEFECT**.

## Restore follow-ups (logged 2026-08-31 from WO-SCANNER-SOURCE-RESTORE — do NOT fix now)
The five subject-* entrypoints were committed to the repo (branch `restore/subject-exposure-orphans`).
Three items surfaced during that restore, to be handled by THIS WO / the eventual deliberate deploy:
1. **deliver-subject-exposure-report hardcoded project URL** — `VIEW_BASE =
   "https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/view-subject-exposure-report"` should be
   env-derived, not a baked prod project ref. Code-hygiene fix, not now.
2. **view-subject-exposure-report bundled stale `_shared`** — the deployed bundle carries the old broken
   `userCanAccessClient` (embed-join) as dead code. This is the content-drift dimension (#5 above); a
   redeploy on the repo's current `_shared` clears it. Log only.
3. **`config.toml` has NO entries for any of the five.** On the eventual deliberate deploy,
   **`view-subject-exposure-report` MUST be `verify_jwt=false`** (public token viewer; the default `true`
   breaks client access) and the other four `true`. A naive deploy gets view- wrong. Record against the
   deploy step, not now.

## Do NOT (per ruling)
Log only. Do not touch CI, secrets, the baseline, or drift.mjs yet. Part A (source restore) goes first.
