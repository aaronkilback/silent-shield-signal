# Tenant-Scoped Platform Introspection

**Type:** Roadmap / architecture-review backlog requirement.
**Status:** PROPOSED (queued) — does **not** jump the frozen P0 critical path (Claim Gate → Linkage/G3 → Resolution → Ground-Truth Harvesting). Realized *by* existing workstreams as they mature; this is the operator-facing synthesis layer on top of them, not a new project.
**Provenance:** Operator Friction Ledger, Petronas voice session 2026-06-06 — consolidates the "surprised-by-its-own-platform" cluster (OFL-01/02/03/04/08/09/15). Spans candidate factories **A** (bounded uncertainty), **B** (capability awareness), **C** (coverage discovery), **D** (grounding/provenance) — all still under validation (n=1).

---

## Problem

The session exposed a recurring failure mode: **Aegis was repeatedly surprised by its own platform.**
- ArcGIS references existed but Aegis could not explain access boundaries.
- Asset maps existed but Aegis could not determine reachability.
- Entity/agent counts were inconsistent (20→60; "one Petronas entity").
- Actions were offered before authority was verified.
- Retrieval surfaces existed but Aegis could not explain reachable vs. unavailable.

**The problem is not merely access — it is that Aegis lacks a complete model of its own operating environment.** It discovers its own limitations *during* the conversation, in front of the operator.

## Requirement

For any **tenant-scoped** object in Fortress, Aegis must be able to: (1) **discover** it, (2) **explain** it, (3) state its **access boundary**, (4) state its **authority boundary**, (5) describe **available actions**.

Before answering, Aegis should already know: *What exists? What can be reached? What cannot be reached? What actions are possible? What actions are impossible? What evidence supports that conclusion?*

## Capability categories

**Inventory** — enumerate tenant-scoped assets: entities · signals · incidents · investigations · sources · documents · maps · reports · agents · monitors · relationships · collections · workflows. *(Counts must be canonical — see workstream map.)*

**Reachability** — for every surface, one of: **Directly Accessible · Indirectly Accessible · Referenced-but-Unavailable · Unknown**. *(The ArcGIS-in-signal-metadata case is "Referenced-but-Unavailable"; the asset map is "Unknown" until coverage states otherwise.)*

**Authority** — for every object: **Read · Create · Update · Delete · Execute-Workflow**. **Aegis must determine authority before proposing action. Offered capability must imply executable capability.**

**Explanation** — for any discovered object: *What is it? Why does it matter? How is it connected? What evidence exists? What limitations apply?*

## Bounded-uncertainty requirement

If Aegis cannot determine access, completeness, or authority, it must **express the boundary explicitly** (instantiates the provisional Bounded Uncertainty Doctrine; this requirement is also a primary real-world test of that hypothesis).

| ✅ Good (boundary expressed) | ❌ Bad (certainty overstated) |
|---|---|
| "I found one Petronas entity through available retrieval paths. **Completeness is unknown.**" | "There is one Petronas entity." |
| "ArcGIS references exist in signal metadata. **I do not currently have retrieval capability for the underlying map.**" | "The map does not exist." |
| "**I cannot determine whether entity-creation authority is available** in this environment." | "Let's create an entity." |

## Success criterion

**Aegis should never discover its own limitations during a conversation.** Before responding it already knows: what exists · what it can access · what it cannot access · what actions it can perform · what actions it cannot perform.

## Core principle

**The objective is not universal access. The objective is zero surprise.** Aegis must never be surprised by the platform it operates within.

---

## Realized by existing workstreams (no new project)

| Capability category | Existing workstream(s) | Friction / factory |
|---|---|---|
| Inventory (canonical, consistent counts + completeness caveat) | P1.1 canonical metrics (extend to entity/agent/object counts) · Coverage (R1) | F3 / OFL-08, OFL-09 · Factories A, C |
| Reachability (4-state per surface) | Certified-retrieval allowlist (`CERTIFIED_TENANT_SURFACES`, R1 seam) · ArcGIS integration · Coverage (R1) | F4 / OFL-01, OFL-04 · Factory C |
| Authority (RCUD + execute; determine before proposing) | Aegis Authority — Capability Registry (AR1) / Refusal (AR4) / Receipts (AR3) | F1 / OFL-02, OFL-03, OFL-14, OFL-15 · Factory B |
| Explanation (what/why/connected/evidence/limits) | Claim Gate / Grounding-State (P1.2) · Linkage/G3 (connections) | F2/F4 · Factory D |
| Bounded-uncertainty expression across all of the above | Bounded Uncertainty Doctrine (PROVISIONAL) | Factory A |

**Dependency note.** Introspection is a *consuming* capability: it becomes trustworthy only as canonical counts (P1.1), certified retrieval (R1), the capability registry (Aegis Authority), and coverage (R1) mature. It therefore sits **behind** the P0 critical path and is built as the synthesis layer once its inputs are trustworthy — it does not reorder the frozen priorities. Notably, if delivered, it would close the operator-facing symptoms of candidate factories A–D simultaneously — which is also why it doubles as a strong validation target for the Bounded-Uncertainty hypothesis.

**Firewall.** This requirement is behavior-loop / roadmap evidence (what to build). It does not alter what Aegis believes is true.
