# WO-DR-CADENCE-REBUILD — rebuild `dr-storage-backup` properly (SCOPE ONLY, do not build)

**Ruling 2026-08-04 (operator):** treat DR as an **open gap, not a job to restart.** Do NOT re-enable `dr-storage-backup` as it stands — it was disabled for cause (INC-AITOOLS-XTENANT-2026-07-30: orphan deploy, `verify_jwt=false`, compromised `x-smoke-key` with cross-tenant read + R2 delete). Restarting it to fix a backup gap would reopen a cross-tenant exposure. Diagnostic: `docs/platform-operations/incidents/DIAG-2026-08-04-dr-backup-and-quarantine.md`.

## Scope (build later, on a separate ruling)

1. **Rebuild the function properly:**
   - **In git** (no more deploy-drift orphan — the current fn was never in the repo).
   - **JWT-verified or service-role-only**, **no static smoke key** (the disabled one's secret was leaked/compromised). Auth from vault (rotated), never a hardcoded literal.
   - **Scoped to only the tenant prefixes it needs** — no blanket read of every tenant bucket. Enumerate exactly which buckets/prefixes (`investigation-files`, `hostile-evidence`, `archival-documents`, `tenant-files`, `cipher-evidence`) and read only those, tenant-segregated.
   - Additive to R2 (never deletes) as before.
2. **Acceptance (NOT a test-fire):**
   - **TWO consecutive successful *scheduled* runs observed in `cron_heartbeat`** under the registered job_name (not a manual invoke, not a single fire).
   - **A restore test on an object created AFTER 2026-07-06** — proves the *incremental* path works, not just the initial snapshot. Byte-identical (sha256) from the correct tenant prefix.
3. **R2 independent confirmation (report — see method below).** Confirm the 2026-07-06 snapshot exists in `ss-fortress-dr` by direct enumeration, not inference from the ledger.

## R2 enumeration — what it would take (operator wants the 2026-07-06 snapshot independently confirmed)

`wrangler r2 bucket list` already confirms `ss-fortress-dr` exists (created `2026-07-06T16:07Z`), but wrangler has **no bulk object-list / count** command. Options to get object count + latest write:
- **S3 API against the R2 endpoint** (cleanest): the 4 secrets Aaron set for the fn (R2 `account_id`, `access_key_id`, `secret_access_key`, bucket) → `aws s3 ls --recursive --endpoint-url https://<account_id>.r2.cloudflarestorage.com s3://ss-fortress-dr | wc -l` for count, and sort by date for latest write. Read-only. Needs those 4 values surfaced to a shell (not currently in this session).
- **Cloudflare API** `GET /accounts/{account_id}/r2/buckets/{bucket}/objects` with an R2-read API token (paginated; sum + max upload date).
- **Per-prefix expected tally to check against** (from ledger): `investigation-files/feff5c44…/`=61, `hostile-evidence/0aaaaaaa…/`=1, `archival-documents/_unresolved/`=365, `tenant-files/_system/`=71, cipher-evidence=0 → **498 total**, latest write ~2026-07-06 (nothing added since — cron never ran).
- **Acceptance for "snapshot confirmed":** object count == 498 (±the 1 incremental the ledger claims was test-fired) AND every object's key carries a resolved-tenant or `_unresolved`/`_system` prefix (no un-prefixed / cross-tenant keys).

## Companion: watchdog probe (scope, part of the standing rule below)

**Probe:** a registered **critical** `cron_job_registry` job with **zero `cron_heartbeat` rows after 48h of registration** fires a **HIGH** finding (currently `registry_phantom_check()` reports `ever_succeeded=false` but the fleet-dormancy-style handling buried DR as one row; this probe makes "registered-critical + never-once-ran past 48h" its own loud finding). This is the enforcement arm of the standing rule — a cadence job that never produces a first heartbeat must scream, not sit as a muted "last: never."
