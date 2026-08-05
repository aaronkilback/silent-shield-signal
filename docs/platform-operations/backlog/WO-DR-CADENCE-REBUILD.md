# WO-DR-CADENCE-REBUILD — rebuild `dr-storage-backup` properly (SCOPE ONLY, do not build)

**Ruling 2026-08-04 (operator):** treat DR as an **open gap, not a job to restart.** Do NOT re-enable `dr-storage-backup` as it stands — it was disabled for cause (INC-AITOOLS-XTENANT-2026-07-30: orphan deploy, `verify_jwt=false`, compromised `x-smoke-key` with cross-tenant read + R2 delete). Restarting it to fix a backup gap would reopen a cross-tenant exposure. Diagnostic: `docs/platform-operations/incidents/DIAG-2026-08-04-dr-backup-and-quarantine.md`.

## Six design answers (2026-08-05, before any code) — every guarantee STRUCTURAL, not "the code is careful"

**1. Scope enforcement — explicit prefix allowlist, hard STOP outside it (never a skip).**
The old function *enumerated every tenant bucket* (`investigation-files, hostile-evidence, cipher-evidence, archival-documents, tenant-files`) — the cross-tenant read path with auth in front. Replace with a **static, code-committed allowlist** of `{bucket → allowed key-prefixes}`, seeded from the proven 2026-07-06 tally: `investigation-files/feff5c44…/`, `hostile-evidence/0aaaaaaa…/`, `archival-documents/_unresolved/`, `tenant-files/_system/`, (`cipher-evidence` empty). The function **lists only those bucket+prefix pairs** — it never calls "list all buckets." If enumeration returns any object whose key is **not** under an allowlisted prefix → **ABORT the whole run + raise a HIGH finding** (not skip-and-continue — a skip normalizes drift; an abort forces a human to look). Structural reinforcement: the R2 write credential is scoped to only `ss-fortress-dr`, and source reads are scoped to only the allowlisted buckets (see #4), so "touch something else" isn't reachable even on a logic bug.

**2. Credential capability — R2 has NO native put-only token; additive-only comes from the BUCKET, not the token.**
R2 API-token permission groups are only: *Admin R/W · Admin RO · Object R/W · Object RO*. **There is no write-only / no-delete / no-overwrite permission.** So "additive-only as a credential property" is **not achievable via the R2 token alone** — an `Object R/W` token can overwrite and delete. The honest structural answer:
- Provision an **`Object Read & Write` token scoped to only `ss-fortress-dr`** (Cloudflare → R2 → Manage API Tokens → permission Object R/W → bucket = ss-fortress-dr only). That *is* a real token property: it cannot touch any other bucket. But it can still overwrite/delete **within** ss-fortress-dr.
- The **no-overwrite / no-delete guarantee therefore must come from the bucket: enable Versioning + Object Lock (WORM, compliance-mode retention)** on ss-fortress-dr. With those on, an overwrite creates a new version (old retained) and a delete is blocked/marked (prior versions immutable for the retention window) — **regardless of what the credential is allowed to call.** ⚠ **Object Lock generally must be enabled at bucket creation**; ss-fortress-dr (created 2026-07-06) likely lacks it → provisioning step = create a **new lock-enabled bucket** and copy the snapshot in, or at minimum enable **versioning** now (verify current state in the R2 dashboard). *The credential restricts WHERE; Object Lock restricts WHAT-CAN-BE-DESTROYED.*

**3. Blast radius if the cursor breaks — per-run object cap + byte cap that ABORT and raise a finding.**
Full set = **498 objects / ~1.5 GB**; expected daily delta ≈ **0–5 objects, < 50 MB** (Storage objects rarely change; the ledger's test-fire copied 1). If the `updated_at` cursor fails and it tries to re-copy everything, that's a cost + integrity event. **Proposed hard caps, checked BEFORE any write, abort-on-exceed:**
- **Object cap = 50 / run** — 10× a generous daily delta, but ~1/10 of the full 498, so a "copy everything" bug trips immediately instead of running a 498-object re-upload.
- **Byte cap = 250 MB / run** — well above a real delta, well below the 1.5 GB full set (largest single object ~12 MB).
Exceeding either → **abort the run, copy nothing further, raise a HIGH finding** ("DR delta exceeded cap N — cursor suspect"). The caps are the structural backstop for cursor logic failure; they do not depend on the cursor being correct.

**4. Source safety — the function must hold NO Supabase credential that can modify/delete a source object.**
`service_role` bypasses RLS and can delete/overwrite Storage — so **the backup worker must not run source reads under `service_role`.** Structural options, strongest first:
- **(a) Signed-GET-URL only:** a separate minimal privileged step mints time-limited **download** URLs for the allowlisted objects; the backup worker receives only those URLs and does GETs. It holds **no write-capable Storage credential at all** → it *structurally cannot* modify/delete a source (no code path exists because no capability exists). Recommended.
- **(b) Read-only Storage role/S3 key:** run source reads under a credential granted only `select`/list on the storage schema (custom DB role, or a read-only Supabase S3 access key if scoping supports it — **verify availability**), never `service_role`.
Either way: the guarantee is "no delete/update capability is held," not "the code never calls delete."

**5. Partial run — RESUME, with a cursor that only advances on CONFIRMED copies.**
Choose **resume** (cheaper, and additive PUTs are idempotent so re-copying a partial is harmless). Structural rule: the cursor is **"max `updated_at` of objects VERIFIED present in R2"** and advances **per-object, only after a read-after-write / ETag confirms the object landed** — never by "objects we intended to copy." A crash mid-run leaves the cursor at the last *confirmed* object; the next run re-lists from there and re-copies anything unconfirmed. **A partial run cannot advance the cursor past an object it did not copy** because advancement is gated on post-write verification, not on iteration progress.

**6. Protecting the 2026-07-06 snapshot — structural, holds regardless of code correctness.**
Today it's the only backup in existence. Two independent structural protections, use both:
- **Separate, immutable prefix + append-only layout:** the snapshot stays at its existing keys; **all incrementals write to a date-partitioned prefix** (`incremental/<YYYY-MM-DD>/…`) — first run (and every run) targets keys that **cannot collide** with the snapshot keys. A same-key overwrite is not in the address space.
- **Versioning + Object Lock (WORM) on the bucket** (per #2): even if a bug or credential tried to overwrite/delete a snapshot key, versioning retains the prior version and Object Lock blocks destruction within retention. ⚠ requires enabling on the bucket (likely a new lock-enabled bucket + copy-in, since Object Lock is set at creation).
Neither depends on the new function behaving well: one removes the collision from the address space, the other makes destruction impossible at the storage layer.

**Provisioning prerequisites before code (all operator-side, none are "be careful"):** (i) confirm/enable **Versioning + Object Lock** on ss-fortress-dr (or create a lock-enabled successor + copy the 2026-07-06 snapshot in); (ii) mint an **Object R/W token scoped to ss-fortress-dr only**; (iii) decide the **source-read mechanism** (signed-GET-URL minter vs read-only Storage key) and provision it; (iv) the acceptance gate (two scheduled successes + a post-2026-07-06 restore test) is unchanged.

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
