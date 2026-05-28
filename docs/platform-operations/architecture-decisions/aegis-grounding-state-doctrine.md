# ADR — Aegis Grounding-State Doctrine ("no grounding trace → no claim")

**Status:** RATIFIED 2026-05-27 (operator sign-off, INC-CTX-CONTAM). Governing doctrine for every factual assertion Aegis makes in tenant-scoped intelligence mode. **Locked principle: a tenant-fact claim may be asserted ONLY when it is grounded in a certified tenant retrieval trace.** Ungrounded (parametric / world-knowledge) specifics are prohibited as tenant intelligence — Aegis refuses or explicitly marks them as general knowledge, never presents them as retrieved tenant fact. This is the epistemic/retrieval-side twin of the Operational State Integrity doctrine (`aegis-operational-state-integrity.md`): that one says *"no persisted object → no claim"* for actions; this one says *"no grounding trace → no claim"* for facts.

## Problem (formalized — INC-CTX-CONTAM Class B)

Aegis referenced **"BC Children's Hospital Gender Clinic"** while operating in the **CRT** tenant view. A full prod forensic proved that phrase exists in **zero** tenant retrieval surfaces (entities, signals, incidents, entity_content, expert_knowledge, global_learning_insights, agent_beliefs). The COP global-injection leak (Class A) was real and closed (PR #21), but it was **not** the vector here. The phrase came from the **model's pretraining knowledge** — a real-world institution and its publicly-documented clinic — emitted as if it were tenant intelligence, with **no trace in any certified surface.**

Retrieval scoping cannot fix this: you cannot scope away a fact the model already holds parametrically. The only control is an **assertion-layer** discipline — the model must know, and act on, *whether a claim is grounded.*

## Principle (RATIFIED)

Every factual claim Aegis emits has an explicit **grounding state**:

- **Grounded** — backed by a **certified tenant retrieval trace**: surface (from `CERTIFIED_TENANT_SURFACES`) + tenant scope + the concrete `row_ids`/provenance returned by `tenantRetrieve()`. Such a claim asserts only what the trace actually contains.
- **Ungrounded** — derived from the model's parametric/world knowledge with **no tenant trace**.

**In tenant-scoped intelligence mode, only grounded claims may be asserted as tenant fact.** Ungrounded specifics — entity names, client names, concepts, events, relationships, and **expansions of acronyms or completions of partial names** — are prohibited. The correct response is honest absence ("not identified in this tenant's intelligence") or an explicit general-knowledge frame — **never** free-association presented as retrieved fact.

Grounding state is **first-class and tracked**, not implicit. The retrieval seam stamps the grounding basis (provenance); the persona enforces refusal of ungrounded assertion; answers/receipts carry the basis.

## What is and isn't a grounded-claim requirement

| Speech act | Requires grounding? |
|---|---|
| "Entity X is monitored / linked to signal Y / located at Z" (tenant fact) | **Yes** — must cite a certified retrieval trace. |
| Expanding an acronym or completing a partial name into a specific named thing | **Yes** — resolve against tenant retrieval; otherwise ungrounded. |
| Naming a client/entity/concept not present in the tenant graph | **Prohibited** — ungrounded by definition. |
| General methodology / tradecraft ("here's how to assess insider-threat risk") | No — but must be **framed as general guidance**, not as something retrieved about this tenant. |
| Analysis/reasoning *over* grounded facts | Inherits the grounding of the facts it reasons over; must cite them. |

The dividing line is **tenant-specific factual assertion** vs **general method**. The doctrine never forbids the model from being helpful with general security knowledge; it forbids the model from **dressing parametric world-facts as tenant intelligence.**

## Enforcement (defense in depth)

1. **Retrieval seam** — `tenantRetrieve()` over `CERTIFIED_TENANT_SURFACES` returns provenance (surface, scope, `row_ids`). This *is* the grounding basis. (Certified-Safe Allowlist, principle 14.)
2. **Persona / system prompt (R1 build slice)** — an explicit tenant-mode clause: no free-association; assert tenant facts only from retrieval traces; refuse or frame-as-general otherwise; never expand acronyms/partial names from world knowledge. Tie wording to honest refusal (AR4), not generic-SaaS deflection.
3. **Output / anti-hallucination discipline** — tenant-fact assertions must reference a trace; ungrounded specifics are blocked, not narrated.
4. **Tenant-parity test (acceptance oracle)** — if the tenant UI / entity graph does not contain a concept/entity/client, Aegis cannot introduce it. Implement as an executable test (pick something in tenant A, absent in tenant B; assert Aegis-in-B can neither retrieve nor name it).

## Relationship + sequencing

- **Twin of Operational State Integrity.** Facts: "no grounding trace → no claim." Actions: "no persisted object → no claim." Together they make Aegis *epistemically and operationally truthful* — never sounding more informed or more capable than the underlying grounded/persisted state.
- **Operationalizes** principles 11 (retrieval order) + 13 (Cross-Tenant Retrieval Exclusivity) + 14 (Certified-Safe Allowlist) at the **assertion** layer. Even certified retrieval grounds *only what it returns*; anything beyond is ungrounded.
- **Subsumes** the INC-CTX-CONTAM doctrine rules (no semantic fallback in tenant mode; certified-surface-only recommendations; context provenance; acronym-boundary handling).

## Execution gate (RATIFIED operator directive, 2026-05-27)

**F-stage execution (Operational State Integrity) stays DISABLED until grounding + provenance + traversal integrity is proven fully trustworthy.** Rationale: executing an action on top of ungrounded or contaminated retrieval converts an epistemic error into a real-world mutation. Grounding integrity is a hard **prerequisite gate** for enabling any execution capability — including the monitoring-state toggle that is otherwise the first intended F-stage capability. Build continues on **provenance + traversal hardening** (R1 persona grounding-state enforcement, certified surfaces, unified retrieval graph); E (approval) may be designed, but F (execution) does not ship until this gate clears.

**No code in this ADR. Formalization of grounding-state integrity; the persona enforcement slice (R1) is the gated next build step.**
