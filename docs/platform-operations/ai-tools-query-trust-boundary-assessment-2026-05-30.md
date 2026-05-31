# `ai-tools-query` Trust Boundary Assessment — 2026-05-30

**Read-only assessment. No implementation. No code. No branch. No configuration change.**

**Inputs:** Task #105 / #106 / #109 + post-PR #77/#78/#79 state; repo grep; `supabase/config.toml`; CLAUDE.md.

---

## §A — Caller Inventory

### A.1 — Identified production callers

| Caller | Edge function | Route | Workflow | Tools invoked | User type |
|---|---|---|---|---|---|
| `dashboard-ai-assistant/index.ts:4399` | `dashboard-ai-assistant` (service-role) | `supabaseClient.functions.invoke("ai-tools-query", { body: { toolName, parameters: { ...args, tenant_id: tenantId } } })` | Aegis chat — when LLM emits `lookup_ioc_indicator` tool call | `lookup_ioc_indicator` only | Authenticated dashboard users (super_admin / analyst / operator) routed via service-role |
| `dashboard-ai-assistant/index.ts:4550` | `dashboard-ai-assistant` (service-role) | same invoke shape | Aegis chat — when LLM emits `update_risk_profile` tool call | `update_risk_profile` only | Same as above |

### A.2 — Identified broken / inactive callers

| Caller | Status | Evidence |
|---|---|---|
| `agent-chat/index.ts:1920` | **Pre-existing broken.** Sends `body: { tool: 'lookup_ioc_indicator', indicator, indicator_type, client_id }` — flat shape with wrong key (`tool` instead of `toolName`). ai-tools-query destructures `{ toolName, parameters } = await req.json()` so `toolName` is `undefined` → falls through to `default: result = { error: "Unknown tool" }`. | Code at agent-chat:1920 + ai-tools-query:14, :871-872 |

### A.3 — Identified non-callers

| Surface | Result |
|---|---|
| Frontend (`src/`) — React components / pages / hooks | **Zero hits** for `ai-tools-query` (grep) |
| Scripts (`scripts/`) | Zero hits |
| GitHub Actions (`.github/`) | Zero hits |
| Smoke tests (`scripts/test-aegis-tools.mjs`) | Zero hits |
| External services / webhooks | None documented |
| Cron jobs (`pg_cron`) | Zero hits (`ai-tools-query` does not appear in `cron.job`) |

**Net empirical reality:** `ai-tools-query` has **exactly one live caller path** — the `dashboard-ai-assistant` edge function, invoking via `supabase.functions.invoke()` with the service-role-bearing client, for exactly two tools (`lookup_ioc_indicator` and `update_risk_profile`). All other documented or implied callers are inactive, broken, or non-existent.

---

## §B — Intent Classification

Multiple-choice question per operator: A internal-only / B authenticated application endpoint / C public endpoint / D legacy compatibility endpoint.

| Option | Match to current reality | Evidence |
|---|---|---|
| **A — Internal-only** | **Partial match.** Caller pattern (service-role-bearing `supabase.functions.invoke()` from another edge function) is the canonical "internal-only" shape. But the `verify_jwt = false` config explicitly allows anonymous external callers, contradicting internal-only intent. | `dashboard-ai-assistant` is the only caller; `verify_jwt = false` opens external surface |
| B — Authenticated application endpoint | No match. There is no public-facing application-layer caller; the dashboard `supabaseClient` is service-role, not user-JWT. | No frontend caller; no user-JWT path |
| C — Public endpoint | **Inadvertent match via config.** `verify_jwt = false` makes the function publicly callable in the same way any other Supabase Function with that flag is. No documented public contract or callers. | `config.toml:172-173` + zero documented external callers |
| **D — Legacy compatibility endpoint** | **Strong match.** Most of the 23 cases are no longer routed-to from `dashboard-ai-assistant` (which has parallel implementations of the same operations in its own local switch + `_shared/handlers-signals-incidents.ts`). Per `aegis-tool-definitions.ts:958-959` comment: *"draft_response_tasks — REMOVED: calls ai-tools-query edge function unavailable; had fake incident fallback"* — explicit acknowledgement that this surface was being phased out. Two tools (IOC lookup + risk profile update) remain functionally live. | Code parallel implementations; comments in `aegis-tool-definitions.ts`; only 2 of 23 cases reachable via dashboard |

**Net classification:** **Option A (internal-only) + Option D (legacy)** with a config artifact pretending to be Option C (public). The function was **designed for internal use**, has **partially decayed to legacy**, and is **configured as public** without an evident reason to be.

---

## §C — Endpoint Exposure Matrix

23 cases in `ai-tools-query/index.ts`. Per-operation classification:

| Line | Case | Type | Currently routed via dashboard? | Tenant-scoped? | Anon-reachable today (`verify_jwt = false`)? |
|---:|---|---|---|---|---|
| 24 | `get_recent_signals` | Read | No (dashboard uses own handler) | **NO** — service-role unscoped | YES |
| 34 | `get_active_incidents` | Read | No | **NO** | YES |
| 44 | `search_entities` | Search/Read | No | **NO** | YES |
| 54 | `get_entity_details` | Read | No | **NO** | YES |
| 67 | `get_monitoring_stats` | Read | No | **NO** (`automation_metrics` is platform-wide telemetry; low data sensitivity but unscoped) | YES |
| 76 | `trigger_manual_scan` | **Administrative** (invokes `manual-scan-trigger`) | No | n/a | YES |
| 83 | `get_client_risk_summary` | Read | No | **NO** — `.from("clients").select(... signals(count), incidents(count))` no tenant filter | YES |
| 99 | `search_investigations` | Search/Read | No | **NO** | YES |
| 110 | `search_knowledge_base` | Search/Read | No | Intentional global (public KB) | YES |
| 122 | `search_clients` | Search/Read | No | **NO** | YES |
| 133 | `search_signals` | Search/Read | No | **NO** | YES |
| 144 | `get_entity_summary_for_signal` | Read | No | **NO** | YES |
| 191 | `get_related_signals` | Read | No | **NO** | YES |
| 234 | `get_source_reputation` | Read | No | Cross-tenant by design (sources are platform-wide) | YES |
| 282 | `get_client_risk_profile` | Read | No | **NO** | YES |
| 307 | `get_client_critical_assets` | Read | No | **NO** | YES |
| 345 | `get_client_operational_context` | Read | No | **NO** | YES |
| 370 | `update_risk_profile` | **Write** | **YES** — dashboard:4550 | **YES** (post-PR #79) | YES |
| 444 | `recommend_playbook` | Read/Administrative | No | n/a | YES |
| 496 | `draft_response_tasks` | Administrative | No (explicitly removed from registry per comment in `aegis-tool-definitions.ts:958`) | Dead code | YES |
| 541 | `integrate_incident_management` | Administrative | No (same comment) | Dead code | YES |
| 617 | `query_fortress_data` | Read | No (dashboard has own implementation) | **YES** (fail-closed) | YES |
| 846 | `lookup_ioc_indicator` | Read | **YES** — dashboard:4399 | **YES** (post-PR #79) | YES |

**Summary:**

| Category | Count |
|---|---:|
| Read operations | 17 |
| Write operations | 1 (`update_risk_profile`) |
| Search operations | 5 (subset of Read) |
| Administrative operations | 3 (`trigger_manual_scan`, `recommend_playbook`, `draft_response_tasks` / `integrate_incident_management` dead) |
| Currently routed via the only live caller | **2** (`lookup_ioc_indicator`, `update_risk_profile`) |
| Tenant-scoped (post-PR #79) | 3 (the 2 above + `query_fortress_data`) |
| **Anon-reachable + unscoped + live code path** | **15** |
| Dead code (per registry comment) | 2 |

---

## §D — `verify_jwt` Assessment

### D.1 — Does any current production workflow REQUIRE `verify_jwt = false`?

**Evidence-based answer: NO.**

Both live callers invoke via `supabaseClient.functions.invoke()` from a service-role context (`dashboard-ai-assistant` itself runs with the service-role key). Supabase's `.functions.invoke()` propagates the calling client's auth header, so the service-role JWT travels with the request. A service-role JWT satisfies `verify_jwt = true` (it is a valid JWT).

No frontend caller exists. No script caller exists. No external service / webhook caller is documented. No cron job invokes it. The agent-chat caller is pre-existing broken (wrong key shape) regardless of `verify_jwt` setting.

**Conclusion:** `verify_jwt = false` is not load-bearing for any known production workflow.

### D.2 — Per-caller impact of flipping to `verify_jwt = true`

| Caller | Auth shape today | Impact under `verify_jwt = true` |
|---|---|---|
| `dashboard-ai-assistant:4399` (lookup_ioc_indicator) | Service-role JWT via supabaseClient | **Works unchanged.** Service-role JWT is a valid JWT; passes the check. |
| `dashboard-ai-assistant:4550` (update_risk_profile) | Same | **Works unchanged.** |
| `agent-chat:1920` (lookup_ioc_indicator, wrong-key broken) | Service-role JWT via supabase invoke | **Still broken at the application layer** (wrong key shape → falls through to "Unknown tool"). The `verify_jwt` flip does not unbreak it. |
| Hypothetical anon-key browser caller | Anon JWT (still a valid JWT) | **Would still pass `verify_jwt = true`** because the anon key is a valid project JWT. `verify_jwt = true` does NOT prevent anon-key holders from reaching the function. It only blocks no-JWT or invalid-JWT callers. |
| Hypothetical no-auth external caller | No Authorization header | **Breaks** (401). |
| Hypothetical invalid-JWT caller | Forged / wrong-issuer JWT | **Breaks** (401). |

**Critical clarification:** `verify_jwt = true` does NOT make `ai-tools-query` "private" to the dashboard. It just requires *some* valid project JWT. Every browser ships the anon publishable key. Anyone with that key can still authenticate to the function — and from there, all 15 unscoped-and-live cases remain reachable.

`verify_jwt = true` is a hardening step (eliminates the unauthenticated-HTTP attack surface) but **not** sufficient on its own to close the cross-tenant exposure on the 15 unscoped cases.

---

## §E — Is `ai-tools-query` the primary remaining trust boundary?

**Yes — for direct-HTTP cross-tenant exposure.**

Evidence:

1. After PRs #77 (R2 + R6), #78 (R3 + R4), and #79 (R1 + R5) merge and deploy, the **dashboard-routed Aegis chat path** for the six named surfaces is closed.
2. **`ai-tools-query` direct-HTTP path** still exposes 15 unscoped read/admin cases via any holder of the anon publishable key (i.e., any browser).
3. The 6-surface PRs hardened *receivers* against unsafe caller arguments. They did NOT close the parallel set of unscoped cases in `ai-tools-query` that are not even routed via the dashboard today.
4. CRT user via Aegis chat: closed.
5. Anon-key holder via direct `POST /functions/v1/ai-tools-query` with `{ toolName: "search_entities", parameters: { query: "..." } }`: **still gets cross-tenant rows** for every unscoped case.

Adjacent remaining trust boundaries (lower-severity than this one):

- **C2 (handler signature class)** — `search_investigations`, `search_clients`, `get_client_details`, `get_monitoring_status`, `get_failed_scans` in `_shared/handlers-signals-incidents.ts`. Reachable via dashboard chat with valid tenant context (the gate fires but handlers ignore it). Smaller surface than ai-tools-query because at least the dashboard tenant derivation runs.
- **INC-LEARN-CONTAM-LEAK (P0.3)** — prompt-level injection of frozen-store content into report generators. Containment-mediated.
- **INC-CRT-DOCUMENT-SCOPE (P0.5)** — `archival_documents` has no `tenant_id` column.
- **Class B Provenance gap** on 18 LLM-derived stores.

None of these are direct-HTTP-anon-reachable in the way `ai-tools-query` is. `ai-tools-query` is uniquely shaped as the largest anon-reachable cross-tenant read surface remaining.

---

## §F — Recommendation Matrix

Three options per operator. Evaluated against current empirical reality.

### Option 1 — Leave `verify_jwt = false`

| Dimension | Assessment |
|---|---|
| Benefits | • Zero implementation cost.<br>• Zero risk to any known caller.<br>• Preserves the current "anyone with the anon key can hit it" behavior — which is theoretical exposure today since no frontend uses it. |
| Risks | • 15 unscoped cases remain direct-HTTP-reachable to anyone holding the anon publishable key (i.e., the entire internet via any browser that loaded the Fortress site).<br>• Anon-key reachability survives even after the 6-surface fixes deploy.<br>• Provides a parallel exfil channel that bypasses the dashboard tenant derivation.<br>• Public-by-config without a public-by-intent contract — invites incident-class reuse (e.g., a future tool added without scope review would inherit the public surface). |
| Affected workflows | None changed. Both production callers continue working unchanged. |
| Customer-trust implications | Unchanged for the demo path (no one uses the anon-direct-HTTP path in normal operation). A targeted probe by a customer / security researcher / red-teamer would still find the surface. |
| Doctrine alignment | **Misaligned with Aegis Authority & Memory Doctrine.** Doctrine: "service-role untrusted by default — enforce at the DB layer + shared seams." This function runs with service-role + anon-reachable, which is the canonical doctrine antipattern. |

### Option 2 — `verify_jwt = true`

| Dimension | Assessment |
|---|---|
| Benefits | • Closes the no-auth attack vector (anonymous HTTP without any JWT now rejected by the Supabase platform layer).<br>• Aligns the function with the rest of the platform that already runs `verify_jwt = true` (5 of ~95 functions in `config.toml` use `verify_jwt = true`; most use `false` — see config grep above).<br>• Cheap to ship (one-line config + edge-function deploy).<br>• No behavior change for either live dashboard caller (service-role JWT is valid). |
| Risks | • **Does NOT close the anon-key exfil path.** The anon publishable key is still a valid JWT; browsers can still authenticate and hit the 15 unscoped cases.<br>• Could break any **undiscovered** caller. No such caller has been identified in this audit (zero frontend / script / cron / external hits), but the audit is grep-bounded; absence of evidence is not proof of absence.<br>• Provides a false sense of security — operator/team may assume "verify_jwt = true → safe" when the underlying cases are still unscoped. |
| Affected workflows | • `dashboard-ai-assistant:4399` — **Works unchanged.**<br>• `dashboard-ai-assistant:4550` — **Works unchanged.**<br>• `agent-chat:1920` — Already broken; no behavioral change.<br>• Any caller with the anon key — Works unchanged.<br>• Any unauthenticated direct-HTTP caller — Now rejected with 401. |
| Customer-trust implications | Marginal improvement against unauthenticated probes; no improvement against credentialed (anon-key) probes. |
| Doctrine alignment | Partial alignment. Still doesn't satisfy "service-role untrusted" because the function continues to run service-role with cross-tenant SQL reach. The doctrine fix requires per-case scoping, not transport-layer auth. |

### Option 3 — Split public and private surfaces

| Dimension | Assessment |
|---|---|
| Concept | Identify the small surface that is genuinely needed (`update_risk_profile` write + `lookup_ioc_indicator` read — the only two dashboard-routed tools) and move them to a private endpoint (`verify_jwt = true` and/or inline into `dashboard-ai-assistant`). Retire / `verify_jwt = true` / per-case scope the remaining 21 cases. |
| Benefits | • **Closes the parallel exfil channel structurally.** The 15 unscoped read cases simply stop being reachable from outside the dashboard's tenant-derivation flow.<br>• Aligns with Doctrine D (legacy compatibility endpoint can be retired).<br>• Reduces the surface area maintainers have to think about.<br>• Matches the architectural intent — the dashboard already implements parallel versions of most of these tools in `_shared/handlers-signals-incidents.ts` + its own local switch. |
| Risks | • Largest implementation cost of the three options.<br>• Requires per-case audit to determine: dead code (delete) vs. dashboard-already-has-parallel (delete from here) vs. genuinely-needed (move to dashboard or new private endpoint).<br>• Risk of breaking some unknown caller still applies (mitigated by case-by-case audit).<br>• Even after this, the 2 live cases need verify_jwt=true and the deeper Doctrine alignment work (no service-role-bypass) — Option 3 doesn't substitute for that. |
| Affected workflows | • Dashboard caller path updates required (two call sites: `:4399`, `:4550`).<br>• `agent-chat:1920` — operator-decision whether to fix the broken caller alongside.<br>• Per-case retirement of 21 unused cases. |
| Customer-trust implications | Strongest of the three options. Largest reduction in attack surface visible to a credentialed (anon-key) probe. |
| Doctrine alignment | Best of the three. Reduces "service-role untrusted" surface to the minimum needed; the residual surface is one write tool + one IOC tool, both of which were hardened in PR #79. |

### Matrix at a glance

| Criterion | Option 1 (leave) | Option 2 (verify_jwt=true) | Option 3 (split) |
|---|---|---|---|
| Implementation cost | None | Low (config flag + deploy) | Medium-High (case audit + refactor) |
| Anonymous-HTTP exfil surface closed | No | YES | YES |
| Anon-key (browser-credentialed) exfil surface closed | No | **NO** | YES (for retired cases) / pending per-case scope (for kept cases) |
| Behavior change for known callers | None | None | Two dashboard caller paths need redirection |
| Doctrine alignment | Misaligned | Partial | Strongest |
| Customer-trust improvement during BC Place / FIFA delivery | None | Marginal | Substantial |
| Risk of unknown-caller breakage | None | Low (anon-key still works) | Medium (case-by-case decisions) |

---

## §G — Implicit Option 4 (not in operator scope; noted for completeness)

**Retire `ai-tools-query` entirely.** Move `lookup_ioc_indicator` + `update_risk_profile` into `dashboard-ai-assistant` (where they would inherit dashboard tenant derivation and TENANT_SCOPED_TOOLS gating). Delete the function. Same effect as Option 3 but goes further by eliminating the function entirely.

This is the structurally cleanest end-state but the largest scope of work. Flagged for operator awareness; not part of the three options the operator asked about.

---

## §H — What this assessment is NOT

- Not a recommendation to ship any of the three options.
- Not authorization for Option 4.
- Not a per-case scope audit of the 21 unused cases (would be separate work).
- Not a deploy. Nothing changes until operator GO + edge-function redeploy.
- Not a fix for the C2 cross-cutting concern (handler signature class in `_shared/handlers-signals-incidents.ts`).

---

## §I — Held

- No fix proposals.
- No code, branch, migration, deploy.
- No memory updates.
- No incident document amendments.
- No remediation roadmap.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
