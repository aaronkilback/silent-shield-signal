# HANDOFF — Registry phantom triage + DR storage backup (2026-09-14)

**State:** platform work parked after this. Only `dr-storage-backup` is authorized to proceed, and only after its design (below) is approved. Everything else in the registry triage is **parked indefinitely**.

## Standing instructions (operator ruling 2026-09-14)
- **Do NOT de-register anything** (the 16 RETIRE jobs stay registered for now).
- **Do NOT fix the two BROKEN jobs** (`auto-archive-stale-entities` schema drift; `monitor-macro-indicators-6am` empty `app.service_role_key` GUC).
- **Do NOT start** the NAME MISMATCH heartbeat-wiring work, the alert-delivery decision, or the semantic-embed freeze-trigger-scope check.
- Build **only** `dr-storage-backup`, scoped as below, design-approved first.

## Database backup floor (confirmed in dashboard)
Supabase **daily physical backups** confirmed restorable, ≥8 days retention, Pro tier (PITR likely — window TBD by operator). **Storage objects are NOT included in database backups.** That is the entire reason `dr-storage-backup` matters.

## Registry phantom triage — outcome (parked, for the record)
35 registered-but-not-completing jobs. Buckets ruled:
- **RETIRE (16)** — de-register later, do not delete functions: `monitor-pastebin`, `monitor-pastebin-6h` (deprecated→cisa-kev); `ingest-world-knowledge-weekly` (dup of daily jobid 109); 13 DEMOTED no-cron legacy monitors (`monitor-community-outreach, -domains, -earthquakes, -emergency-google, -entity-proximity, -facebook, -github, -linkedin, -regional-apac, -regulatory-changes, -travel-risks, -weather, -wildfire-comprehensive`).
- **NAME MISMATCH / heartbeat-wiring gap (8)** — the fix is a heartbeat, which is *also* the only proof they complete; not a tidy-up: `monitor-canadian-sources` (runs as cron `monitor-canadian-every-30min`), `fortress-detect-patterns-6h` (IS the cron that invokes `detect-threat-patterns` — same thing, not superseded, not a second broken job), `source-discovery-weekly`, `retry-dead-letters-hourly`, `stuck-document-recovery-15min` (direct-SQL, genuinely running), plus **reclassified in:** `propagate-knowledge-edges-2h`, and *unproven* `compute-signal-baselines-6h`, `source-credibility-updater-8h`, `prediction-tracker-3h` (dispatch-only; could be silently broken — a heartbeat disambiguates; `prediction-tracker` may be superseded by `resolve-agent-predictions-daily`).
- **BLOCKED — INC-LEARN-CONTAM belief/knowledge freeze, `has_learning_freeze()`=true (6)**: `knowledge-synthesizer-nightly`, `calibration-updater-12h`, `expert-knowledge-sweep-weekly`, `self-improvement-nightly` (documented, no cron), `agent-knowledge-seeker-4am` (explicit freeze-check + `skipHeartbeat`; **latent-broken on unfreeze — `PERPLEXITY_API_KEY` present but 401**), `semantic-embed-knowledge-4h` (blocked *by consequence* — nothing new to embed while frozen; confirm freeze-trigger scope on embedding-only UPDATE before firm-labeling).
- **BLOCKED reclassification:** `propagate-knowledge-edges-2h` was inferred-BLOCKED but reads `agent_investigation_memory` → writes `knowledge_connections`, **neither in the frozen trio** — NOT blocked; it's a wiring gap (no heartbeat call at all). Moved to NAME MISMATCH above.
- **BROKEN (2, do NOT fix per ruling):** `auto-archive-stale-entities` (`column "entity_id" does not exist` — entity_relationships is now entity_a_id/entity_b_id); `monitor-macro-indicators-6am` (empty `app.service_role_key` GUC → malformed JSON → POST never sent, 30/30 cron-failed).

## alert-delivery-v2-email — findings (parked; no ruling taken)
- **Not superseded** by `operator-alert-bridge-15min`. `alert-delivery` = real automated client delivery (verified `client_alert_recipients` pairs); its cron is `active:false` since 2026-08-25 (client delivery deliberately gated pending the recipient model). `alert-operator-bridge` = temporary stopgap (#69) that emails the OPERATOR a digest for manual delivery; never sends to clients, never marks `sent`.
- **Queue not draining to clients automatically.** `alerts`: 14,053 rows — 5 ever `sent`, 14,012 `superseded` (expired undelivered), 36 `pending`. Only 2 active+verified recipients. Bridge is healthy + current (watermark caught up to newest alert 2026-08-28). **Not a silent gap** (operator is in the loop) but not automated delivery either. Also: **0 new alerts since 2026-08-28** — producer has gone quiet (separate signal). The `is_critical` registry row on a disabled cron is a Registry-is-a-Promise lie to resolve later (de-register vs ship recipient model).

## dr-storage-backup — the real gap
Deployed bundle v43 is **HARD-DISABLED (503)** since 2026-07-31 under INC-AITOOLS-XTENANT-2026-07-30 (deploy-drift orphan, leaked hardcoded static secret, over-broad cross-tenant read, arbitrary R2 DELETE). Cron jobid 220 has fired into a 503 daily for 6.5 weeks → 30/30 "succeeded" (POST enqueued) with zero heartbeats and zero artifact. It *was* the storage-bucket→R2 backup. **DB backup does not cover storage → this is a live gap for irreplaceable client data.** R2 contents pre-2026-07-31 unverifiable from SQL (needs `wrangler --remote` read-back); treat R2 as empty-until-proven.

### Protected set (irreplaceable — not derivable from DB rows), ≈1.9 GB
`archival-documents` (1480 MB) · `tenant-files` (355 MB, active) · `ai-chat-attachments` (36 MB) · `investigation-files` (22 MB) · `generated-reports` (5.7 MB, deliverables — content regenerable, exact signed artifact not) · `travel-documents` (4.8 MB). Excluded (derived/re-sourceable): site-audit-media, entity-photos, osint-media, episode-audio, bug-screenshots, codebase-source.

### Approved design (build only after operator sign-off)
1. **Real auth, no static secret.** `verify_jwt=true` at the gateway; server-side accept **service-role only** (env key or rotated vault key via `get_current_service_role_key()`, the `getCallerIdentity` pattern). Cron presents the service-role bearer. No hardcoded `x-smoke-key`.
2. **No delete capability.** Function only LISTs source objects and PUTs to R2. No R2 DELETE, no `cleanup_key`, additive-only. R2 bucket should also have a lifecycle/immutability policy operator-side as defense-in-depth.
3. **Scoped buckets.** Iterate ONLY the protected set above (constant list), preserving `<bucket>/<path>` as the R2 key (tenant-isolated prefix retained).
4. **Incremental + budget/cursor.** Back up objects whose `updated_at` is within a ~25h window OR whose R2 counterpart is missing/size-mismatched. Per-run object + time budget (150s SIGKILL ceiling) with a `{bucket, path}` cursor for resumable first-seed of the 1.9 GB / ~645 objects across runs.
5. **Verified read-back (the point).** After each PUT, HEAD the R2 object and compare Content-Length (and etag/md5 where non-multipart) to the source. An object counts as backed up **only** if read-back matches. `objects_verified` vs `objects_failed` are first-class.
6. **Heartbeat.** `startHeartbeat('dr-storage-backup-daily')` → `completeHeartbeat({buckets, objects_scanned, objects_uploaded, objects_verified, bytes, partial, next_cursor})` or `failHeartbeat`. Registry promise becomes real; acceptance requires **two consecutive scheduled successes** (Two-Successes rule), not a single test-fire.
7. **Secrets to provision (operator sets, per credential-rotation rule):** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (S3-compatible API + aws4 signing; wrangler is unavailable in the edge runtime).

### R2 cost for ≈1.9 GB
- Storage: `$0.015 / GB-month` → 1.9 GB ≈ **$0.03/month**.
- Free tier covers first **10 GB-month** storage + **1M** Class A (PUT/LIST) + **10M** Class B (GET/HEAD) ops/month, and **egress is $0** on R2. Daily incremental is tens of objects; first seed ~645 PUT + ~645 HEAD read-back — both far under the free tiers.
- **Effective cost: $0/month** under free tier (assuming no other account R2 usage pushes past 10 GB); ~$0.03/mo otherwise. At 10× growth (19 GB) ≈ $0.29/month. Cost is not a factor.

**Next action (not this session):** operator approves design → build the function as specified → deploy `verify_jwt=true`, `--project-ref kpuqukppbmwebiptqmog` → seed over cursor runs → confirm two scheduled successes + an R2 read-back before calling it done.
