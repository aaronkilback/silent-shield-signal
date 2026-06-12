# Slice F — 2-Client Runtime Proof Evidence Package (for Codex)

- **Status:** EVIDENCE COMPLETE — submitted for Codex acceptance. **Slice F is NOT SAFE until Codex accepts this package.**
- **Date:** 2026-06-11
- **Scope (do not broaden):** Active status/threat surfaces cannot display, summarize, or mutate Client B data while Client A is selected.

## Environment

- **Prod project:** `kpuqukppbmwebiptqmog`
- **Tenant:** Silent Shield Operations `feff5c44-c77b-4e02-b247-aa5a44a8b751`
- **Client A (selected):** Cascade Energy `5f41e328-e9d8-482c-b755-839a4ad3c739` (fictional, operator-approved)
- **Client B (forbidden):** ConocoPhillips — Prospect (Demo) `b14eaa08-924d-444e-8770-21354a2e51ec`
- **Deployed versions under proof:** `threat-radar-analysis` **v89**, `dashboard-ai-assistant` **v211**, `agent-chat` **v138**, frontend `origin/main` (Cloudflare).
- **Boundary doctrine:** the security boundary is the **backend** (service-role functions). Client-id scoping there contains all callers (page, Aegis chat, agent-chat).

---

## 1. `threat-radar-analysis` v89 — byte verification (live bundle)

Containment (verified on the deployed bundle via `scripts/verify-tra-containment.py`, all 8 gates PASS):
- deployed version > 87 ✓
- `CLIENT_CONTEXT_MISSING` (400 when no client) ✓
- all **7** source reads scoped by `client_id` (signals, incidents, entities, internal_assets, threat_precursor_indicators, sentiment_tracking, radical_activity_tracking) ✓
- `signals` / `incidents` / `entities` additionally scoped by `tenant_id` ✓
- `entity_mentions` scoped **only** through in-scope `signal_id`s ✓
- no `client_id || null` fallback ✓
- no unscoped global source reads remain ✓

Authorization fix (P0-A, byte-verified on v89):
- authorizes via canonical RPC `getAccessibleClientIds` (same join RLS uses on `clients`) **+** honors `user_roles` super_admin ✓
- the broken `userCanAccessClient` (clients→tenant_users!inner embed with no FK; fail-closed-false for all tenant users) is **removed** — no call, no import (only named in an explanatory comment) ✓
- `client_id` still required (400); unauthorized still fails closed (403) ✓
- **Result:** valid tenant members are authorized; cross-client source data is structurally excluded.

## 2. `dashboard-ai-assistant` v211 — byte verification (live bundle)

`analyze_threat_radar` tool (6/6 markers PASS):
- tenant-wide signal fallback **removed** (no `signals.eq("tenant_id")` fallback) ✓✓
- requires a resolved `client_id`; missing → fail-closed "Select a client before running ThreatRadar analysis." ✓
- forced pre-route no longer force-calls the client-specific tool without a client_id ✓
- backend rejection surfaces a `fail_closed` response (never a tenant-wide summary) ✓

## 3. `agent-chat` v138 — byte verification (live bundle)

Client binding (marker `AGENT_CHAT_ANALYZE_THREAT_RADAR_CLIENT_BINDING_V1`) + 500-fix:
- authoritative request `client_id` is required; missing → fail-closed ✓
- model/tool `args.client_id` cannot override; mismatch → `CLIENT_BINDING` refusal ✓
- invoke body uses the authoritative `client_id`, **not** raw `args.client_id` ✓
- TDZ bug fixed: `supabase` client created **before** its first use (flight recorder); single declaration ✓ (was: 500 "Cannot access 'supabase' before initialization" on every call)

## 4. Cascade / Conoco fixture integrity (MCP read, prod)

| marker | id | client_id | placement |
|---|---|---|---|
| `SLICE_F_CLIENT_A_VISIBLE_PROOF` (signal) | `f11ce0a0-…-a1` | `5f41e328…` | **Cascade (A)** ✓ |
| `SLICE_F_CLIENT_B_SENTINEL_DO_NOT_LEAK` (signal) | `f11ce0b0-…-b1` | `b14eaa08…` | **Conoco (B)** ✓ |
| `SLICE_F_CLIENT_B_MISSION_DO_NOT_LEAK` (mission) | `f11ce0b0-…-b2` | `b14eaa08…` | **Conoco (B)** ✓ |
| `SLICE_F_CLIENT_B_INCIDENT_DO_NOT_LEAK` (incident, open) | `f11ce0b0-…-b3` | `b14eaa08…` | **Conoco (B)** ✓ |
| `SLICE_F_CLIENT_B_CORR_DO_NOT_LEAK` (corr group) | `f11ce0b0-…-b4` | `b14eaa08…` | **Conoco (B)** ✓ |

Fixture correctly placed: A-visible record in Cascade; all forbidden sentinels in Conoco. No Petronas record touched.

## 5. Row-survival PASS — Conoco sentinel mission

`f11ce0b0-0000-4000-8000-0000000000b2` before vs after the proof: `client_id = b14eaa08` (Conoco), **phase `intake`**, name unchanged → **0 rows mutated**. The B mission was never opened, aborted, or deleted through the Client-A surface (no UI affordance to do so).

## 6. Live runtime proof — #10 cross-client refusal (operator browser, screenshot on file)

- Client context: **Cascade Energy** selected throughout.
- Action: asked Aegis (`agent-chat`) to "analyze threat radar for client `b14eaa08-924d-444e-8770-21354a2e51ec`" (Conoco/B).
- Result: **refused** — *"I cannot perform a threat radar analysis for the specified client ID as it does not match the current client context."*
- Network: `agent-chat` returned **200** (no longer 500); **no Conoco data returned**.
- Proves: backend is **not** invoked with Client B when Client A is the authoritative selected client.

---

## Checklist coverage (runtime-observed vs byte-verified)

| # | Item | Evidence |
|---|---|---|
| 1 | ThreatStatusBar A-only counts | frontend client-scoping byte-verified; backend boundary byte-verified |
| 2 | Matching A-only correlations | frontend client-scoping byte-verified |
| 3,4 | ThreatRadar analysis excludes B sentinel | backend v89 scopes to `client_id=Cascade` → Conoco sentinel structurally excluded (byte-verified); browser: ThreatRadar returns 200 / updates |
| 5,6 | B mission unreachable + unmutated | **browser screenshot** (TaskForce 0 missions for Cascade) + **MCP row-survival unchanged** |
| 7 | No selected client → fail-closed | frontend byte-verified (enabled-gated; "select a client" states) |
| 8 | Aegis `analyze_threat_radar` excludes B | dashboard-ai-assistant v211 byte-verified (require client + no tenant-wide fallback); agent-chat 200 |
| 9 | agent-chat authoritative A | agent-chat v138 byte-verified; returns 200 |
| 10 | agent-chat mismatch → refusal | **live browser screenshot** — Aegis refused, agent-chat 200, no Conoco data |

**Honest note for Codex:** items 5/6 and 10 are observed live in the browser; items 1,2,3,4,7,8,9 are guaranteed by **byte-verified backend client-id scoping + frontend client-scoping** (the boundary), with the surfaces confirmed functioning (200s). The backend is the security boundary, and it is proven at the bundle level to scope every source query to the selected client.

## Known caveats (non-blocking, tracked separately)

- MissionView/TaskForce scoped delete is **not transactional** across child rows — proper fix is a `SECURITY DEFINER` RPC (separate hardening debt; cross-client parent mutation is impossible through the real surface).
- `client_risk_snapshots` table absent on prod → that snapshot write silently no-ops (pre-existing).
- A `deploy-functions` CI-failure window earlier meant some commits didn't deploy; controls assumed live during it were re-verified by deployed bundle.

## Decision

**Slice F is NOT SAFE until Codex accepts this package.** On Codex acceptance, the remaining steps are: mark Slice F SAFE, then clean up the 5 sentinel fixture records (cleanup SQL on file). Do not clean up the fixture before acceptance.
