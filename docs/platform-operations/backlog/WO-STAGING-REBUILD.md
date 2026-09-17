# WO-STAGING-REBUILD — rebuild staging from main; preserve the staging overlay

**Status:** OPEN — filed 2026-09-16 from the WO-STAGING-PARITY report. **Do NOT merge `staging`→`main`. Do NOT rebuild tonight.** Leave staging untouched (currently `origin/staging` = `c65aca51`).

## Why
Staging is a **frozen ~May–July 2026 snapshot**, drifted by neglect — not a competing line of development. Merge-base `f7cdeec5` (2026-05-13); **main is 865 commits ahead, staging 66**, and **37 of those 66 already re-landed on main** (patch-equivalent) — which is exactly why `main→staging` throws a **44-file conflict** (duplicated work, not divergent intent). Verified via `git cherry origin/main origin/staging` (37 `-`, 29 `+`).

## Drift (from the parity report)
- **Schema:** prod 403 tables vs staging 336 — staging missing 81 (whole families: subject/VIP exposure, academy, podcast, traveller, cipher, attribution gate, newer instrumentation); carries 14 older-architecture experiments (older `aegis_*` tracing, DGIC/capability/governance).
- **Edge functions:** prod 366 vs staging 308 — 69 missing from staging (incl. `subject-*`, `dr-storage-backup`, `agent-sentinel`, `aegis-qualify*`, `alert-operator-bridge`, `dispatch-critical-sms`, …); 11 staging-only experiments.
- **Cron:** prod **86** vs staging **4** — staging runs no monitoring/ingest pipeline (UI/manual surface only). Staging's own `detect-schema-drift-daily` watchdog is healthy but only watches staging-internal, not staging-vs-prod.
- **Secrets:** not enumerable via MCP — verify in dashboard. Staging known to lack Twilio (→ MFA bypass), has Resend.

## The rebuild (when scheduled)
1. **Rebuild staging from `main`** (do not merge the stale branch forward).
2. **Preserve only the ~29 genuinely-staging-only overlay commits** as a small staging overlay:
   - `Auth: bypass mandatory MFA on staging` (`6c98b111`, keyed on staging project ref).
   - staging emergency containments (`alert-delivery`/`alert-delivery-secure`/`vip-deep-scan`/`manage-incident-ticket`/`voice-tool-executor-v2` deny-all).
   - staging CI/workflow plumbing + `detect-schema-drift-daily`.
   - Phase-0/Tier-0 planning docs.
3. **NEVER carry to prod:** the **14 `verify_jwt=false` functions** that are `true` on prod (`send-sms`, `execute-approved-action`, `entity-deep-scan`, `create-incident-job`, `create-operator-invite`, `generate-decision-candidate`, `compute-client-relevance`, + the 8 staging-only experiment functions). This is the blanket `--no-verify-jwt` deploy trap — a staging-only auth posture, not a prod change.
4. Before any Step-7 staging screenshot verification: staging must carry main's frontend + edge functions + the relevant schema, and a data-population decision is needed (schedule the required `monitor-*`/`job-worker`/`process-pending-docs` jobs, OR seed the staging load fixture — Petronas Canada `0f5c809d-…`, ≥30 keywords — manually).

## Consequence for FINISH-HOTFIX Step 7
Deferred by ruling. The prod served-bundle read-back was accepted as acceptance proof; the visual screenshot is optional and can be captured on prod against a real unscored client, or after this rebuild.
