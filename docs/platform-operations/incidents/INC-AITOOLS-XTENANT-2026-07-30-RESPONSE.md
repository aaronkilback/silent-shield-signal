# INC-AITOOLS-XTENANT-2026-07-30 — Investigation & Remediation Record

Companion to `INC-AITOOLS-XTENANT-2026-07-30.md` (findings) and `INC-EXT-SIGNUP-2026-07-30.md`.
Factual and sourced. Claims cite a git commit, a PR, or the DB query that produced them.
Where evidence is absent, that absence is recorded as a finding — it is not filled with inference.

---

## 1. CHRONOLOGY (three separate timelines — not merged)

### 1a. Vulnerability lifecycle (git)
| Date | Commit / PR | Event |
|---|---|---|
| 2025-11-22 | `be3fe278` | `ai-tools-query` first committed (first appearance in git history for the file). |
| 2026-05-30 | `adce9554` (#79) | **Partial** tenant-isolation fix ("aegis-tenant-isolation R1+R5: receiver-side tenant scoping"). Scoped only certain write/lookup tools (`update_risk_profile`, `lookup_ioc_indicator`); **left the read/search class unscoped**. |
| 2026-06-10 | `411c3ed6` | Emergency env-flag kill-switches on 4 contamination-risk functions. The function header records this switch was "default-ON (absent env = enabled) and therefore unreliable." |
| 2026-06-12 | `48ff0c09` | **Hard-disable** ("Generic Tool Path Clearance — Phase A stub"): returns 503, creates no service-role client, performs no DB read. Vulnerable window closed. |

Window live: **2025-11-22 → 2026-06-12 (~6.5 months).** `verify_jwt=false` throughout, scope derived from caller-supplied `parameters.tenant_id` (source: `git show adce9554:supabase/functions/ai-tools-query/index.ts`, handler line `const { toolName, parameters } = await req.json();`).

### 1b. Discovery (2026-07-30) — honest trigger chain
1. Session work was **WO-PROVENANCE-01** (citation provenance enforcement in the PECL executive report).
2. A **grounding audit** of the regenerated report found unsupported citations (SIG-027390, a wildfire signal, cited for a Uniper LNG claim; SIG-026745 extended to "including Petronas Canada" with no supporting signal).
3. To determine whether the flawed report had been **issued** to the client, the **Resend send history** was pulled (temporary read-only probe, deployed then deleted). It showed the executive report was **never emailed**, but Fortress **Daily Briefings** reached `akilback@petronascanada.com` ~50× (Feb–Apr 2026), and non-newsletter sends reached third-party addresses.
4. The third-party sends prompted an **external-account access audit**, which surfaced **`esanaworldbiz@gmail.com`** — an unrecognized external self-signup (`INC-EXT-SIGNUP-2026-07-30`).
5. That unrecognized account prompted the **service-role edge-function sweep** (WO-SCOPE-EGRESS-01), which found **`create-operator-invite`** (a live super_admin escalation) and **`ai-tools-query`** (the historical cross-tenant path, already hard-disabled 2026-06-12).

The cross-tenant vulnerability was **not** found by a targeted search for it; it was reached by following a provenance defect → issuance question → unknown account → service-role sweep.

### 1c. Response (2026-07-30, timestamped, PT)
| Time | Commit / PR / migration | Action |
|---|---|---|
| 09:18 | `c2204060` (#191) | Citation resolver (9b/9c) + WO-SCOPE-EGRESS-01 logged |
| 09:50–09:51 | `367b2b89` (#193), `38e54c1c` (#194) | Citability enforcement wired into exec brief; awareness disclaimer |
| 10:07 | `d2b93621` (#195) | Debate shaping-only; distinct-publishers; body provenance probes |
| 10:16 | `90b1dc7e` | Persist provenance figures to `meta_json`; deterministic review-queue note |
| 11:03 | `8a00da92` + migration `20260730180000` | Issuance gate (`reports.issuable=false`), claim-manifest schema, delivery halt |
| 11:08 | `ef6a1daa` | Generator persists rendered HTML + claim manifest; null-storage probe; disclaimer fix |
| 11:09 | `2d80844d` | WO-GROUNDING-01 bounded-audit finding + binding-at-derivation design |
| 11:25 | `3ef33419` | Non-citable = hard exclusion at every tier |
| 11:43 | `bb627370` | Provenance note split by relevance band |
| 13:22 | `e47446f4` + Fortress incident `d9062432` | esanaworldbiz preserved, contained (ban + token revoke), logged |
| 13:31 | `7913958d` + migration `20260730193000` | Auto-viewer signup trigger dropped; WO-EDGE-USER-ATTRIBUTION opened |
| 14:02 | `556ef90f` + migration `20260730200000` + Fortress incident `91966d23` | create/accept-operator-invite hardened; watchdog probe (e); breach record opened |
| 14:16 | `d0d946a1` | PECL data-class sensitivity split + operator confirmations |
| 14:34 | `55e6b7c8` + migration `20260730203000` | Field-level PII inventory; determination reversal; LEGAL HOLD |
| 16:52 | `377db48e` | Exploitation-difficulty revised (more severe); empty auth trail recorded |

---

## 2. INVESTIGATION STEPS (ask → query → evidence → conclusion)

**S1 — Was the vulnerable read class actually unscoped?**
Query: `git show adce9554:supabase/functions/ai-tools-query/index.ts`. Evidence: scope derived from `parameters` only; `search_clients` selects `id, name, industry, status, contact_email, locations, signals(count), incidents(count)` with no tenant filter and no `tenant_id` input; `get_recent_signals`/`get_active_incidents`/`search_signals`/`search_investigations` select `client_id, clients(name)` with no `tenant_id`; `update_risk_profile` 404 returns `{ error: "entity_id ${entityId} not found in current tenant scope", entity_id }`. Conclusion: read/search class fully unscoped; error path is a tenant-membership oracle. (Recorded in findings doc Amendment 3, `377db48e`.)

**S2 — Per-invocation records for the window?**
Query: `select count(*), min(started_at) from function_telemetry where function_name='ai-tools-query'`. Evidence: **0 rows**; telemetry earliest 2026-04-30. Conclusion: no per-invocation record exists; exploitation unprovable in either direction.

**S3 — In-database auth trail?**
Query: `select min(created_at), max(created_at), count(*) from auth.audit_log_entries` → **earliest null, latest null, count 0**; `select … from cron.job where command ilike '%audit_log_entries%'` → none; triggers on the table → none. Conclusion: **`auth.audit_log_entries` is empty** — GoTrue events route to the analytics pipeline, not the DB. No in-database auth trail. (Bounding result — absence of evidence.)

**S4 — Organization audit log (dashboard actions: deploys/deletes)?**
Query: Management API `GET /v1/organizations/{slug}/audit-logs` → **404** (no such route in the OpenAPI spec; org routes are only `{slug}, entitlements, members, project-claim, projects`); `/platform/.../audit-logs` → **401 "JWT could not be decoded"** (needs a browser session, not a PAT); org plan via `get_organization` → **`pro`**; docs confirm platform audit logs are **Team/Enterprise only**. Conclusion: **no org audit log exists on the Pro plan.** (Bounding result.)

**S5 — Edge request logs for the window?**
Query: MCP `get_logs(edge-function)` → error / recent-window only. Retention is days, not the ~7 weeks to 2026-06-12. Conclusion: **edge request logs (IPs/UAs/response codes) not retained for the window.** (Bounding result.)

**S6 — Immutable event chain coverage?**
Query: `select min(created_at), count(*) filter (…null actor…) from audit_events where created_at between '2025-11-22' and '2026-06-12'` → min **2026-03-05**, 864 in window, **845 null-actor (98%)**. Conclusion: chain misses the first ~3.5 months and is 98% unattributed where present. (Bounding result / Pillar-1 defect.)

**S7 — Discoverability of the endpoint name.**
Query: `git log -S "ai-tools-query" -- src/` → 3 commits, all **2025-11-22 → 2025-11-25**; current `grep -rn ai-tools-query src/` → empty. Conclusion: the function name was in the public frontend bundle for ~3 days, then removed (routing moved to `dashboard-ai-assistant`).

**S8 — Data timeline per tenant.**
Query (signals `min(created_at)` + in-window counts per `client_id`). Evidence: no tenant data before **2026-03-05** (Petronas first real signals 2026-03-29). Conclusion: **the discoverable window (Nov 22–25 2025) and the data-bearing window (Mar–Jun 2026) do not overlap.**

**S9 — operator_invites exploitation.**
Query: `select count(*) from operator_invites` → **0**. `tenant_users` (9 rows) all traceable to Aaron / test / CRT-onboarding. Conclusion: the escalation path was **never used**.

### Three operator/analyst assessments SUPERSEDED by evidence (record shows tightening)
| Superseded assessment | Corrected by | Evidence | Commit |
|---|---|---|---|
| "esanaworldbiz — no realized data exposure found" | "no *evidence* of exposure; service-role invocations are not user-attributed and would not have been recorded" | `function_telemetry` has no `user_id`; success path unlogged | `7913958d` |
| "create-operator-invite is a dead-end write" (no `tenant_users`, so RLS empty) | "**live super_admin escalation**" — `is_super_admin` keys on `user_roles.role='super_admin'`, bypassing RLS; `create-operator-invite` had **no role allowlist** | `select pg_get_functiondef('is_super_admin')`; `select enum_range(null::app_role)` = `{admin,analyst,viewer,super_admin}` | `556ef90f` |
| "Petronas = open source, no confidential client information" | superseded — PECL person/investigation records hold **confidential, non-OSINT-derivable PII** (employment-separation, ethnicity/nationality, police file, Maximo refs) | field-level query over 788 entities + 2 investigations | `55e6b7c8`, `377db48e` |
| (sub-assessment) "exploitation needed a valid tenant_id UUID first (hardest step)" | "**no tenant_id required** — endpoint name + body shape + one POST" | `git show adce9554` (S1) | `377db48e` |

---

## 3. REMEDIATION (what was wrong → what changed → commit → deployed → verification)

| # | Fix | What was wrong | What changed | Commit / migration | Deployed | Verification |
|---|---|---|---|---|---|---|
| R1 | **ai-tools-query hard-disable** | verify_jwt=false + caller-supplied tenant scope → 22 cross-tenant tools | 503 stub, no service-role client, no DB read | `48ff0c09` (pre-session) | yes | Source at HEAD returns `{disabled:true}` 503 |
| R2 | **create-operator-invite gate** | any authed caller could mint an invite at any role incl. super_admin, any client, no membership check | role allowlist (no super_admin, no role ≥ caller's own); client-scoped invites require caller `tenant_users` admin/owner; participant check mandatory; bare invites rejected; `verify_jwt=true` | `556ef90f`, config.toml | yes (CLI deploy) | esbuild EXIT=0; deployed line printed |
| R3 | **accept-operator-invite allowlist** | granted `user_roles(invite.role)` incl. super_admin; wrote phantom `client_users` (non-existent table) | defensive role allowlist (viewer/analyst/admin only); phantom write removed | `556ef90f` | yes | esbuild EXIT=0; deployed |
| R4 | **Public signup disabled** | open email signup allowed arbitrary self-registration | GoTrue `DISABLE_SIGNUP` toggle | **operator dashboard action — NOT a repo change** | operator-owned | Empirical probe `POST /auth/v1/signup` returned **429 (accepted → email step)** = still ON at last check; flagged as operator-pending |
| R5 | **Auto-viewer trigger drop** | signup trigger auto-granted `viewer` (created_by null) to every new account | dropped `on_auth_user_created_assign_role`/`handle_new_user_role`; stripped `user_roles` insert from `handle_new_user` (profile kept) | `7913958d`, migration `20260730193000` | yes (apply_migration) | `select … from pg_trigger where tgrelid='auth.users'` → only `on_auth_user_created`; `pg_get_functiondef('handle_new_user') ilike '%user_roles%'` → false |
| R6 | **esanaworldbiz ban + token revoke** | unrecognized external account, live refresh token | `banned_until=2100`; all refresh tokens `revoked=true`; session preserved for forensics | `e47446f4` (SQL, auth schema) | yes | `select banned_until, bool_and(revoked)` → `2100-01-01, true` |
| R7 | **Report persistence** | rendered report HTML not persisted → unauditable | upload HTML to `osint-media`; set `storage_url`+`rendered_persisted_at` | `ef6a1daa` | yes | report `4712613a` had `storage_url` populated + 18 manifest rows |
| R8 | **Claim manifest** | no per-assertion citation record | `report_claim_manifest` table (RLS-enabled); one row per rendered `[SIG]` + resolver verdict | `8a00da92` (migration `20260730180000`) | yes | manifest immediately surfaced a non-citable body cite (SIG-027380) |
| R9 | **Issuance gate** | generated vs sent indistinguishable; nothing blocked issuance | `reports.issuable boolean NOT NULL DEFAULT false`; delivery fn refuses executive delivery | `8a00da92` | yes | `select count(*) … issuable=false` → all 154 PECL reports; 0 issuable |
| R10 | **Citation resolver** | reports cited unresolvable/aggregator sources as fact | `_shared/citation.ts` resolver; publisher-kind provenance model | `c2204060` (#191), `d2b93621` (#195) | yes | dry-run 49 citable / review-queue split |
| R11 | **Hard-exclusion tiering** | Amendment-A "demote non-citable to awareness" laundered content | non-citable excluded at every tier; review queue counts non-citable at any relevance | `3ef33419` | yes | regen `b564c74f`: manifest 17 rows, 0 non-citable |
| R12 | **Legal hold** | breach-implicated PECL PII mutable/deletable | `legal_hold` flag on entities/entity_photos/investigations; `block_legal_hold_writes()` BEFORE UPDATE/DELETE triggers; held rows quiesced | `55e6b7c8`, migration `20260730203000` | yes | held 788+15+2; direct update raised `P0001 LEGAL HOLD` |

---

## 4. WATCHDOG CONTROLS ADDED (system-watchdog)

| Probe | Detects | Severity | Negative test |
|---|---|---|---|
| **(a)** active incident whose primary supporting signal is non-citable | non-citable-evidenced incidents accumulating | LOW | Fires on **22 real** rows; **seeded fixture** test: seeded 1 incident on a non-citable signal → count 22→**23, fixture detected**; deleted → **22** (specific). |
| **(b)** review-queue signal (rel≥0.60, non-citable) cited in a report | provenance laundering | CRITICAL | **Seeded fixture** in `report_evidence_sources` referencing a review-queue id → fires **1**; deleted → **0**. |
| **(c)** top-tier-citable source (`official`/`wire`) with `provenance_path='none'` | miswritten provenance on a source that should be citable | LOW (corrected from CRITICAL per ruling 9a) | **Not independently fixture-tested this session** — recorded honestly as a coverage probe pending a seeded negative test. |
| **(d)** executive report generated in 24h with NULL `storage_url` | Pillar-1 persistence failure | CRITICAL | Fired on **5 real** unpersisted reports. (Fired on real known-bad, not a synthetic fixture — noted.) |
| **(e)** `operator_invites` whose creator lacks tenant membership for that client | cross-tenant/escalation invite | CRITICAL | RPC `operator_invite_membership_check()` (migration `20260730200000`); **seeded fixture** (vinced/CRT → Petronas client) → fires **1, fixture detected**; deleted → **0**. |

Standing rule applied: a probe is not "live" until it fires on a known-bad row. (a), (b), (e) have seeded-fixture proofs; (d) fired on real known-bad; **(c) is not yet fixture-tested** and is flagged as such.

---

## 5. SCOPE DETERMINATION

Exploitation difficulty (corrected, `377db48e`): **no authentication, no tenant identifier, no pivot** — endpoint name + request-body shape + a single POST. The read/search class was callable with no `tenant_id`.

**Per-tenant data-class inventory (data present AND vuln live, to 2026-06-12):**
| Tenant / client | First data | Signals | Sensitivity (operator-confirmed) |
|---|---|---|---|
| Petronas Canada (Silent Shield Ops) | 2026-03-29 | 992 | see below |
| BC Place (Critical Risk Team) | 2026-05-18 | 153 | open-source data only (operator-confirmed) |
| Trent Reznor (Critical Risk Team) | 2026-05-20 | 11 | test tenant, zero personal data (operator-confirmed) |
| Kilbacks (SSO, personal) | 2026-06-11 | 26 | personal/test tenant (Aaron) |
| Cascade / _qa / _benchmark / _invariant | — | — | test tenants |

**PECL signals (992):** 100% public-OSINT origin (news-google 324, unknown-legacy 456, rss 142, naad 43, cisa-kev 16, wildfires 9, csis 2). No private-intelligence source.

**PECL client record (1 `clients` row):** high_value_assets 7 · locations 18 · monitoring_keywords 42 · competitor_names 9 · supply_chain_entities 15 · employee_count present · risk_assessment/threat_profile/monitoring_config populated. Proprietary business intelligence, not personal.

**PECL personal data — 788 person entities** (field names; populated of 788): name 788 · description 344 · risk_level 288 · threat_score 177 · threat_indicators 157 · aliases 45 · phone 29 · email 27 · contact_info 24 · current_location 12 · associations 11 · employment 11 · home-address 3 · social handles 2 · nationality/ethnicity 1 · ai_assessment 0. Flagged: **photographs 15** (`entity_photos`), home addresses 3, associates 11 (+2 relationship edges), employment history 11, social handles 2; **none** for DOB / vehicle-property / family. Employment-separation (`former_employee`, `termination_reason`) and ethnicity/nationality are **not OSINT-derivable**.

**PECL investigations — 2:** file_number/maximo_number/prepared_by/created_by_name/synopsis/file_status/intake_email_tag 2 · correlated_entity_ids 2 · information 1 · **police_file_number 1** · recommendations/incident_id/cross_references 0. `maximo_number` + `police_file_number` indicate **PECL-internal / law-enforcement origin**.

Personal-data weight of the exposure lands almost entirely on **PECL (788 person entities)**; CRT's clients are confirmed low-sensitivity.

---

## 6. OPEN ITEMS
- **Item-4 triage** — full classification of the 232 `verify_jwt=false` functions + the ~25 request-client-scoped functions with their gates. Not done.
- **PIPEDA reportability decision** — pending counsel. Inputs: §5 inventory + corrected exploitation difficulty + non-retention of all logs.
- **CRT notification decision** — vinced@criticalriskteam.com is a legitimate CRT admin; CRT data confirmed open-source/test. Operator decision.
- **3Si licensing / contractual dimension** — operator states the sensitive fields derive from 3Si vendor documents (statement 3, findings-doc Amendment 4); **not corroborated in the DB** (no document link / no 3si-tagged upload). A contractual dimension may apply; classification of the data as in-scope PII is unchanged regardless of source.
- **Sensitive-field provenance gap** — the special-category fields (ethnicity/nationality) and HR-class fields (termination_reason/former_employee) on the 2 entities carry **no source attribution** in the DB; one was hand-entered. Provenance for special-category data should be required at write time.
- **Operator statements pending verification** — S1 (test/parallel use; PECL SoR) is consistent with timing (81% of person entities predate operational monitoring) but not confirmable as intent from data; S2 (2 investigations exercised the interface) consistent (both hand-created by Aaron 2026-05-04, closed); S3 (3Si-sourced) not corroborated. See findings-doc Amendment 4.
- **WO-EDGE-USER-ATTRIBUTION** (`7913958d`) — add `user_id` to `function_telemetry`; forensic prerequisite. Not built.
- **entity-by-UUID cross-tenant write bug** — the pre-containment `ai-tools-query` comment ("mutated any entity by UUID regardless") indicates a second write-side cross-tenant defect; not independently remediated (function is disabled, so latent).
- **audit_events null-actor Pillar-1 defect** — 98% null-actor; no reliable actor attribution. Not fixed.

---

## 7. PREVENTIVE MEASURES — **PLANNED, NOT YET BUILT** (do not read as done)
- **CI gate** — static check that no `verify_jwt=false` function reads a client/tenant id from the request without a caller-membership check. *Planned.*
- **Log drain** (Pro add-on) — export edge/Postgres logs to retained external storage so future invocations are auditable. *Planned.*
- **Data inventory** — canonical per-tenant personal-data map (what PII each tenant holds, where). *Planned.*
- **Service-role least-privilege sweep** — Item-4; reduce the 294 service-role functions to least privilege. *Planned.*
- **Config-drift probes** — watchdog check that security-critical `verify_jwt` settings match an allowlist. *Planned.*
- **Third-party security review** — external review of the tenant-isolation model. *Planned.*

None of §7 is implemented; it is recorded as forward intent only.
