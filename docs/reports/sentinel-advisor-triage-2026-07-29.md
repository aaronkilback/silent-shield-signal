# Sentinel Advisor Backlog — Triage (2026-07-29)

Evidence-before-remediation on the 4 flagged advisor classes. Sequence 1 → 3 → 2 → 4/5.
Sunday's RLS/anon seal held (0 exposed); this triage tested whether views/buckets/policies
hide any exposure *past* that seal.

## Item 1 — security_definer_view ×8 (DONE + HELD)

8 postgres-owned SECURITY DEFINER views, all anon+authenticated readable (definer = bypasses
RLS on underlying tables). Empirical anon-role read + underlying-table sensitivity:

| View | Underlying | Anon rows now | Verdict |
|---|---|---|---|
| `agent_actions_awaiting_approval` | **signals** (tenant intel) | 0* | **SEALED** — revoked anon+auth (INC, RLS bypass) |
| `agent_actions_24h` | **agent_actions** | 0* | **SEALED** |
| `stuck_documents` | **archival_documents** (client docs) | 0* | **SEALED** |
| `stalled_cron_jobs` | cron_heartbeat/registry | 76 | operational — **HELD for ruling** |
| `function_telemetry_24h` | function_telemetry | 45 | operational — HELD |
| `dlq_health` | dead_letter_queue | 13 | operational — HELD |
| `function_jobs_throughput_24h` / `function_jobs_failed_24h` | function_jobs | 10 / 4 | operational — HELD |

*0 rows only because no data currently matches the view filters — the 3 underlying tables
have RLS enabled + anon denied *directly*, so the definer view was a genuine latent bypass
(structural exposure, not absent). Sealed under standing authorization.

**HELD ruling (5 operational views):** they leak job/telemetry/cron data (not tenant/client)
to anon+authenticated. Recommend: convert to `security_invoker` (RLS applies) OR revoke
anon+authenticated (operator/service-role only). Ruling per view. (`geometry_columns` /
`geography_columns` are supabase_admin PostGIS system views — not ours.)

## Item 3 — public_bucket_allows_listing ×3 (EVIDENCE + HELD)

The 3 public-listing buckets are **`email-assets`, `message-attachments`, `agent-avatars` —
all EMPTY (0 objects).** No client/tenant/report data is exposed. Everything sensitive is in
**private** buckets: `archival-documents` (365 — Petronas security/risk reports), `tenant-files`
(94 — **generated daily-briefing MP3s**), `site-audit-media` (156), `investigation-files`,
`entity-photos`, `osint-media`. **Not the worst item — briefs + client docs are private.**

**HELD ruling:** `agent-avatars` public=true contradicts CLAUDE.md (documented private + signed
URLs) — drift, recommend flip to private. `message-attachments` → recommend private.
`email-assets` → likely intentional (email image rendering) — confirm.

## Item 2 — rls_policy_always_true ×7 (EVIDENCE + HELD)

The advisor flags the `authenticated`-role `USING (true)` SELECT policies (the `*_global_read`
set). Service-role `USING true` policies are NOT defects (service-role is trusted). Of the 10
authenticated-global-read tables, only ONE is owner-scoped:

- **`academy_credentials`** (has `user_id`; columns include `full_name, pre_score, post_score`;
  **0 rows now**) → the always-true `authenticated` policy is a **no-op on an owner-scoped table**:
  any logged-in user would read every user's name+scores. **The seal is theater here.**
  Recommend real policy `USING (user_id = auth.uid())`. Empty now = low urgency. **HELD.**
- The other 9 (`environment_config` [env flags, no secrets], `world_geographies`,
  `world_geography_layers`, `world_knowledge_sources`, `macro_indicators`,
  `wildfire_station_ratings`, `expert_profiles`, `academy_scenarios`,
  `onboarding_required_versions`) have **no owner columns** → lookup/vocab/reference →
  **intentional global-read, documented as fine.**

## Item 4 — auth_leaked_password_protection (OPERATOR ACTION)

Toggle location: **Dashboard → Authentication → Providers → Email → "Password" → "Prevent use
of leaked passwords"** (HaveIBeenPwned; Pro plan+). One operator click.

## Item 5 — search_path hygiene (DONE)

Pinned `search_path = public, extensions` on our 4 fresh RPCs (`has_learning_freeze`,
`record_platform_finding`, `sentinel_rls_posture`, `score_signal_hazard_pathway`) — fixes
`function_search_path_mutable` for the ones we own. The remaining ~200 definer-function lints +
23 `rls_enabled_no_policy` INFOs get a class-allowlist-or-batch decision AFTER items 1–3 resolve.

## Net

Sunday's seal held — no anon/RLS-disabled exposure. This triage sealed 3 latent RLS-bypass
views (INC), found the sensitive storage safely private, and identified one genuine no-op RLS
policy (`academy_credentials`, empty). The advisor backlog is real but mostly hygiene; the two
exposure-risk classes (views, buckets) are resolved/clear.
