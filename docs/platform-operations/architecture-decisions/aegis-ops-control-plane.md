# ADR — Aegis Ops: the Operator Control Plane

**Status:** DESIGN (no code). Hard decision. Extends `aegis-authority-modes.md`: Aegis Ops is not merely diagnostics — it is the **operator/admin control plane that manages platform objects on behalf of a target tenant/user.** Mutating by design.

- **Aegis** = tenant intelligence officer (customer-facing, own tenant, broad-but-bounded).
- **Aegis Ops** = operator control plane (internal, cross-tenant **by explicit target**, full management authority).

## The non-negotiable: actor ≠ owner
Rule 1 ("operator never becomes user") + the Provenance Doctrine resolve into **two distinct fields on every Aegis Ops write**:

| Field | Value | Governed by |
|---|---|---|
| **ownership** (`tenant_id` / `client_id` / owned-parent) | the **target_tenant / target_client** | Provenance Doctrine (object is tenant-owned, never NULL) |
| **actor** (audit) | the **operator** (e.g. Aaron) + `surface = aegis_ops` | the audit trail |

So a repaired entity is *owned by CRT* but *was acted on by Aaron-as-operator*. The object never records the tenant user as actor (no impersonation, Rule 1); ownership is never the operator (no operator-owned tenant artifacts). This is the correct reading of "actor = Aaron / target_tenant = CRT" — and it is strictly better provenance than impersonation, which would lie in *both* fields.

## Operator action contract (the 7 rules → enforced mechanisms)
Every Aegis Ops **mutating** tool passes through one shared seam — `operatorAction(toolName, { target_tenant, target_client?, args, reason_code?, confirm? })` — that enforces:

1. **Actor is the operator, always (Rule 1).** Resolved from the operator's authenticated identity; the tenant user is never the actor. No claims-override / impersonation path exists (deleted per the authority-modes ADR).
2. **Explicit target required (Rule 2).** `target_tenant` mandatory on every mutation; `target_client` mandatory where the object is client-scoped. Missing target → hard refusal. **No global/un-targeted mutation** — a tool cannot "apply to all tenants" implicitly.
3. **Audit row required (Rule 3).** Before returning, write to `operator_actions_log`: `{ actor, surface:'aegis_ops', target_tenant, target_client?, action, object_ids[]/count, timestamp, reason_code?, outcome }`. The action is not "done" until the audit row is committed.
4. **Receipt required (Rule 4).** Re-read and return the **measured** post-condition with success/failure split: *"61 CRT entities updated successfully. 2 failed validation: [ids]."* Never "Done." (= AR3, with per-item accounting for bulk ops.)
5. **Registry-gated (Rule 5).** Only tools in the Aegis Ops registry with `implemented:true` are callable; anything else → honest refusal (= AR1/AR4). No implied capabilities.
6. **Physical authority partition (Rule 6).** The Aegis Ops registry + entry point are **separate code** from the Aegis tenant registry — not one registry behind a mode flag. Tenant tools are absent from the operator surface and vice-versa. A shared *core* (the seam, the DB) is fine; the **tool surfaces do not overlap**.
7. **Safe defaults (Rule 7).** Destructive or wide-blast actions (delete, purge, bulk-unmonitor, quarantine-many, merge, storage-ownership rewrite) require **explicit two-step confirmation**: the first call returns a *preview receipt* (target + exact object set + count + reason) and a `confirm_token`; the mutation executes only on a second call echoing that token. Read/diagnostic actions need no confirmation.

## Capability catalog (mapped to implementation status)
Status: **✅ exists** (tool/edge-fn present, may need Ops-surface wiring) · **◑ partial** (logic exists, not a coherent operator tool) · **✦ net-new**. All mutations carry the §contract.

### ENTITY OPERATIONS
| Capability | Status | Maps to |
|---|---|---|
| create / update / delete entities | ◑ | `create-entity`, `entity-manager` edge fns (CRUD partial; delete-with-provenance net-new) |
| bulk monitor / unmonitor | ✦→✅ | wrap `configure-entity-monitoring` (exists, unexposed) — the Vince #2 gap (AR5) |
| merge duplicates | ◑ | `cross-reference-entities` / DuplicateDetectionPanel logic → operator merge tool |
| repair ownership / provenance | ◑ | INC-XTEN backfill pattern → operator tool (sets target ownership, no NULL) |
| reclassify / tag | ◑ | entity update path |
| entity health diagnostics | ✦ | new read (orphans, missing provenance, stale monitoring) |

### SOURCE OPERATIONS
| Capability | Status | Maps to |
|---|---|---|
| create / update / delete sources | ◑ | Sources CRUD (frontend) → operator tool |
| enable / disable monitors | ◑ | cron + source config |
| adjust polling / config | ◑ | source config |
| repair broken sources | ✅ | `autonomous_source_health_manager` |
| test source health | ◑ | source health probe |
| replay failed ingestion | ✦ | `monitoring_history` replay |

### SIGNAL / INCIDENT OPS
| Capability | Status | Maps to |
|---|---|---|
| inspect stuck signals | ✅ | scoped read |
| reprocess failures | ✦ | re-run ingest/decision pipeline for a signal set |
| quarantine junk | ✅ | Quarantine Doctrine (`quality_status='quarantined'`) — operator-side write |
| repair routing / provenance | ◑ | INC-XTEN provenance repair |
| reopen / correct incidents | ✅ | `manage_incident_ticket` |

### DOCUMENT / REPORT OPS
| Capability | Status | Maps to |
|---|---|---|
| diagnose failed uploads | ◑ | `process-stored-document` diagnostics |
| reprocess documents | ✅ | `process_document` / `process-stored-document` |
| repair storage ownership | ◑ | INC-ART-CLUSTER storage-provenance repair |
| repair broken artifact links | ◑ | durable-delivery / no-raw-signed-URL pattern (INC-ART-001) |
| rebuild reports | ✅ | `generate_fortress_report` (regenerate + persist) |

### PLATFORM OPS
| Capability | Status | Maps to |
|---|---|---|
| health diagnostics | ✅ | `get_system_health`, system-watchdog |
| monitor audits | ✅ | `validate-cron-alignment`, `monitoring_history` |
| tenant health checks | ✦ | per-tenant coverage/freshness/provenance rollup |
| tool audits | ✦ | capability-registry vs dispatcher reconciliation (AR1) |
| telemetry | ✅ | observability layer |
| remediation | ◑ | orchestrates the repair tools above |

## Relationship to existing doctrine & sequencing
- **Provenance Doctrine:** Aegis Ops is a privileged service-role writer — it MUST route through `createArtifact`/`assertProvenance` with the explicit `target_tenant`/`target_client` (no NULL fallback). The "repair ownership/provenance" capabilities are literally the INC-XTEN remediation, now operated from one accountable surface.
- **INC-LEARN-CONTAM:** the global-learning re-derivation + quarantine + anonymization-gate operation lives here (operator-run), behind that incident's remediation.
- **Audit infra:** `operator_actions_log` is net-new (or an operator-fielded extension of `autonomous_actions_log`) — it is the spine of Rule 3 and must exist before any mutating Ops tool ships.
- **Sequencing:** R1 retrieval seam + R2 leak fixes first (trustworthy cross-tenant reads) → AR1 registry + AR3 receipts (rules 4/5) → the `operatorAction` seam + `operator_actions_log` (rules 1/2/3/7) → physical partition of the Ops registry/entry point (rule 6) → then wire capabilities, **read/diagnostic first, mutating second, destructive last** (each behind confirmation).
- **Net:** Aegis Ops becomes the accountable operator assistant — powerful platform management, every action attributed to a human, targeted, audited, receipted, and confirmed where destructive. Aegis stays the tenant intelligence officer.

**No mutations. Hard architecture decision recorded. Implementation separate, gated, sequenced after ratification.**
