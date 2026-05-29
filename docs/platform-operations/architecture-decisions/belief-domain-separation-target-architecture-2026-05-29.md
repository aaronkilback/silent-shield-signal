# Target architecture — belief-domain separation: Global Tradecraft vs Tenant Intelligence

**Date:** 2026-05-29. **Status:** target-architecture proposal. **Not a migration plan.** No code changes proposed; this paper precedes both Class B (schema) and any retrieval-surface fix.

---

## 1. Problem statement (recap)

`agent_beliefs` today is one table serving two structurally different purposes:

- **Global tradecraft** — AI-derived methodology, threat patterns, geographic risk knowledge, doctrine, frameworks, best practices. **15,418 rows on prod (99.3% of the table).** Intentionally not bound to any tenant. Writer: `knowledge-synthesizer` (mass-seeded 2026-03-23, ongoing). Sample content: *"Lessons learned from the Vietnam War emphasize comprehensive military strategy"*, *"Aluminum/copper spot prices correlate with infrastructure theft"*. Generic methodology, not tenant facts.
- **Tenant intelligence** — client-bound narratives derived from a specific tenant's signals/entities. **115 rows on prod (0.7%).** Type: `entity_narrative` exclusively. Writer: `synthesize-entity-narratives`. Sample: AEGIS-CMD narratives about Petronas Canada entities.

The current containment treats both as equivalent — leading to:

- **dashboard-ai-assistant**: complete NULL suppression → operator-Aegis loses access to 99.3% of learned tradecraft (the *capability deficit* side of the dual-purpose use).
- **agent-chat + 5 other paths**: full access including NULL → all 15,418 tradecraft beliefs flow into agent self-introspection, training, login summaries, with no per-row anonymization guarantee (the *contamination risk* side).

The target architecture below resolves the false choice. Aegis retains methodology expertise; tenant isolation strengthens, not weakens.

---

## 2. Class A — Global Tradecraft

**Definition:** AI-derived or curated content that describes *how to think about security problems*, not *what is happening in a specific client*. Content is intentionally non-tenant, intentionally globally-shared, intentionally available to every operator surface across every tenant.

### 2.1 Allowed content classes (operator-locked)

| Class | Examples |
|---|---|
| **methodology** | structured professional judgment frameworks; investigative interview techniques; behavioral threat assessment pathway |
| **doctrine** | protective intelligence collection doctrine; insider-threat detection doctrine; OSINT tradecraft principles |
| **investigative techniques** | dark web monitoring techniques; person-of-interest research workflows; entity-disambiguation heuristics |
| **security principles** | defense-in-depth; least-privilege; layered authentication; data-minimization |
| **threat assessment frameworks** | workplace-violence pathway model; activist-coordination patterns; ROVE-style ladder analysis |

**Out of scope for this class** (explicitly forbidden):
- Anything naming a specific tenant, client, entity, principal, or investigation.
- Anything derived from analysis of a single tenant's signals/incidents/entities.
- Anything that would change meaning if applied to a different tenant.

### 2.2 Five-axis model

| Axis | Model |
|---|---|
| **Ownership** | `asset_class = 'global_shared'` per the Provenance Doctrine vocabulary. `client_id` and `tenant_id` columns are **absent** (not nullable — absent) from the storage schema for this class. No transitive ownership FK. Authorship is recorded via `created_by` (the agent_call_sign or operator id that authored the row), not as ownership. |
| **Read** | Readable by any authenticated user from any tenant. Service-role reads allowed. RLS policy is universal-permit-select (after content-anonymization gate, see Write). **Injection into operator-facing prompts is permitted** but always under the "tradecraft reference" label (see §2.2 prompt-injection axis). |
| **Write** | **Trusted-writer allowlist + content-anonymization gate.** Allowlist (locked): `knowledge-synthesizer` (in its global-doc-derived mode), `ingest-expert-media` (curated upload pipeline), manual curation via an operator-only RPC. **Every write passes through `anonymize_global_belief()` SECURITY DEFINER** that rejects content matching any tenant dictionary entry (client names, entity names, principal names, investigation identifiers). Failed anonymization writes go to a quarantine table for operator review, not the live store. |
| **Retention** | Long-lived. Evolution-log tracked (current pattern preserved). Confidence decay over time. Manual curation can prune obsolete tradecraft. No tenant-deletion cascade applies (this class is tenant-blind by construction). |
| **Prompt injection** | Allowed in operator-facing surfaces — **but always under a single labeling regime**: `[TRADECRAFT REFERENCE — methodology, not observation]` prefix. The receiving LLM is given a hard prompt rule (mirroring the Workstream D anti-certainty-theater discipline): *"Tradecraft reference items describe how to approach security problems. They are NOT evidence of what is happening in this tenant. Never cite them as observations."* Injection budget: max N rows per prompt (operator-tunable; default ~5). Tradecraft reference items are always **drillable** — every injected row carries a `tradecraft_ref_id` the operator can drill into for source. |

### 2.3 Schema sketch (illustrative, not authoritative)

```sql
create table agent_tradecraft (
  id                    uuid primary key,
  authored_by_agent     text not null,                 -- agent_call_sign or 'operator:<uid>'
  asset_class           text not null default 'global_shared'
                        check (asset_class = 'global_shared'),
  domain                text not null,                 -- one of: methodology, doctrine, investigative_techniques,
                                                       --   security_principles, threat_assessment_frameworks
  title                 text not null,
  content               text not null,
  confidence            numeric(4,3) not null,
  evolution_log         jsonb,
  anonymization_status  text not null check (
                          anonymization_status in ('pending','passed','quarantined')
                        ),
  anonymization_checked_at timestamptz,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  last_updated_at       timestamptz not null default now()
);
-- No client_id, no tenant_id. Authorship ≠ ownership.
-- RLS: SELECT permitted to everyone where anonymization_status='passed' AND is_active.
-- INSERT permitted only via SECURITY DEFINER RPC enforcing the trusted-writer allowlist.
```

---

## 3. Class B — Tenant Intelligence

**Definition:** AI-derived or operator-derived content that describes *what is happening in a specific tenant* — assessments about a specific client's entities, signals, investigations, incidents, or operating environment. Content is intentionally tenant-bound. Cross-tenant retrieval is forbidden by design.

### 3.1 Allowed content classes (operator-locked)

| Class | Examples |
|---|---|
| **client-specific** | client's stakeholder map; client-asset-specific risk assessments; client's threat-actor exposure profile |
| **entity-specific** | per-entity narratives (the existing `entity_narrative` body); per-entity threat assessments; per-entity risk-level history |
| **investigation-specific** | per-investigation hypotheses; per-investigation working-conclusion drafts; per-investigation OSINT-finding interpretations |
| **environment-specific** | per-locale operational-context observations (e.g., "currently elevated protest activity in Vancouver"); per-region active-threat baselines |

**Out of scope for this class** (explicitly forbidden):
- Any methodology that describes a general approach rather than a specific tenant fact.
- Any analytical conclusion that would apply identically to another tenant.

### 3.2 Five-axis model

| Axis | Model |
|---|---|
| **Ownership** | `tenant_id` **NOT NULL**, enforced by `trg_tenant_belief_require_tenant` (INC-OMCR pattern). `client_id` populated where applicable (e.g., for entity-specific or client-specific subclasses); nullable when the content is tenant-scoped but spans multiple clients. Owner FK (entity_id / investigation_id / incident_id / case_id) populated where applicable. Provenance Doctrine fully applied — non-bypassable DB trigger backstop. |
| **Read** | Tenant-scoped exclusively via the certified retrieval seam `tenantRetrieve()`. Service-role bypass blocked by `ALTER TABLE … FORCE ROW LEVEL SECURITY` (Class C from PR #48). Cross-tenant operator access only via the audited Aegis Ops control-plane retrieval seam (per the Aegis Authority Doctrine). Authenticated tenant users see only their own tenant's rows; even super_admin reads against this table are flagged as cross-tenant when not currently scoped to the row's tenant. |
| **Write** | Any function may write but **must attest to `tenant_id`**. INSERT WITH CHECK enforces `tenant_id IS NOT NULL`. Optional second trigger derives `tenant_id` from `entity_id`/`investigation_id` when caller omits it (analogous to the proposed Layer 2 for signal_agent_analyses). Writer code receives a hard refusal if owner cannot be resolved (fail-closed, not silent-NULL fallback). |
| **Retention** | Tenant-bounded. Operator-controllable retention policy per tenant. `ON DELETE CASCADE` from `tenant` deletion, and `ON DELETE CASCADE` from owner FK deletion. Soft-delete pattern preserves history under audit log without exposing it to live reads. |
| **Prompt injection** | Permitted in **own-tenant Aegis only**. Label: `[ANALYST INTELLIGENCE for ${client.name} — observed-fact]`. Every injected row carries the owner FK (signal_id / entity_id / investigation_id) so the receiving prompt can re-resolve provenance. The receiving LLM is given the contract: *"Analyst intelligence items describe specific observations in this tenant. They MAY be cited as observed facts subject to their stated confidence."* Cross-tenant injection is **structurally impossible** — the retrieval seam fails closed before any tenant-mismatched row leaves the database. |

### 3.3 Schema sketch (illustrative)

```sql
create table agent_tenant_intelligence (
  id                    uuid primary key,
  tenant_id             uuid not null,                 -- enforced by trigger as well
  client_id             uuid,                          -- optional sub-scope inside tenant
  authored_by_agent     text not null,
  asset_class           text not null default 'tenant_intelligence'
                        check (asset_class = 'tenant_intelligence'),
  subclass              text not null check (
                          subclass in ('client_specific','entity_specific',
                                       'investigation_specific','environment_specific')
                        ),
  -- owner FK based on subclass (one of these is set):
  entity_id             uuid references entities(id) on delete cascade,
  investigation_id      uuid references poi_investigations(id) on delete cascade,
  incident_id           uuid references incidents(id) on delete cascade,
  hypothesis            text not null,
  confidence            numeric(4,3) not null,
  evidence_summary      text,
  evolution_log         jsonb,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  last_updated_at       timestamptz not null default now()
);

-- alter table ... force row level security;   -- Class C posture (per PR #48 inventory)
-- INSERT/UPDATE/DELETE RLS: tenant_id IN get_user_accessible_client_ids() or super_admin.
-- SELECT RLS: same. Service-role bypass IS NOT permitted (force RLS).
-- trg_tenant_belief_require_tenant: tenant_id IS NOT NULL or derive from owner FK or fail closed.
```

---

## 4. Cross-cutting concerns

### 4.1 RLS posture difference (Class C application)

| Class | RLS | Service-role behavior |
|---|---|---|
| **A — Global Tradecraft** | RLS enabled (after-anonymization permit-all-select; allowlist-only insert) | Service-role allowed to SELECT (every operator-facing surface can inject these); INSERT only through SECURITY DEFINER allowlist RPC |
| **B — Tenant Intelligence** | RLS enabled **and forced** (Class C from PR #48) | **Service-role does NOT bypass.** Reads must use the certified `tenantRetrieve()` seam, which sets `set_config('request.jwt.claim.sub', …)` or equivalent to apply RLS. |

This is the structural answer to the operator's open question: should service-role scope like every other role? **Yes — for Class B (tenant intelligence). No — for Class A (global tradecraft).** The platform posture splits by class, not universally.

### 4.2 Anonymization gate (Class A precondition)

For any write to Class A to land in the live store:

1. Content must pass an **entity-dictionary check**: no live tenant's client_name, entity_name, principal_name, or investigation_id appears in the content.
2. Content must pass a **provenance check**: the source materials cited in the write must themselves be from `asset_class='global_shared'` content (curated documents, public research papers, etc.) — not from a tenant's signals or incidents.
3. Failures route to `agent_tradecraft_quarantine` for operator review; never to the live store.

This is the missing piece of INC-LEARN-CONTAM remediation — the "write-time anonymization/identity gate" the original incident plan called for.

### 4.3 Flight Recorder visibility

Every belief injected into any LLM prompt is recorded in `aegis_retrieval_trace`:

| Class | Recorded fields |
|---|---|
| Global Tradecraft | `tradecraft_ref_id`, `domain`, `title`, `confidence`, `anonymization_status`, injection-side prompt rule |
| Tenant Intelligence | `tenant_id`, `tenant_intelligence_id`, `subclass`, owner FK (entity_id/investigation_id/incident_id), confidence, prompt rule |

Operators can `aegis_trace_replay(debug_trace_id)` and see exactly which class of belief contributed to a given response.

### 4.4 Confidence framework integration (Workstream D handshake)

Each class maps to the Workstream D claim taxonomy:

| Class | Workstream D type |
|---|---|
| Global Tradecraft | **`ai_generated_hypothesis`** — always labeled as such when surfaced to operators, never as `retrieved_fact` |
| Tenant Intelligence — entity_specific, investigation_specific | **`retrieved_fact`** if stored as observed; **`inferred_relationship`** if it's a joined inference; **`analyst_confirmed_assessment`** after operator validation |

This ensures the operator-visible confidence layer cannot label methodology as fact — same anti-certainty-theater rule that PR #42 and #44 enforced for the executive report.

### 4.5 What the legacy `agent_beliefs` table becomes

In the target architecture, `agent_beliefs` itself is **decommissioned** as an operational store. Its content splits into the two new tables. A read-only legacy view may be retained for historical audit, but no new writes occur. The 15,418 NULL rows flow into `agent_tradecraft` *after passing anonymization* (rows that fail anonymization land in quarantine). The 115 entity_narrative rows flow into `agent_tenant_intelligence` with `subclass='entity_specific'`, `tenant_id` resolved from the existing `client_id`.

This **is** a Class B (schema) migration. **It is not proposed here.** This document is the target-state contract that any future migration would have to honor.

---

## 5. Resolution of the false choice

Today's choice is "suppress everything (capability deficit)" vs "let it all through (contamination risk)." The target architecture eliminates the choice by separating concerns:

| Surface | Before | After |
|---|---|---|
| Operator-facing Aegis (`dashboard-ai-assistant`) | 0% tradecraft access (suppressed), 0% tenant intelligence for most tenants | Full tradecraft access (labeled `[TRADECRAFT REFERENCE]`) + full own-tenant intelligence (labeled `[ANALYST INTELLIGENCE for X]`) |
| Executive briefings (`generate-daily-briefing`) | Effective zero | Tradecraft + own-tenant intelligence, both injected with their proper labels and confidence framing |
| Agent-to-agent chat (`agent-chat`) | All NULL rows flow in without scope check | Tradecraft only — never tenant intelligence (agent-chat is operator-tier; tenant intelligence is operator-controlled) |
| Training (`academy-*`) | All NULL rows flow in | Tradecraft only |
| Login summary (`get-login-summary`) | All NULL rows flow in | Tradecraft only — but rate-limited and labeled |

Operator Aegis regains the methodology library that was suppressed. Tenant intelligence becomes structurally cross-tenant-immune. Every consumer ends up reading from the class appropriate to its trust level.

---

## 6. What this proposal does NOT do

- Does not propose the migration. The schema work is held alongside PR #36.
- Does not specify the anonymization gate's implementation details (entity-dictionary build, NER pipeline, quarantine workflow). Those are downstream design decisions.
- Does not specify the legacy-row split criteria for the 15,418 NULL rows in `agent_beliefs`. Every row would need to pass the anonymization gate to enter `agent_tradecraft`; failures quarantine. The migration script needs its own design.
- Does not address `agent_debate_records` (90.5% NULL) or other class-inventoried stores. The same architectural pattern applies but each store deserves its own consideration of where its content falls on the tradecraft/intelligence axis.
- Does not specify the Class C posture decision for *other* stores in the inventory. This proposal applies the posture to `agent_tenant_intelligence` specifically because tenant-isolation is the defining property.

---

## 7. Open operator decisions before migration design begins

1. **Does the split into Class A and Class B (two distinct tables) capture the right separation, or is a single-table-with-discriminator (`scope_class` column + CHECK constraints) preferred?** Two-table is structurally cleanest; single-table preserves a unified read interface but trusts CHECK constraints to enforce the split.
2. **Class A anonymization gate scope:** entity-dictionary check + tenant-derivative check are the minimum. Should the gate also enforce: no PII patterns (emails, phone numbers, addresses)? No geographic-specific references (city names of tenant operating regions)? Operator decides where to draw the line.
3. **Class A trusted-writer allowlist:** `knowledge-synthesizer` (global mode), `ingest-expert-media`, operator-only manual curation. Anything else? Should there be a Bring-Your-Own-Tradecraft path for tenant analysts to contribute back?
4. **Class B FORCE RLS:** binds the platform to "service-role scopes like every other role" for tenant intelligence. Other tenant-bounded stores already follow RLS (per the class inventory in PR #48). Confirming this becomes the platform posture for everything tenant-bound.
5. **Legacy migration discipline:** when the actual migration design begins, should the 15,418 NULL rows be (a) migrated en masse after batch anonymization, (b) curated by hand row-by-row, (c) decommissioned entirely and let `knowledge-synthesizer` rebuild a clean Class A from scratch?

The target architecture above stands independent of these answers. They become migration-design questions once you authorize the next phase.
