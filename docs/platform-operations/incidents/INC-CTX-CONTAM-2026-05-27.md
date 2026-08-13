# INC-CTX-CONTAM — Cross-tenant contextual contamination (Aegis introduced an out-of-tenant concept)

**Severity:** P0 (tenant-isolation / trust integrity)
**Opened:** 2026-05-27
**Status:** OPEN — containment shipped (PR #21, prod); doctrine **RATIFIED** (2026-05-27); Class-B (grounding) enforcement + parity tests + deeper-vector remediation pending.
**Related:** INC-AEGIS-TRUST · INC-LEARN-CONTAM · INC-CRT-DOCUMENT-SCOPE · ADR *Grounding-State Doctrine* · ADR *Unified Retrieval & Intelligence Graph* (#33) · ADR *Operational State Integrity* (#34) · Quarantine Doctrine · Provenance Doctrine.

---

## 1. Symptom (operator-observed)

Aegis referenced **"BC Children's Hospital Gender Clinic"** while operating inside the **CRT** tenant view for the **BC Place** client. That concept is not part of CRT's intelligence picture. Operator classification: *"NOT a prompt issue — a retrieval + context-isolation failure,"* top-priority integrity incident.

## 2. Forensic findings (prod `kpuqukppbmwebiptqmog`, 2026-05-27)

A full scan of every queryable text/retrieval surface was performed for `BC children` / `gender clinic` / `gender-affirming` / `gender`:

| Surface | Result |
|---|---|
| `entities` | **One** match: `BC Children's Hospital` (organization, `threat_score=null`, `risk_level=low`) owned by tenant **Silent Shield Operations** (`feff5c44…`) — **NOT** CRT. No entity named "Gender Clinic" exists. |
| `signals` (title/normalized_text) | 0 |
| `incidents` (title) | 0 |
| `entity_content` (title/excerpt/content_text) | 5 "gender" hits — **all unrelated noise** (gender-based-violence shelters, ACWS, IMDb bios). The BCH entity itself has **0** content rows. |
| `expert_knowledge` (L2 global) | 7 "gender" hits — **all noise** (*The Handmaid's Tale*, "Great Women in Compliance", "engender" in military-strategy text). None mention BCH or a gender clinic. |
| `global_learning_insights` (L2 global) | 1 hit — *The Handmaid's Tale* book summary. Noise. |
| `agent_beliefs` | 0 |

**Conclusion: the phrase "BC Children's Hospital Gender Clinic" exists in NO tenant retrieval surface.** Only the bare org name "BC Children's Hospital" exists, under a *different* tenant, with no threat score and no watch entry — so the (now-scoped) COP never selected it either.

## 3. Root cause — two distinct classes

### Class A — Retrieval contamination (a real, adjacent cross-tenant leak; now closed)
The **Common Operating Picture (COP)** — `_shared/common-operating-picture.ts`, injected into *every* Aegis/agent system prompt as always-on context — queried `incidents` / `signals` / `entities` / `predictive_incident_scores` / `entity_watch_list` / `agent_pending_messages` **globally, with no tenant filter**. Any tenant's critical signals, open incidents, top entities, and watched entities were placed into *every other tenant's* prompt window. A genuine cross-tenant data leak independent of the BCH phrasing — closed regardless. **It was not the vector for the BCH phrase** (BCH had `threat_score=null` and no watch, so it was never selected even by the unscoped COP), but it was a live leak surface.

### Class B — Parametric free-association / ungrounded assertion (the dominant vector here)
Because the phrase exists in **no** store, Aegis produced "BC Children's Hospital Gender Clinic" from **the model's own pretraining knowledge** — a real institution whose gender clinic is publicly documented. The model asserted a real-world concept with **no trace in any certified tenant retrieval surface**. Retrieval scoping cannot fix this (you cannot scope away parametric knowledge); the control is the **Grounding-State Doctrine** ("no grounding trace → no claim") enforced at the assertion layer. Formalized as a ratified ADR: `architecture-decisions/aegis-grounding-state-doctrine.md`.

## 4. Containment shipped (PR #21 → main `4c39d02c`, deployed prod)

`buildCOP` is now **tenant-scoped and fails closed**:
- `buildCOP(supabase, tenantId)` — no tenant → **empty COP** (never global).
- All 8 sub-queries scoped: `incidents`/`signals`/`entities`/`agent_pending_messages` by `tenant_id`; `predictive_incident_scores` via `signals!inner(tenant_id)`; `entity_watch_list` by the tenant's client ids. (`autonomous_scan_results` + `ai_agents` carry no tenant facts.)

> **AMENDMENT (2026-08-13, Q1 ruling) — the `autonomous_scan_results` exemption above was WRONG.** That table's `risk_score` was read unscoped (it has no `tenant_id`/`client_id` column to scope by) and rendered as `Risk posture: N/100` in every tenant's COP — a global threat-sweep score shown as per-client readiness, direction-inverted. AEGIS stated it as fact ("BC Place has a risk posture score of 97/100"). The read and the summary line are **removed** (`common-operating-picture.ts`, 2026-08-13); the table cannot be scoped, so there is no per-client posture until a real metric is designed (separate decision). **Second unscoped-shared-read → per-client-answer leak in two days** (the other: the static prompt roster, Class C). **Forensic rule added: "carries no tenant facts" is a CLAIM requiring proof, not an assumption** — every unscoped read in a per-tenant assembly must be shown to emit nothing tenant-attributable, the same standard as [[feedback-negative-finding-needs-complete-search]]. Logged in WO-FORENSIC-SURFACE-COMPLETENESS-01.
- `dashboard-ai-assistant`: prompt-side COP build **deferred to after `userTenantId` resolves** (was pre-auth/unscoped); `get_common_operating_picture` tool passes the gated `tenantId`.
- `agent-chat`: COP tenant derived from the conversation's **client** (authoritative subject), falling back to the agent's home tenant; no tenant → empty COP.

Deployed: `dashboard-ai-assistant`, `agent-chat` (prod). **Closes Class A.** Live behavioral confirmation (CRT/BC Place view no longer shows out-of-tenant COP facts) is an operator step.

## 5. Doctrine rules — RATIFIED 2026-05-27 (operator sign-off)

All 7 ratified; promoted to `CLAUDE.md` and subsumed by the **Grounding-State Doctrine** ADR.

1. **No semantic / free-association fallback in tenant mode.** Every asserted tenant fact must be traceable to a certified tenant retrieval surface ("no grounding trace → no claim").
2. **Recommendations only from certified tenant surfaces** + current tenant graph/entities/signals/sources/reports/documents. **No provenance → no recommendation.**
3. **Deleted tenants/clients are cryptographically unreachable** to tenant-Aegis retrieval/recommendation paths (no residual embeddings, cached summaries, memory artifacts, or prompt fragments).
4. **Context provenance on recommendations** — retrieval surfaces, entity IDs, signal IDs, source IDs, tenant scope attached. No provenance → no recommendation.
5. **Tenant-parity test (acceptance oracle).** If the UI / entity graph does not contain a concept/entity/client, Aegis cannot introduce it.
6. **Acronym-boundary handling.** No expanding ambiguous acronyms / completing partial names from global semantic memory in tenant mode; expansions resolve against tenant retrieval only.
7. **Deleted-client artifact investigation** — audit/purge out-of-tenant references in deleted-client embeddings, cached summaries, memory artifacts, recommendation prompts.

## 6. Remediation roadmap (post-containment)

- **R1 — Grounding-state persona enforcement (PRIMARY, Class B).** Tenant-mode no-free-association clause tied to "no grounding trace → no claim"; refuse or frame-as-general rather than assert ungrounded specifics. (Grounding-State Doctrine §Enforcement.2.)
- **R2 — Unscoped `entities` read audit** in `dashboard-ai-assistant` — confirm each `.from("entities")` read is tenant-scoped or an annotated operator surface; closes the residual Class-A path for a *bare* out-of-tenant name.
- **R3 — Tenant-parity test harness** (rule 5) — executable, extends the Unified Retrieval Graph parity oracle (#33).
- **R4 — Deleted-tenant artifact sweep** (rule 7) — embeddings/cache/memory stores.

## 7. Execution gate (RATIFIED)
F-stage execution stays **disabled** until grounding + provenance + traversal integrity is fully trustworthy (Grounding-State Doctrine §Execution gate). Build continues on provenance + traversal hardening; execution does not ship on top of unverified retrieval.

## 8. Out of scope (tracked separately)
Kelly Pietras unified-graph failure (duplicate canonical entity + investigation/OSINT retrieval) — separate direction under #33: canonicalization + edge-linked traversal + 4-way parity tests.

## 9. CORRECTION — root cause was misdiagnosed (2026-08-12, WO-PROMPT-ROSTER-01)

**Section 3 Class B ("parametric free-association") is SUPERSEDED. The phrase was not invented — it was hardcoded in the always-on system prompt.**

`_shared/fortress-operational-prompt.ts` (`FORTRESS_PLATFORM_OVERVIEW`, imported by `dashboard-ai-assistant`) shipped an `ACTIVE CLIENTS` roster on **2026-05-03** (commit `a2295744`) containing the literal line:

> `- BC Children's Hospital Gender Clinic (BCCH) — pediatric medical, Vancouver-area`

No roster existed before that commit. It was injected into **every** dashboard-ai-assistant session for **every** tenant. The **CRT** tenant ran **183 turns** on that path between the roster's ship date (05-03) and this incident (05-27) — every one carrying the phrase verbatim in the system prompt. The model did not emit a pretraining fact; **its own system prompt told it BCCH was an active client.** Proximate cause = **prompt contamination** (static cross-tenant identity injection), not parametric knowledge.

**Why the forensic missed it:** Section 2's "full scan of every queryable text/retrieval surface" examined seven *retrieval* stores and **never examined the static system prompt / tool definitions / persona** — the model's own instruction context. Absence-from-retrieval was read as absence-from-context, so a prompt-injected fact was ruled a hallucination. This surface-set blind spot is generalized in the method-failure finding carried out of this incident (see WO — forensic surface-set completeness).

**Corrected root-cause classes:**
- **Class A (COP global leak):** unchanged — real adjacent leak, closed by `buildCOP` tenant-scoping. Was *not* the BCH vector (correct in original).
- **Class B (parametric):** **withdrawn.** The dominant vector was the hardcoded roster in `FORTRESS_PLATFORM_OVERVIEW`.
- **Class C (NEW — prompt contamination):** static multi-client roster in a shared always-on prompt. Remediation: dynamic per-client context sourced from the client row (WO-PROMPT-ROSTER-01); no static client list may exist in any shared prompt. The Grounding-State Doctrine remains correct and useful, but it was **not** the load-bearing control for *this* phrase — removing the hardcoded line is.

**Exposure:** ~1,823 dashboard-ai-assistant turns across 4 tenant groups since 2026-05-03, still live at time of this correction (last activity 2026-08-12). One external cross-tenant disclosure (CRT — neither PECL nor BCCH). Full exposure table in WO-PROMPT-ROSTER-01.

Status accordingly stays **OPEN**: the load-bearing fix (dynamic roster) had not shipped when this correction was written.
