# WO-DR-CADENCE-REBUILD — rebuild `dr-storage-backup` properly (SCOPE ONLY, do not build)

**Ruling 2026-08-04 (operator):** treat DR as an **open gap, not a job to restart.** Do NOT re-enable `dr-storage-backup` as it stands — it was disabled for cause (INC-AITOOLS-XTENANT-2026-07-30: orphan deploy, `verify_jwt=false`, compromised `x-smoke-key` with cross-tenant read + R2 delete). Restarting it to fix a backup gap would reopen a cross-tenant exposure. Diagnostic: `docs/platform-operations/incidents/DIAG-2026-08-04-dr-backup-and-quarantine.md`.

## Bucket-lock DEMOTED + admin-token cleanup (ratified 2026-08-07)
**Bucket-lock is demoted from "the backup's guarantee" to "a layer that defends against the DR function's own Object-R/W token (and accidental non-admin deletes), once admin is scoped"** — proven admin-removable (decisive test below). **Admin-token cleanup is the primary control.** Cleanup sequence executing 2026-08-07, replace-then-revoke, one at a time, verify-before-revoke: (1) `floral-fire-d819` orphan-revoke, (2) `silent-shield-signal build` → replace with Workers+Pages-Edit (no R2), verify staging deploy, revoke, (3) `Edit Cloudflare Workers` ×2 → re-`wrangler login`, verify delivery deploy, revoke both, (4) expiry on all remaining, (5) research compliance-mode Object Lock. **Division of labor: token create/revoke = operator (dashboard — the agent has no token-write capability and must not hold one); verification (deploys, run-watching) = agent.**

## ⚠ Admin-token exposure undermines the WORM (2026-08-06) — the lock is worth less while these exist
The R2 tokens page shows **~5 standing tokens with Admin Read & Write on ALL buckets, active, no expiry** — every one can delete `ss-fortress-dr` (the only backup). Two share the name "Edit Cloudflare Workers" (indistinguishable). The correctly-scoped exception is the **2026-07-06 Object-R/W token scoped to ss-fortress-dr only** — that one is right; the admin-all tokens are the problem.

**LOAD-BEARING consequence:** an **Admin** token can manage bucket config — including **removing a bucket-lock rule**. So WORM-via-bucket-lock is only absolute if R2 retention **cannot be removed/shortened even by an Admin token** (compliance-mode WORM). My earlier remove-rule test was inconclusive (wrangler non-interactive). **This must be verified before relying on the lock:** if Admin can remove the rule, these tokens defeat WORM (remove lock → delete); if retention is truly irrevocable, the lock holds and the tokens "only" risk everything else. **Either way, cut the admin-all tokens to least privilege — that is the real control; the lock is secondary.**

**Usage mapping (from repo/CI grep; last-used NOT readable via API without an API-Tokens-Read token — read the dashboard "Last used" column):**
| Token (as listed) | Used by | Revoke breaks | Right scope |
|---|---|---|---|
| **silent-shield-signal build** (User, Mar 4) | almost certainly the `CLOUDFLARE_API_TOKEN` GitHub secret → **only `deploy-frontend-staging.yml`** (staging frontend deploy). Prod `deploy-frontend.yml` does NOT consume it. | staging frontend CI deploy (401) | Workers Scripts Edit + Pages Edit — **no R2 at all** |
| **Edit Cloudflare Workers** (User, Apr 30) ×2 | `wrangler login` OAuth — the delivery `deploy-*.sh` (wrangler deploy) + interactive wrangler (incl. my DR lock test). The **duplicate = two logins** (2 machines / re-login). | the ACTIVE one → wrangler CLI on that machine until `wrangler login` re-auths; the **stale duplicate → safe** if last-used is old | Workers Scripts Edit (+ R2 scoped only if that machine does R2 ops) |
| **floral-fire-d819** (Account, Apr 29) | **no repo/CI reference found** — unknown, likely orphan | probably nothing — confirm last-used first | delete if unused |
| *(2026-07-06 R2 Object R/W, ss-fortress-dr only)* | the DR backup fn creds (`R2_*` Supabase secrets) | the DR backup (once built) | **already correct — the model** |

**Does anything need Admin-on-ALL-buckets? NO.** Frontend deploy = Workers+Pages edit (zero R2). Delivery `wrangler deploy` = Workers Scripts Edit (the R2 binding is config; at most R2-read on the one bucket, never admin-all). R2 bucket/lock management = R2 admin **scoped to the specific bucket**. DR backup = Object R/W scoped to ss-fortress-dr (exists). **Every use case works with a least-privilege scoped token; the admin-all grant is unjustified on all of them.**

**Recommendation (do not revoke yet — operator ruled report-first):** (1) read the dashboard **Last used** per token; (2) for tokens in use, **replace-then-revoke** (mint the scoped replacement, update the GitHub secret / re-`wrangler login`, verify a deploy, then revoke the admin one); (3) revoke `floral-fire-d819` + the stale "Edit Cloudflare Workers" duplicate once last-used confirms they're idle; (4) add **expiry** to every remaining token; (5) resolve the Admin-can-remove-lock question before trusting WORM. **Track as its own hygiene item, gating the DR go-live** — locking the bucket while admin-all keys can unlock+delete it is theatre.

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

## Object Lock resolution (2026-08-05) — read the state, and a discovery that avoids the copy

### Step 1 — actual state of ss-fortress-dr today (read via `wrangler r2 bucket info` + `bucket lock list`)
- **Object Lock / bucket-lock: OFF** — `wrangler r2 bucket lock list ss-fortress-dr` → "There are no lock rules." No WORM today.
- **object_count = 522 · size = 1.85 GB** (created 2026-07-06, WNAM). ⚠ **Discrepancy: the documented 2026-07-06 snapshot was 498 objects / ~1.5 GB — the bucket now holds 24 MORE (0.35 GB).** Source unknown (smoke-test round-trips? manual test-fires? the snapshot was larger?). **Must be reconciled before anything is locked or trusted** — list all 522, confirm each sits under an expected prefix (`investigation-files/feff5c44…`, `hostile-evidence/0aaaaaaa…`, `archival-documents/_unresolved/`, `tenant-files/_system/`), and identify/clean strays. Once locked indefinitely, strays can't be removed.
- **Versioning:** not exposed by wrangler; read it at **Cloudflare dashboard → R2 → ss-fortress-dr → Settings**, or S3 `GetBucketVersioning`. **Moot if we use bucket lock** (a lock rule blocks overwrite regardless of versioning).

### Discovery — R2 bucket lock is addable to an EXISTING bucket → the new-bucket copy is NOT required
`wrangler r2 bucket lock add <bucket> [name] [prefix]` supports `--retention-days` / `--retention-date` / `--retention-indefinite`. **R2's native bucket lock can be applied to ss-fortress-dr in place** (prefix `""` = all objects), making the existing 522 objects (incl. the snapshot) **immutable — no delete, no overwrite — for the retention period, without moving them.** This is strictly safer than copying the only backup (a copy carries its own risk), and it's free. Additive-only then becomes a true **bucket property** (the lock), exactly as required, and it's compatible with the function's additive writes (new date-partitioned keys are created; existing keys can't be overwritten/deleted). One semantic to confirm before relying on it: that a newly-added rule protects **already-uploaded** objects (retention measured from object upload time) — verify on one test object before trusting it for all 522.

### STEP 3 (2026-08-06) — VERIFIED on a throwaway bucket: a lock rule added AFTER upload protects the already-uploaded object
Test on throwaway `dr-lock-test2` (nothing on ss-fortress-dr touched):
1. `wrangler r2 object put dr-lock-test2/probe.txt --file … --remote` → content `original-content-v1` (confirmed remote).
2. `wrangler r2 bucket lock add dr-lock-test2 r1 "" --retention-days 1 -y` → rule added AFTER the upload.
3. `wrangler r2 object delete … --remote` and `object put …(v2)… --remote` → **read-back still returns `original-content-v1`** across repeated attempts. **The pre-existing object was neither deleted nor overwritten → the lock protects already-uploaded objects. CONFIRMED.**

**Two tooling traps found (both = "CLI reports success while the real thing didn't happen" — the week's pattern, at the tool layer):**
- **`wrangler r2 object` defaults to a LOCAL simulator; you MUST pass `--remote`.** Without it, put/get/delete hit Miniflare and *report success* while the real bucket is untouched (my first test run was silently local). The DR function must never use a local-defaulting path.
- **`wrangler r2 object delete` printed "Delete complete." (exit 0) even though the locked object survived.** The CLI success is a lie under a lock. **Ground truth is read-back, not exit code** — which is exactly why the function's cursor advances only on read-after-write verification (design #5), never on a call's reported success.
- (Not cleanly settled: removing a rule to un-protect — wrangler's non-interactive `lock remove` wouldn't execute. Moot for the threat model: the function's token is **Object R/W**, which cannot manage bucket lock rules at all — only an Admin token/dashboard can — so no function code path can shorten or remove the lock.)

### STEP 2 (2026-08-06) — retention: fixed vs indefinite, extend-not-shorten, recommendation
- **Fixed period (`--retention-days N` / `--retention-date YYYY-MM-DD`):** objects are immutable until the retention end; **after it lapses, protection ends and objects become deletable/overwritable again.** Continuous protection requires **extending before expiry.**
- **`--retention-indefinite`:** never lapses — unrecoverable if the wrong thing is locked. (Operator ruled this OUT for the first attempt.)
- **Extend, not shorten:** R2 lock retention (WORM model) can be **lengthened, never reduced below the current protection**; the function's Object-R/W token cannot touch rules at all. So a fixed period is safe to raise later and cannot be silently cut.
- **Retention is measured from object age (upload time), not rule-creation** — so on a 30-day-old snapshot, `--retention-days 90` protects it for only ~60 more days. **Use `--retention-date` (an explicit end date) for a predictable window regardless of object age.**
- **Recommended first lock:** `--retention-date` set to **~90 days out** (a quarter). Long enough that there's no near-term lapse risk, short enough that a wrong-lock mistake self-heals in ≤90 days (not "stuck forever"), and freely extendable as confidence grows. Document a calendar reminder to extend at ~T-14 days. Escalate to a longer rolling window (or indefinite) only after the pipeline has proven itself.

### STEP 1 (2026-08-06) — reconcile the 522: wrangler CANNOT list objects; here is exactly what to run
`wrangler r2 object` only has get/put/delete (single-key) — **no list.** The full 522-object inventory needs the R2 **S3 API** with a token. Exact steps (read-only is sufficient — least privilege):
1. **Cloudflare → R2 → Manage R2 API Tokens → Create** → permission **Object Read only**, scope **ss-fortress-dr only** → note the **Access Key ID + Secret** and your **S3 endpoint** `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
2. Configure aws CLI (`aws configure` with those keys, region `auto`), then:
   - **Full listing (key · size · last-modified · total):** `aws s3 ls s3://ss-fortress-dr --recursive --summarize --endpoint-url https://<ACCT>.r2.cloudflarestorage.com`
   - **Group by top-level prefix:** pipe the above to `awk '{n=$4; split(n,a,"/"); c[a[1]]++; b[a[1]]+=$3} END{for(k in c) printf "%-30s %6d objs  %d bytes\n", k, c[k], b[k]}'`
   - **★ Anything written AFTER 2026-07-06 (the key query — identifies the 24 + any post-snapshot additions):** `aws s3api list-objects-v2 --bucket ss-fortress-dr --endpoint-url https://<ACCT>.r2.cloudflarestorage.com --query "Contents[?LastModified>='2026-07-07T00:00:00Z'].{Key:Key,When:LastModified,Size:Size}" --output table`
3. **Reconcile** the per-prefix counts against the proven 2026-07-06 tally (`investigation-files/feff5c44…`=61 · `hostile-evidence/0aaaaaaa…`=1 · `archival-documents/_unresolved/`=365 · `tenant-files/_system/`=71 = **498**). The extra **24** will appear either as post-2026-07-06 timestamps (the snapshot was added to — the ledger's 498 is stale) or as objects outside the four prefixes (smoke-test artefacts / test-fires / partial uploads to purge **before** locking). **Send me the post-2026-07-06 query output and the per-prefix grouping and I'll classify each.** I can run these for you if you paste a read-only R2 token — but I did **not** create one or read object contents; nothing on ss-fortress-dr was touched.

> **Throwaway cleanup:** the test created buckets `dr-lock-test2` (holds `probe.txt` under a 1-day lock — cleanable after ~2026-08-07 once retention lapses) and `dr-lock-semantic-test` (local-only uploads + a stray rule). I'll delete both after the retention expires; flagging so the two extra buckets aren't a surprise.

### DECISIVE TEST (2026-08-07) — an Admin token CAN remove an active R2 bucket-lock rule → R2 bucket-lock is NOT admin-proof WORM
Empirical, on a throwaway bucket (now deleted): uploaded an object under an **active** "after 1 day" lock rule → confirmed protected (delete blocked, object survived) → then, with an **Admin**-capable credential (the `wrangler login` "Edit Cloudflare Workers" token): `wrangler r2 bucket lock remove <bucket> --name r1` → **"Lock rule removed"**, `lock list` → **"no lock rules"** → deleted the object → **gone.** So R2 `bucket lock` is a **live bucket-level condition, not an irrevocable per-object retention** — removing the rule un-protects everything immediately.

**Answer to "is the lock worth setting at all":**
- **Against the DR function's own credential: YES.** The backup fn's token is **Object R/W**, which **cannot manage lock rules** — so the lock genuinely stops the function (or a compromise of its scoped token) from deleting/overwriting the backup. That protection is real.
- **Against an Admin credential: NO.** Any Admin-all token (the ~5 exposed ones) — and the account owner — can `lock remove` then delete. The lock is **theatre against exactly the threat the exposed tokens represent.**
- **Therefore the ordering inverts:** **cutting the admin-token sprawl is the PRIMARY control; the bucket-lock is a secondary layer that only becomes meaningful AFTER admin is scoped** (then it defends against the function + accidents). Setting the lock first, while 5 admin keys live, protects nothing they can't undo.
- **For true admin-proof immutability** (protection even from account-admin), R2 `bucket lock` is insufficient. That needs **S3 Object Lock in COMPLIANCE mode** — a *different* mechanism, enabled at **bucket creation** (⇒ new bucket + copy), and only if R2 supports compliance-mode object-lock (**verify before relying**). Absent that, accept that account-admin can always delete and mitigate with least-privilege + a second independent copy + delete-alerting.

**Revised go-live gate:** (1) **cut/scope the admin-all tokens** (WO section above) — this is now the load-bearing control; (2) decide bucket-lock (sufficient once admin scoped; defends against the fn) vs compliance-mode Object Lock (new bucket, admin-proof, if supported); (3) then the rest of the sequence. Do not treat the in-place bucket-lock as the backup's guarantee.

### RECOMMENDED sequence (in-place lock — avoids risking the only backup) — REVISED: valid only AFTER admin-token cleanup (see decisive test above)
1. **Reconcile the 522** (list, confirm prefixes, identify the mystery 24, clean strays).
2. `wrangler r2 bucket lock add ss-fortress-dr snapshot-worm "" --retention-indefinite` (or a long `--retention-days`) → snapshot + all future backup objects immutable in place. Verify with `bucket lock list`.
3. Mint an **Object R/W token scoped to ss-fortress-dr only** (the lock, not the token, is what forbids destruction).
4. Provision the signed-GET source-read minter.
5. THEN write the function; incrementals write to `incremental/<date>/…` (new keys only).
6. Acceptance unchanged: two consecutive scheduled successes in `cron_heartbeat` + a restore test on an object created after 2026-07-06.

### ALTERNATIVE — new lock-enabled bucket + copy (if you prefer clean separation)
- **New bucket** `ss-fortress-dr-worm` (create; lock rule added AFTER verified copy, so a bad copy can be redone before locking).
- **Move the 522** with **rclone** (best for R2, preserves metadata + hash): `rclone copy r2src:ss-fortress-dr r2dst:ss-fortress-dr-worm --checksum` (two R2 S3 remotes; needs R2 S3 access key/secret + `https://<acct>.r2.cloudflarestorage.com`).
- **Verify BEFORE touching the original:** (a) `wrangler r2 bucket info ss-fortress-dr-worm` → object_count == 522, size == 1.85 GB; (b) `rclone check r2src:… r2dst:… --checksum` → 0 differences (hashes every object); (c) spot **sha256** on one object per prefix + the largest (~12 MB) downloaded from both, compared.
- **Only after** verification passes: add the indefinite lock rule to the new bucket, point the function at it. **Original is RETAINED untouched** until the new function passes acceptance (two successes + restore test); only then retire it (or keep as a cheap second cold copy).

### Cost delta of two copies during transition
R2 storage = **$0.015/GB-month**. 1.85 GB × 2 = 3.7 GB ≈ **$0.056/month**. One-time copy ops (522 reads + 522 writes) ≈ **< $0.01**. Negligible either way — cost is not a reason to avoid the copy; *risk to the only backup* is the reason to prefer in-place lock.

**My read:** Object Lock is OFF, but it does **not** require a new bucket — R2 bucket lock applies in place, which protects the snapshot without ever copying the only backup. Recommend the in-place path after reconciling the 522. New-bucket path is fully specified above if you'd rather have clean separation. Your call.

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

## RECONCILIATION COMPLETE (2026-08-11) — the 522 explained, and a corrected premise

Read-only Object-RO token (ss-fortress-dr, ~1h TTL), staged to `~/.r2dr.env` (never chat), boto3 S3 listing via `scripts/dr-reconcile-r2.py`. Token revoked + creds file removed after.

**Result: 522 objects / 1.852 GB. ZERO strays — every key under an expected prefix.**
| prefix | objs | vs 2026-07-06 baseline |
|---|---|---|
| archival-documents | 365 | Δ0 |
| investigation-files | 61 | Δ0 |
| hostile-evidence | 1 | Δ0 |
| tenant-files | 95 | **Δ+24** |
| cipher-evidence | 0 | Δ0 |

**The +24 are ALL daily system briefing MP3s** under `tenant-files/_system/briefings/system/`, one per day **2026-07-07 → 2026-07-31**, then nothing. (Post-cutoff query returned 25 files titled July 6–30; the ledger baseline 498 was over by 1 → true pre-snapshot was 497. Immaterial.) Benign, `_system`-scoped, not cross-tenant. **Nothing to purge before locking.**

### The corrected premise (this is the real finding)
The briefing pipeline (`generate-briefing-audio`) writes to **Supabase Storage `tenant-files`**, not R2; **no code references ss-fortress-dr** except the disabled DR function. The 24 MP3s land in R2 at **08:23 UTC daily** — exactly the `dr-storage-backup-daily` cron schedule (`23 8 * * *`, still `active=true`) — from 07-07 until the **2026-07-31 containment 503'd the function.** Therefore:
- **`dr-storage-backup` WAS running daily and copying the incremental delta (the one thing that changed each day — the briefing MP3) from 2026-07-07 → 07-31.** It was NOT "dead for a month."
- **`cron_heartbeat` has 0 rows for it — the function ran and copied but never recorded a heartbeat.** The "believed-closed-for-a-month backup gap" was an **instrumentation illusion**: the health signal was absent, not the work. Ground truth = the R2 objects, not the heartbeat. (Same class as the geo-wildfire false-broken finding, at the object layer: a healthy thing reporting broken because the signal, not the work, was missing.)
- **The REAL backup gap is 2026-07-31 → now (~11 days)**, since the 503 — not 34 days. Incremental briefing backups happened for the three weeks prior.
- **The cron is still active, firing daily into the 503'd function** — a live cron pointed at a contained endpoint (hygiene: pause it, or it keeps hitting the wall until rebuild).

### Implications for the rebuild (not blockers to the lock)
1. **Safe to lock** — no strays, all benign. The `--retention-date ~90d` in-place lock can proceed on operator ruling.
2. **The copy logic was not the broken part** — it demonstrably worked (24 verified incrementals). What was broken: (a) heartbeat instrumentation (0 rows), (b) security posture (verify_jwt=false + compromised smoke key → the containment cause). The rebuild's acceptance gate (2 scheduled heartbeat successes) targets exactly the instrumentation that was missing.
3. **Decide whether ephemeral briefing MP3s belong in DR at all** — they're regenerable daily audio; low restore value. If they're excluded, the daily delta drops to ~0 and the WO's object/byte caps (#3) tighten. (Scope note, not a reconciliation blocker.)
