# INC-AEGIS-ACTION-INTEGRITY — Aegis Operational Truthfulness Audit (2026-05-26)

**Sibling to INC-AEGIS-TRUST (perception/isolation). This stream audits ACTION reliability: does Aegis only claim capabilities it actually possesses, scope them to the tenant, and verify the post-condition?**

**Verdict:** Aegis's action layer is **truthful where its honesty rules are grounded in a tool receipt, and over-claiming where they are grounded in static prose.** The Vince "toggle all entities to monitored" failure is not a one-off — it is the predictable output of a **capability model built as a hand-maintained denylist of limitations rather than as a projection of the live tool registry.** Evidence-only; no fixes.

## Root cause (architectural, not per-tool)
The persona prompt (`_shared/aegis-persona.ts`) contains two opposing disciplines:
1. **Over-claim pressure** — `:194` "NEVER claim you lack a capability listed here. NEVER invent limitations not listed here"; `:222` "ACTUAL LIMITATIONS (ONLY THESE — DO NOT INVENT OTHERS)"; `:240` "NEVER SAY ANY OF THESE (THEY ARE FALSE)". Limitations are a **closed denylist**. Any capability not enumerated as a limitation is implicitly claimable.
2. **Receipt-grounded honesty** — `:298` "NEVER CLAIM TO HAVE PERFORMED AN ACTION THE PLATFORM DID NOT EXECUTE"; `:344` config changes "MUST call the tool, wait for success/failure, report ACTUAL result"; `:354` feedback "ONLY if `{success:true, verified:true}`". This is **exemplary** — the correct model.

**The defects:**
- **D1 — Denylist drift.** Reality (tools) advances ahead of the prose limitations list. Bulk monitoring toggle is neither a listed capability nor a listed limitation → "don't invent limitations" forces Aegis to assume it can. → **Vince #2.**
- **D2 — Phantom verification contract.** `:353` authorizes reporting "Enabling entity monitoring (if you updated the entity record)" and `:344`/`:368` instruct "call `update_client_monitoring_config`, claim success only on its receipt" — **but `update_client_monitoring_config` and `update_entity` do not exist** (present only in the `TENANT_SCOPED_TOOLS` gate array, `dashboard-ai-assistant:267/271`; no tool definition in `aegis-tool-definitions.ts`, no dispatcher `case`, no `_extractedHandlers` entry). The guardrail references a tool that can never return a receipt → unenforceable.
- **D3 — Manifest claims stubbed capabilities.** Capability manifest item #10 lists `run_what_if_scenario`; `simulate_attack_path`/`simulate_protest_escalation`/`perform_impact_analysis`/`integrate_incident_management`/`optimize_rule_thresholds` are advertised — yet the dispatcher comment (`:382`) marks them "stubs returning 'not available'." The manifest advertises capabilities the code stubs out.
- **D4 — No mandatory post-condition.** No action tool is required to re-read and return the measured post-state. Tools return `{success:true}`/`{error}`, not "61 CRT entities updated, `active_monitoring_enabled=true`."

**Where the code is RIGHT (the model to generalize):** `investigate_poi` (`:9899`) returns *"is not available — the OSINT investigation engine is not deployed. Use run_entity_deep_scan… or perform_external_web_search."* — explicit refusal + nearest real capability. The honest stubs and the `default:` throw (`:9934` "Unknown tool") also fail honestly. The failure is that the **persona prompt overrides these honest signals** by pressuring the model to claim capability before it ever reaches a tool call.

## Capability Integrity Matrix
Legend — Truthfulness class: **A** fully implemented · **B** partially implemented · **C** not implemented but exposed/expected · **D** exposed but dangerous · **E** silently failing · **F** claims success without verification. Trustworthy = safe to rely on as-is.

| Capability (user command) | Exposed | Implemented | Tenant-safe | Verifies completion | Trustworthy | Class | Evidence |
|---|---|---|---|---|---|---|---|
| **Bulk entity monitoring** ("toggle all entities to monitored") | Phantom (`update_entity`/`update_client_monitoring_config` in gate array only) | **NO** — no def, no case, no handler; `configure-entity-monitoring`/`aegis-monitor`/`entity-manager` edge fns exist but **unexposed** | n/a | n/a | ❌ | **C → F** | persona `:353/:368` *authorizes* claiming it → improvises success. **Vince #2** |
| **Single entity monitoring toggle** | Phantom (same) | **NO** | n/a | n/a | ❌ | **C → F** | same root |
| **Entity counts** | `agent_self_assessment`, `query_fortress_data(entities)` | YES | **NO** — unscoped `:9278`; `client_id` undercount `:6024` | returns a number — the **wrong** number | ❌ | **F** | confident wrong total. **Vince #1** |
| **Create entity** | `create_entity` `:607` | YES `:2271` — writes a **suggestion**, not a live entity | mostly (tenant_id set `:2312`); **dup-check `ilike` unscoped `:2277`** | returns suggestion id | ⚠ | **B** | partial + foreign-entity existence leak |
| **Create source** | **NO def** | **NO** | n/a | n/a | ❌ | **C** | no tool; no honest refusal wired → silent gap. **Vince operates sources via UI** |
| **Generate report** | `generate_fortress_report` `:1446` | YES `:7956` | client-scoped `:7966` | returns link — **7-day signed URL, not persisted to `reports` `:8302`** | ⚠ | **F** | claims durable artifact; link expires → InvalidJWT. **Vince #4** |
| **Process document** | `process_document` `:565` | YES `:1754` | TENANT_SCOPED gate | async "submitted" (honest language exists `:331`) | ⚠ | **B / E** | submit honest, but later retrieval fails silently (null-client docs invisible, INC-DOC-002). **Vince #3** |
| **Update risk profile** | `update_risk_profile` `:909` | YES `:4507` → `ai-tools-query:370` | **NO — cross-tenant WRITE**, no tenant check | returns success, no re-read | ❌ | **D + F** | mutates any tenant's entity threat_score |
| **Launch investigation** | `investigate_poi` | returns "not available + use X" `:9899` | n/a | honest refusal | ✅ | **C (honest)** | **GOLD STANDARD pattern** |
| **What-if / simulate / impact** | manifest #10/#11 advertise them | stubs "not available" `:382` | n/a | honest stub | ⚠ | **C (honest code, over-claiming manifest)** | manifest/code mismatch (D3) |
| **Incident ticket** | `manage_incident_ticket` | YES `:6405` | not yet verified this audit | — | ⏳ | (A/B, pending verify) | — |
| **Inject test signal / submit feedback** | YES | YES | YES (`:4674/:2800`) | feedback verifies `{success,verified}` `:354` | ✅ | **A** | exemplary receipt discipline |

## The 5 named Vince cases — action-integrity root cause
1. **Bulk entity monitoring** — no tool exists (phantom gate entries D1/D2); persona authorizes the claim → fabricated success. Fix = build a real tenant-scoped bulk-toggle tool + remove the phantom references + ground the capability list in the registry.
2. **Entity counts** — perception bug (unscoped/`client_id`), surfaced as a *confident* number → action-truth failure. Fix = count by `tenant_id` (ties to INC-AEGIS-TRUST P1).
3. **Entity management requests** — `create_entity` makes a suggestion not a live entity, dup-check leaks foreign entities; no update/delete/toggle path at all. Fix = full tenant-scoped entity CRUD with post-condition return.
4. **Report generation** — runs, but artifact is ephemeral (7-day URL, unpersisted) and reported as durable. Fix = persist + authenticated proxy (no-raw-signed-URL ADR / INC-ART-CLUSTER).
5. **Document processing** — submit is honest; retrieval silently returns `[]` for null-client docs. Fix = `archival_documents.tenant_id` + scope-aware "hidden vs absent" (INC-XTEN Phase 3/2C).

## Write-trust posture (do not over-state)
Some action surfaces *look* tenant-correct (inject_test_signal, submit_ai_feedback, dashboard create_entity). **They are not described as "mostly safe."** The correct posture: **write integrity is improving but not yet trusted until the Provenance Doctrine (INC-XTEN) fully closes.** Every write surface stays in-scope until that gate, including the ones that currently appear correct.

## Remediation plan (design; gated, executed in the CANONICAL cross-stream order below)
- **AR1 — Capability list = projection of the live tool registry, not prose.** Generate "what you can do" from the dispatchable set (definitions ∩ (handlers ∪ cases ∪ honest-stubs)); generate the limitations as the complement. Phantom/stub tools are excluded from "can do." Kills D1/D3 structurally. A CI check fails the build if a manifest capability has no backing dispatch (mirrors `validate-cron-alignment`).
- **AR2 — No phantoms.** Reconcile `update_entity`/`update_client_monitoring_config`: either implement as real tenant-scoped tools or delete from `TENANT_SCOPED_TOOLS` and every persona reference. Kills D2.
- **AR3 — Mandatory post-condition contract.** Every mutating tool re-reads and returns the measured post-state + affected count. Persona requires Aegis to report it verbatim: *"61 CRT entities updated, active_monitoring_enabled=true"* — never "Done." Kills D4.
- **AR4 — Universal honest-refusal.** Generalize the `investigate_poi`/`:9899` pattern: any request with no backing tool → "I cannot do that" + nearest real capability. This **outranks** the capability-assertion pressure in the persona ordering.
- **AR5 — Build the genuinely-missing operator capabilities** (tenant-scoped, with AR3 receipts): bulk + single monitoring toggle (wrap `configure-entity-monitoring`), `create_source`, live entity create/update/delete. **LAST — gated behind AR1–AR4 + the read-side fixes.**
- **AR6 — Dangerous-action gate.** `update_risk_profile` (cross-tenant write) tenant-scoped or removed (folds into INC-AEGIS-TRUST P0 + INC-XTEN write doctrine).

## CANONICAL cross-stream execution order (perception/truth before power)
**A truthful, limited operator is safer than a powerful, dishonest one.** AR5 (new capabilities) is intentionally last.
1. **R1** retrieval seam → 2. **R2** class-D leak fixes → 3. **L2 provenance classification** → 4. **AR1** registry-derived capability truth → 5. **AR3** post-condition receipts → 6. **AR4** universal honest refusal → 7. **AR5** missing-capability implementation.
(Shared with the 3-layer ADR. AR2/AR6/R3–R7 slot in as their prerequisites complete; none precede R1/R2.)

## Relationship to the other streams
- **INC-AEGIS-TRUST** = perception/disclosure (reads). **This** = action/truthfulness (writes + claims). Both feed the **3-layer memory ADR** (`architecture-decisions/aegis-three-layer-memory.md`): L1 tenant retrieval must be correct for entity counts (Vince #1/#3) and for AR3 post-condition reads to be tenant-true.
- AR2/AR6 fold into INC-XTEN sibling sweep (#19) + task #24.
- The receipt-grounded honesty rules already in the persona (`:344/:354`) are the template AR3/AR4 generalize — this is hardening an existing-but-inconsistent discipline, not inventing one.

**No mutations. Evidence-based. Each AR is separate, gated work.**
