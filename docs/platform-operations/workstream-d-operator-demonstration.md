# Workstream D — operator-facing demonstration

**Purpose.** Pre-prod gate for PR #39. Validate that the four-question frame **improves decision quality and operator understanding** — not that the scoring is mathematically pretty. If any of the examples below feel like intelligence theater or score-heavy reporting, simplify before prod.

**Data source.** All four examples are grounded in **real staging data** (`lkvyrvuakzguszbpwnfz`). Where the staging fixture lacks a needed signal (e.g. a validation transition that never occurred), the gap is **called out explicitly** rather than papered over.

**Format.** Each example is shown in the exact markdown Aegis would render in the chat bubble. The bracketed type label is the first thing the operator reads. The body answers the four operator questions in this fixed order: *What do we know · How do we know it · How confident are we · What action.* A small drill control sits at the bottom for operators who want the underlying axes.

---

## Example 1 — Retrieved Fact

**Underlying staging record:** entity `db468a1b-d290-4511-9eb3-f5239314574c` (Trent Reznor), tenant *BC Place / FIFA Vancouver*, `attributes.role = "principal_protectee"`, provisioned by an operator on 2026-05-19.

### What the operator sees

> **[Retrieved fact]**  Trent Reznor is registered as a **principal protectee** in this tenant.
>
> **Source.** Operator-provisioned entity record (2026-05-19). Stored attribute `role: "principal_protectee"`; public profile noted as *musician (Nine Inch Nails, How to Destroy Angels, film scoring)*. One source · tenant-internal.
>
> **Confidence.** Well-attested. The source is a tenant-internal entity record set by an operator. Evidence is 9 days old (within freshness window). Not yet reviewed for current accuracy.
>
> **Recommended action.** None. This is a record-of-fact citation. Mark reviewed if the entry is still accurate.
>
> *↪ View source record · See axis detail*

### Why this works

The operator instantly knows: (a) this is a fact, not an inference; (b) where the fact comes from; (c) it has not been independently corroborated yet — just one tenant-internal source; (d) no action is needed beyond optional accuracy confirmation.

---

## Example 2 — Inferred Relationship

**Underlying staging records:** Trent Reznor (above) + BC Place entity `24a68222-ddd1-4420-94ea-aa95a9949417`, `attributes.role = "monitored_venue"`, `major_events = ["FIFA World Cup 2026", …]`, `operational_relevance = "FIFA 2026 host venue; VIP exposure; crowd & protest risk; event infrastructure"`. Both entities are scoped to the same tenant. The `entity_relationships` table contains **zero** rows linking them.

The inference: joining two retrieved facts (entity-A's `principal_protectee` role + entity-B's `monitored_venue` role + same tenant + entity-B's stored *VIP exposure* attribute) into a relationship that is **not itself stored**.

### What the operator sees

> **[Inferred relationship]**  BC Place is operationally relevant to Trent Reznor's protection profile — both entities live in the same tenant, and BC Place's stored attributes describe *VIP exposure* and *FIFA 2026 host* status.
>
> **Inferred from.** Two retrieved facts: (1) Trent Reznor's `role = principal_protectee`, (2) BC Place's `role = monitored_venue` plus `operational_relevance` text mentioning VIP exposure. No stored relationship record yet links these entities.
>
> **Confidence.** Inferred. Single-source on each side (both records are operator-provisioned tenant-internal). The inference itself has not been corroborated by any external source or operator review.
>
> **Recommended action.** Review and either confirm (creates a stored relationship) or reject (records that the link is not operationally meaningful).
>
> *↪ View both source entities · See axis detail · Confirm relationship · Reject*

### Why this works

The word *inferred* and the explicit "no stored relationship record" line tell the operator immediately this is not a fact they should quote in a briefing without doing the review themselves. The action is unambiguous: confirm or reject. The framing matches what an analyst would expect from a human intelligence officer — *"here's what I noticed, and here's why I'm not yet asserting it."*

---

## Example 3 — Analyst Confirmed Assessment

**Demonstrative.** In staging today no operator has reviewed this inference. The display below shows what the **same Example 2 claim** looks like *after* an operator clicks `Confirm relationship`. The validation state machine moves to `accepted`; the claim type up-casts from `inferred_relationship` to `analyst_confirmed_assessment`; the prose language is allowed to shift to confirmed voice.

### What the operator sees

> **[Analyst-confirmed]**  BC Place is operationally relevant to Trent Reznor's protection profile. Confirmed by *Aaron Kilback* on 2026-05-28.
>
> **Source.** Originally inferred from two tenant entity records; now stored as a confirmed relationship after operator review.
>
> **Confidence.** Confirmed. Operator-validated. Underlying entity records remain the source of truth; if either is amended, this assessment automatically reverts to *inferred* pending re-review.
>
> **Recommended action.** None. The relationship is now first-class data; downstream tools (graph traversal, monitoring assignment) may rely on it.
>
> *↪ View confirmation event · View source entities · Withdraw confirmation*

### Why this works

The headline `[Analyst-confirmed]` + the operator's name + date is the only signal an analyst needs to use this claim with full weight. The "automatically reverts to inferred" note is the structural guarantee that operator approval is not permanent — if the underlying facts move, the trust moves with them. The action prompt is *Withdraw confirmation* rather than *Edit*, because operator validation is event-based and append-only (consistent with the audit table).

---

## Example 4 — AI Generated Hypothesis

**Underlying staging state.** Tenant *BC Place / FIFA Vancouver* contains: 3 entities (1 person, 1 infrastructure, 1 fixture organization), **0** stored relationships, **0** investigations, **0** entity_content rows. No external evidence is cited.

This is not derived from any specific stored finding. It is Aegis observing a pattern in the absence of data.

### What the operator sees

> **[AI hypothesis — not corroborated]**  The protection profile for this tenant may be under-developed for the FIFA 2026 timeline. The tenant lists a principal protectee and a major host venue, but stores no relationships, investigations, or monitoring content yet.
>
> **Basis.** Pattern observation by Aegis. No source record supports this claim; it is generated from the absence of expected supporting data.
>
> **Confidence.** Hypothesis. Not corroborated. Could be wrong — the missing structure may exist outside Fortress (paper files, partner systems) or be intentionally light.
>
> **Recommended action.** Consider whether the protection profile would benefit from: a stored Reznor↔BC Place relationship · a baseline scan on the principal · a monitoring keyword set on the venue. This is a prompt, not a finding.
>
> *↪ See what would change the hypothesis · Mark hypothesis reviewed · Reject hypothesis*

### Why this works

The bracket `[AI hypothesis — not corroborated]` is visually distinct from the other three. The word *hypothesis* sets the floor — the operator is reading Aegis's interpretation, not data. The "Could be wrong" line is a deliberate humility marker — no certainty theater. The recommended action is framed as *consider*, not *do*. There is nothing on this card the operator would mistake for a verified fact.

---

## Side-by-side — same underlying entity, four states

To validate the framing under state changes, here is the same protective-profile relationship across all four claim types (Example 2 reused for the inference; Example 3 reused for confirmed; one additional state — *stale* — added for completeness):

| State | Headline | Operator's mental model |
|---|---|---|
| Retrieved fact (just the role attribute) | **[Retrieved fact]**  Trent Reznor is registered as a principal protectee in this tenant. | *"That's just a registered fact about the principal."* |
| Inferred relationship (joining two facts) | **[Inferred relationship]**  BC Place is operationally relevant to Trent Reznor's protection profile. | *"That's a connection Aegis is suggesting. I need to confirm or reject it."* |
| Analyst-confirmed assessment | **[Analyst-confirmed]**  BC Place is operationally relevant to Trent Reznor's protection profile. *Confirmed by Aaron on 2026-05-28.* | *"That's a confirmed relationship. I can rely on it for downstream work."* |
| Stale (same as above, but evidence aged out) | **[Analyst-confirmed · stale]**  BC Place is operationally relevant to Trent Reznor's protection profile. *Confirmed by Aaron on 2025-11-12; most recent evidence is 198 days old.* | *"Confirmed in the past — but old. I should re-review before relying on it."* |
| AI hypothesis | **[AI hypothesis — not corroborated]**  Protection profile may be under-developed for the FIFA 2026 timeline. | *"That's Aegis's interpretation. I should look into it but it's not data."* |

Across the four states **the underlying assertion stays similar, but the framing language and recommended action change to match what the operator can responsibly do with it.** That is the entire point of the framework.

---

## What you will *not* see in Aegis output

This is the negative test — the things the framing prevents.

- ❌ Numerical confidence scores in the headline. The number `0.84` never appears in the chat bubble unless the operator clicks *axis detail*.
- ❌ A composite "trust score." No `87% confident` style claim. The label is qualitative.
- ❌ "Confirmed" or "Verified" on anything not in the `accepted` validation state. Example 2 cannot use the word *confirmed* — the prose-lint catches it.
- ❌ "Multiple sources" / "Widely reported" on a single-lineage claim. Same lint enforcement.
- ❌ "Reports indicate" / "Sources say" on an AI hypothesis. The hypothesis headline + the *not corroborated* qualifier make this structurally impossible.
- ❌ Stale claims displayed without an age qualifier. The freshness label is forced into the prose.
- ❌ Ungrounded claims displayed at all. They are suppressed before they reach the operator.
- ❌ Any action that mutates state automatically based on a score. *Recommended action* is always a prompt to a human; `executed: false` is a type-level invariant.

---

## Operator decision

The output above is the **whole user-visible surface** of Workstream D after the slim slice ships. The CI lint catches the negative-test items even if a future code change tries to drift back toward intelligence theater.

If the four examples feel operationally clear, the slim-slice prod apply (PR #39) is ready when you call it.

If anything feels like score-heavy reporting — **say what** and I will simplify before prod.
