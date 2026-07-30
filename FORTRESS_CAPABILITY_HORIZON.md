# Fortress Capability Horizon — gates before capability

Capabilities that stay behind an explicit gate until their prerequisite is verified. A gate is a
promise the platform will not ship the capability until the listed conditions are proven. Nothing
here is in the current build queue.

---

## GATE: WO-BELIEF-PROVENANCE-01 — blocks Phase 3.5 (Synthetic Intelligence Loop) injection re-enable

**Opened:** 2026-07-30 (WO-PARTITION-01 belief-layer audit). **Status:** OPEN — blocking.
**Blocks:** re-enabling belief/knowledge injection into report generation, and Phase 3.5's
synthetic-loop belief writes.

### Why (audit facts, read-only, 2026-07-30)
- `agent_beliefs` carries `client_id` (uuid, **nullable**), **no `tenant_id`**, and **no
  signal-derivation column** (`supporting_entry_ids` → knowledge entries, not signals). A belief
  cannot be traced to the signals that produced it.
- Distribution: **15,533 total → 15,418 NULL-client · 115 PECL · 0 BC Place.** 99.3% unscoped.
- Currently contained: the report generator reads **no** belief store (`knowledgeContext`/
  `agentContext` disabled 2026-05-29); `agent_beliefs` is write-frozen (`trg_inc_learn_contam_freeze_ab`,
  INC-LEARN-CONTAM). The gate exists so this containment is not silently lifted.

### Scope (do NOT architect new — reuse existing patterns)
1. Add `tenant_id`; enforce **non-null** `client_id` scoping on `agent_beliefs`.
2. First-class **signal-derivation link** — every belief traces to the signals that produced it.
   No derivation link ⇒ the belief is **permanently non-citable**.
3. **Backfill or quarantine** the 15,418 NULL-client beliefs. Reuse the **Cascade Energy
   containment** pattern (45 → 0 retrievable) and the **born-quarantined** mechanism from the
   benchmark substrate. Do not build a new quarantine.
4. **Retrieval gate:** no belief may enter a report whose `client_id` differs from the report's;
   no belief with unresolvable signal provenance may be cited.
5. `trg_inc_learn_contam_freeze_ab` **stays in force** until 1–4 are verified.

### Watchdog invariants (live 2026-07-30)
- (b) any `agent_beliefs` row written with NULL `client_id` (recent) → CRITICAL.
- (c) any **top-tier-citable** source (`official`/`wire`) with `provenance_path='none'` → CRITICAL.
- (a) any report-generator read path lacking a `client_id` predicate → CI static guard
  (`scripts/check-generator-client-scope.mjs`).
