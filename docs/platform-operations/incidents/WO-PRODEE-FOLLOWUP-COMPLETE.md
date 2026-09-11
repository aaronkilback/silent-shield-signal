# WO-PRODEE-FOLLOWUP-COMPLETE — finish the PROD-EE remediation (opened 2026-09-03)

**This is the completion of an existing incident's remediation, NOT new work.**

## The incident being completed

**PROD-EE (2026-05-24).** Real-user prod reproduction: with `selectedClient=Petronas` (tenant `feff5c44`), `get_recent_signals` returned **BC Place** (CRT tenant `0aaaaaaa`) + `_dryrun_crt_smoketenant` + `_benchmark_petronas`. Root cause: `dashboard-ai-assistant` runs under SERVICE_ROLE (RLS bypassed), and its tool gating is an **allowlist** (`TENANT_SCOPED_TOOLS`) — only tools in the allowlist get the fail-closed gate + handler-level tenant filtering; **every tool not in it runs unscoped and returns cross-tenant data.**

The fix at the time added **7 read tools** to `TENANT_SCOPED_TOOLS` (`get_recent_signals`, `get_active_incidents`, `search_signals_by_entity`, `get_signal_incident_status`, + entity intelligence). The code comment (dashboard-ai-assistant `:485-486`) said: *"Sibling read tools added defense-in-depth — handler hardening for those tracked as follow-up."*

**The follow-up never happened.** Four months later (2026-09-03), `get_signal_contradictions` was found to be the **same defect, same two clients (BC Place/CRT ↔ Petronas/Silent Shield Ops), same tenant boundary** — discovered by accident while chasing WO-CORRELATE-SIGNALS-TENANT-SCOPE. It was contained (added to `CONTAINMENT_DISABLED_TOOLS`), but the containment of one instance is not the completion of the remediation.

## Scope of this WO

**Classify ALL ~149 tools in the `dashboard-ai-assistant` dispatcher.** For each tool, record:
1. Does it read a **tenant-scoped table** (per-client/per-tenant data: signals, incidents, entities, entity_mentions, signal_contradictions, investigations, reports, alerts, aegis_recommendations, subject_exposure_items, archival_documents, …)?
2. Is it in `TENANT_SCOPED_TOOLS` (gets the fail-closed gate)?
3. Does the **handler apply a tenant/client predicate itself** (`.eq('client_id'/'tenant_id')` or a filter derived from the passed `tenantId`)?
4. Is it **legitimately global/operator** (system metadata, published KB, external reference, cross-tenant operator tooling — the documented exclusions at `:513-535`)?

**Cover the ~128 inline `case` handlers**, not just the ~21 extracted `_shared/handlers-*` ones. The prior audit could only classify the extracted set; the inline switch is exactly where the next instance will hide. Do not stop at the extracted handlers.

## Output (the actual deliverable)

- The **full classification table** (all ~149 tools, four columns above).
- **The list of every tool that reads tenant-scoped data UNSCOPED** (service-role, not in `TENANT_SCOPED_TOOLS`, no own tenant predicate, not legitimately global). **That list is the remediation scope** — each such tool is either promoted to `TENANT_SCOPED_TOOLS` + handler-hardened, or gated operator-only, or (if legitimately global) explicitly documented as an intentional exclusion.

## Known partial data (from the 2026-09-03 audit, to be made precise)

- ~149 tools total (~21 extracted + ~128 inline).
- ~14 unscoped extracted handlers touch tenant/global tables; several are legitimately operator/global (documented), but some read per-client intel unscoped (e.g. `search_investigations`, `get_monitored_signals`).
- `get_signal_contradictions` already contained (this WO's trigger).

## Priority

**Above step-3 cleanup, below finishing the WO-ENTITY-MENTION-CONTAMINATION / WO-CORRELATE-SIGNALS-TENANT-SCOPE deploys (now complete).** It is the only remaining item with a **realized-exposure precedent** (PROD-EE actually leaked BC Place data into a Petronas session). Sequence: correlate-signals rebuild (WO-CORRELATE-SIGNALS-TENANT-SCOPE step b) → **this WO** → step-3 cleanup.

## Companion
PROD-EE (2026-05-24). Sibling of WO-CORRELATE-SIGNALS-TENANT-SCOPE (same boundary, same clients, different mechanism). Tenant-isolation-audit-checklist (service-role reads need explicit tenant predicates — RLS does not save a SERVICE_ROLE caller). Population-Before-Check (the allowlist is the aperture; everything outside it is unchecked).

## Classification pass — STARTED 2026-09-10, NOT COMPLETE (honest partial)

Structural extraction from `dashboard-ai-assistant/index.ts`:
- **`TENANT_SCOPED_TOOLS` = 92** (get the fail-closed gate + handler tenant filtering).
- **`CONTAINMENT_DISABLED_TOOLS` = 4** (`get_cross_tenant_patterns`, `get_global_learning_insights`, `get_signal_contradictions`, `query_expert_knowledge`).
- `handlers-signals-incidents.ts`: 14 tenant-table reads / 82 predicate refs — heavily scoped.

**The clean unscoped-tool list is NOT yet produced — do NOT read this as "0 unscoped."** Two method walls, each of which would manufacture a false all-clear if ignored:
1. **Case-label pollution:** a naive `case 'X':` sweep (145 labels) conflates the tool dispatcher with unrelated sub-switches (`dns_error`, `timeout`, `executive_summary`, `exposure_tier`, report-section/error enums) — the "not-gated remainder" is not a tool list.
2. **Delegated handlers:** ~21 tools dispatch into `_shared/` (`aegis-tool-executor.ts`, `agent-tools-core.ts`, `agent-tools.ts`, `voice-tool-*.ts`, `handlers-signals-incidents.ts`); an inline-dispatcher scan cannot see their tenant-table access.

**To finish properly (remaining):** (a) isolate the ONE real tool-dispatch switch + enumerate real tool names from the executor/registry; (b) subtract 92 gated + 4 disabled → ungated real-tool set; (c) trace each into its handler across the `_shared` tool files; (d) flag every handler reading a tenant-scoped table without a `client_id`/`tenant_id` predicate → the WO-PRODEE remediation scope. Not completed this session (ran A→B first per operator order; C is the remaining item).
