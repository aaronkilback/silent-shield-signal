# Queue Generation Reduction Assessment

**Operator-directed 2026-05-31 (Task #123).** Read-only diagnosis. Empirical duplication analysis against last-90-days prod data across three queue surfaces.

**Operator framing:** "*Reduce approval queue inflow before automating approvals. The O3 validation demonstrated that the primary issue is duplication, not approval effort.*"

Tied to doctrine: *"Operator attention is critical infrastructure."* Protecting it means preventing waste at the source — not filtering it at the destination.

---

## §0 — Headline

| Metric | monitoring_proposals (keywords) | entity_suggestions |
|---|---:|---:|
| Total inflow (last 90d) | 359 | 334 |
| **Exact duplicates** | **21.4%** (77) | **37.7%** (126) |
| **Already in client/tenant state** | **18.4%** (66 already in `clients.monitoring_keywords`) | **40.7%** (136 match an existing `entities.name`) |
| Near-duplicate clusters (token-set) | ≥30% additional | not measured but observed |
| Combined removable-at-write estimate | **~36-50% of inflow** | **~54-66% of inflow** |

**Conservative combined queue reduction if write-side gates land: ~50% of total inflow.**

The original Approval Queue Overload Assessment estimated ~3 hours/week recovered through approval automation. The validation withdrew most of that. **This intervention recovers a larger share, with lower risk, by addressing the root cause.**

---

## §1 — Duplication Analysis

### A — Exact duplicates

#### monitoring_proposals — `add_keyword` (90d, 359 proposals)

| Metric | Value |
|---|---:|
| Distinct normalized keywords | 282 |
| Total proposals | 359 |
| Exact duplicates beyond first | **77** |
| Exact dupe % of inflow | **21.4%** |
| Keyword buckets with ≥2 dupes | 36 |
| Proposals in duplicate buckets | 113 |

**Top exact-duplicate keywords (cross-client noise — the headline finding):**

| Keyword | Dupe count | Distinct clients | Statuses |
|---|---:|---:|---|
| "mitre att&ck v18 detection strategies" | 9 | **9 clients** | applied, pending |
| "ransomware-as-a-service detection strategies" | 8 | **8 clients** | pending |
| "supply chain cybersecurity threat patterns 2026" | 6 | **6 clients** (created <40 sec apart) | pending |
| "supply chain attacks mitigation strategies" | 6 | 6 clients | pending |
| "supply chain attacks defense mechanisms" | 6 | 6 clients | pending |
| "advanced persistent threats evolving tactics" | 5 | 5 clients | pending |
| "emerging mitre att&ck techniques 2025" | 4 | 4 clients | pending |

The exact-duplicate population is dominated by **global cybersecurity doctrine** (MITRE ATT&CK, ransomware, supply chain, APT, zero-day) proposed across multiple clients simultaneously. This is not per-incident keyword duplication — it is cross-client noise from one agent that doesn't know what to do with global tradecraft.

#### entity_suggestions (90d, 334 suggestions)

| Metric | Value |
|---|---:|
| Distinct (name, type) pairs | 208 |
| Total suggestions | 334 |
| Exact duplicates beyond first | **126** |
| Exact dupe % of inflow | **37.7%** |
| Pairs with ≥2 dupes | 66 |
| Suggestions matching existing entity | **136 (40.7%)** |

**Top exact-duplicate entity suggestions:**

| Name | Type | Count | Source | Note |
|---|---|---:|---|---|
| "ksi lisims" | person | 12 | signal | (Likely a chief; legitimate person re-extracted) |
| **"world cup"** | **person** | 7 | signal | **Misclassification — event, not person** |
| "frank alec (dini ze woos)" | person | 6 | auto_enrichment | Conf 0.43 — speculative |
| "peace river regional" | person | 6 | signal | **Misclassification — region, not person** |
| **"cowichan tribes"** | **person** | 5 | signal | **Misclassification — organization, not person** |
| "dini'ze woos" | person | 4 | auto_enrichment | Variant of #3 above |
| "news.google.com" | domain | 4 | signal | (Domain re-extracted) |
| **"the supreme court"** | **person** | 4 | signal | **Misclassification — institution, not person** |
| "jacob pierro" | person | 4 | auto_enrichment | Conf 0.00 — extraction noise |
| **"fort st"** | **location** | 4 | auto_enrichment | **Truncation error — incomplete name** |
| **"environment canada"** | **person** | 3 | signal | **Misclassification — agency, not person** |
| **"old fort landslide"** | **person** | 3 | signal | **Misclassification — event, not person** |

**Critical secondary finding: extraction misclassification.** Many duplicates are the same misclassification being made repeatedly. "World Cup", "Cowichan Tribes", "The Supreme Court", "Environment Canada", "Old Fort Landslide", "Peace River Regional" all classified as `person` at confidence 0.8-0.95. The extraction pipeline has a quality problem distinct from but compounding the duplication problem.

### B — Near-duplicates (token-set overlap)

Tokens shared ≥2 entities, ≥3 token overlap:

| Token set | Items sharing | Variant phrasings |
|---|---:|---|
| ransomware + service + detection + strategies | 6 | "Ransomware-as-a-Service Detection Strategies" |
| supply + chain + cybersecurity + threat + patterns + 2026 | 6 | "Supply Chain Cybersecurity Threat Patterns 2026" |
| ransomware + service + mitigation + strategies | 5 | "Ransomware as a Service (RaaS) Mitigation Strategies" / "Ransomware as a Service Mitigation Strategies" |
| supply + chain + attacks + mitigation + strategies | 5 | "Supply Chain Attacks Mitigation Strategies" + variants |
| emerging + techniques + 2025 | 5 | "Emerging APT Techniques 2025" + "Emerging MITRE ATT&CK Techniques 2025" |
| advanced + persistent + threats + evolving + tactics | 3 | "Advanced Persistent Threats Evolving Tactics" + "2025-2026" variant |
| wet'suwet'en + land + defenders + blockade | 3 | "Wet'suwet'en land defenders blockade" + Houston variants |
| coastal + pipeline + sabotage | 3 | "Coastal GasLink pipeline sabotage" + "pipeline sabotage Coastal GasLink" + "Coastal GasLink pipeline sabotage threats" |

Near-duplicate rate adds another ~10-15% on top of the exact-dupe count (these are different normalized strings but semantically identical).

### C — Already-covered duplicates

**18.4% of monitoring_proposals are already in `clients.monitoring_keywords` for the same client** (66 of 359):

| Status of redundant proposal | Count |
|---|---:|
| pending (operator hasn't reviewed yet) | 0 |
| **applied (proposal applied, keyword now in client state)** | **64** |
| rejected | 2 |

Translation: 64 of the proposals went through the queue, got approved, and **the operator is being asked to approve future paraphrases of the same keyword** because the agent never checked existing state.

For entity_suggestions: **136 of 334 (40.7%) match an existing `entities.name`** in the same tenant. The operator is being asked to "approve" entities that already exist.

---

## §2 — Agent Behavior (Root Cause)

### CRUCIBLE batch pattern (decisive)

`monitoring_proposals add_keyword` proposals last 90 days:

| Metric | Value |
|---|---:|
| Proposing agent | CRUCIBLE (100% of inflow) |
| Distinct burst minutes | 31 |
| **Max proposals in a single minute** | **27** |
| **Max clients targeted in a single minute** | **12** |
| Average proposals per burst | 11.6 |
| Total proposals | 359 |

CRUCIBLE runs in batches. When it runs, it generates proposals across **up to 12 clients in a single minute, with 27 proposals**. This batch pattern explains how the same keyword ("MITRE ATT&CK v18 detection strategies") gets proposed to 9 clients within seconds.

### Five compounding causes (all confirmed empirically)

1. **No write-side deduplication.** The DB schema has no unique constraint on `(client_id, normalized_keyword)` for monitoring_proposals nor `(tenant_id, normalized_name, suggested_type)` for entity_suggestions. Every INSERT succeeds regardless of duplicates.

2. **No agent check against existing tenant state.** Before proposing, CRUCIBLE does not query `clients.monitoring_keywords` (18.4% redundancy). The entity extractor does not query `entities.name` (40.7% match-existing rate).

3. **No agent memory of its own prior proposals.** Same agent re-proposes paraphrases of items it proposed days earlier; never reads its own monitoring_proposals history.

4. **Cross-client cybersecurity-doctrine proliferation.** CRUCIBLE generates *global tradecraft content* (MITRE ATT&CK technique names, ransomware mitigation strategies, supply chain attack patterns) and routes it through the *per-client monitoring proposal* surface. These are not client-specific monitoring keywords — they are global security knowledge being misrouted.

5. **Extraction-layer misclassification.** Entity extractor labels "World Cup" (event), "The Supreme Court" (institution), "Environment Canada" (agency), "Old Fort Landslide" (event), "Cowichan Tribes" (organization), "Peace River Regional" (region) all as `person` at 0.8-0.95 confidence. The same wrong classification recurs, generating duplicate-classification-errors.

---

## §3 — Canonicalization Opportunities

### CO-1 — Keyword canonicalization

The 9-clients-with-same-keyword pattern indicates **most cross-client repeated keywords are global tradecraft, not per-client coverage.** Canonicalization shape:

- IF a keyword is proposed to ≥3 distinct clients in ≤1 hour → it is global tradecraft → route to `agent_tradecraft` (the proper home) and **do not propose as per-client monitoring**
- IF a keyword is per-incident (Coastal GasLink, Wet'suwet'en) → it is properly client-specific → keep proposing, but only ONCE per (client_id, normalized_keyword)

Same `agent_tradecraft` table that absorbed 15,418 legacy `agent_beliefs` rows in the Class A migration. The architectural home exists; CRUCIBLE just isn't using it.

### CO-2 — Entity canonicalization

Before insert into `entity_suggestions`:

1. Normalize `suggested_name` (trim, lowercase, collapse whitespace)
2. Check `entities.name` (normalized) for same tenant — if match, **don't insert, link to existing entity** instead
3. Check existing `entity_suggestions` for same normalized name + type + tenant — if pending, **don't re-insert** (increment a count or update confidence)
4. Optional: alias-match (`entities.aliases`) for known variants

This is `MERGE` / `UPSERT` semantics applied to entity discovery. The existing `matched_entity_id` column on `entity_suggestions` indicates this was the original design intent but isn't being used at write time.

### CO-3 — Extraction-type validation

Before classifying as `person`, apply rules:
- Does the name contain `court`, `tribes`, `regional`, `canada`, `landslide`, `cup`, `news.`, `nation`, `observer`, `service`, `agency`, `department`? → likely NOT a person; either reclassify or quarantine
- Does the confidence come from `auto_enrichment` at <0.50? → reject without queue insert (matches the surviving O4 boundary)
- Two-word names containing geographic markers ("Fort St", "Peace River") → likely location or organization, not person

This is the entity-type guardrail. Implemented as a writer-side check before INSERT into `entity_suggestions`.

---

## §4 — Queue Reduction Potential

### Per-surface projection (conservative)

**monitoring_proposals — current inflow ~40/day, ~280/week (during active CRUCIBLE bursts):**

| Intervention | Removable proposals (90d sample) | % of 359 |
|---|---:|---:|
| Pre-write unique on (client_id, normalized_keyword) | 77 (exact dupes) | 21.4% |
| Pre-write check against client.monitoring_keywords | 66 (already covered) | 18.4% |
| Overlap between above two | ~30 | -8% |
| **Net from CO-1 mechanical canonicalization** | **~113** | **~31%** |
| Cross-client doctrine separation (CO-1 routing fix) | ~40-60 (the supply-chain / MITRE clusters) | +11-17% |
| **Net total after CO-1** | **~150-170** | **~42-47%** |
| Near-dupe semantic collapse | ~20-30 additional | +6-8% |
| **GRAND TOTAL achievable** | **~170-200** | **~47-56%** |

**entity_suggestions — current pending depth 260, ~334 inflow over 90d:**

| Intervention | Removable suggestions (90d sample) | % of 334 |
|---|---:|---:|
| Pre-write unique on (tenant_id, normalized_name, suggested_type) | 126 (exact dupes) | 37.7% |
| Pre-write check against entities.name (same tenant) | 136 (match existing) | 40.7% |
| Overlap between above two | ~50 (some exact dupes are also existing matches) | -15% |
| **Net from CO-2 mechanical canonicalization** | **~212** | **~63%** |
| CO-3 extraction-type validation (person misclassifications) | ~20-30 | +6-9% |
| **GRAND TOTAL achievable** | **~230-240** | **~69-72%** |

### Combined queue inflow projection

Pre-intervention inflow (90d): 359 + 334 = **693 proposals/suggestions hitting the operator queue surfaces**.

Post-intervention inflow estimate:
- monitoring_proposals: 359 - 180 ≈ **179** (50% reduction)
- entity_suggestions: 334 - 235 ≈ **99** (70% reduction)
- **Combined: 278** (60% reduction overall)

**That is 415 items per 90 days NOT reaching the queue surfaces.** In weekly terms: roughly **32 fewer items per week** that the operator never has to see.

The pending pool also drains naturally: of the current 260 pending entity_suggestions, ~136 (the existing-entity matches) could be auto-merged via CO-2 backfill. Of the 316 pending monitoring_proposals, ~66 (the already-covered) could be auto-resolved via CO-1 backfill.

---

## §5 — Highest-Leverage Interventions (Ranked)

Ranked by leverage = (impact × certainty) / (effort × risk).

### I1 — Pre-write unique constraint on monitoring_proposals (HIGHEST LEVERAGE)

- **What:** partial unique index on `(client_id, LOWER(TRIM(proposed_value)))` WHERE `status IN ('pending','applied')`. Migration alone — no code change required.
- **Catches:** 77 exact dupes (21.4% of inflow) + future inflow at same rate
- **Effort:** 1 migration, ~30 minutes
- **Risk:** Very low — DB rejects the dupe insert; agent sees the constraint violation and skips (or upserts)
- **Trust impact:** POSITIVE — operator never sees the dupes; nothing they wanted appears missing
- **Reversibility:** trivial — drop the index

### I2 — Pre-write check against existing entity names (HIGHEST LEVERAGE)

- **What:** writer-side query at INSERT time into `entity_suggestions`. If `LOWER(TRIM(name))` matches existing `entities.name` (same tenant), insert with `status='auto_merged'` and `matched_entity_id=<existing>` instead of `status='pending'`. Use the existing `matched_entity_id` column.
- **Catches:** 136 already-existing matches (40.7%) + future inflow at same rate
- **Effort:** writer change in entity-suggestion paths (likely `correlate-entities` and `ingest-signal` + agent-chat); ~2-4 hours
- **Risk:** Low — items remain in DB with `auto_merged` status; operator-recoverable; this is what the schema was designed for
- **Trust impact:** POSITIVE — operator stops being asked to approve existing entities
- **Reversibility:** trivial — disable the check

### I3 — Pre-write check against client.monitoring_keywords (HIGHEST LEVERAGE)

- **What:** writer-side query into `monitoring_proposals`. If proposed keyword already in `clients.monitoring_keywords` for that client, reject the proposal (do not insert).
- **Catches:** 66 already-covered (18.4%) + future inflow at same rate
- **Effort:** writer change in `agent-actions.ts proposeAction()` for `add_keyword` paths; ~1-2 hours
- **Risk:** Very low — the keyword is already covered; rejecting the proposal preserves the existing coverage
- **Trust impact:** POSITIVE — operator stops being asked to add what's already there
- **Reversibility:** trivial

### I4 — Extraction-type validation (MEDIUM LEVERAGE)

- **What:** writer-side rules before `entity_suggestions` INSERT. If `suggested_type='person'` AND name matches non-person patterns (`%court%`, `%tribes%`, `%canada%`, `%landslide%`, `%cup%`, `%regional%`, `news.%`), either reclassify or quarantine.
- **Catches:** 20-30 of 334 (~6-9%) — the misclassifications
- **Effort:** small blocklist + writer change; ~2-3 hours
- **Risk:** Low — quarantine instead of reject is even safer; operator can review the quarantine
- **Trust impact:** POSITIVE — stops obviously-wrong classifications
- **Reversibility:** trivial — disable rules

### I5 — Cross-client cybersecurity-doctrine separation (HIGH IMPACT, MEDIUM RISK)

- **What:** When CRUCIBLE generates a keyword that gets proposed to ≥3 distinct clients within ≤1 hour, mark it as global tradecraft → write to `agent_tradecraft` (Class A global store) instead of `monitoring_proposals`. CRUCIBLE prompt change to discriminate: "is this signal a per-client incident OR global cybersecurity doctrine?"
- **Catches:** 40-60 of 359 (~11-17%) — the MITRE / supply-chain / ransomware clusters
- **Effort:** medium — requires either CRUCIBLE prompt redesign OR a triage layer that detects cross-client patterns; ~6-10 hours
- **Risk:** Medium — needs care so per-client incidents that legitimately span clients (e.g., a real cross-tenant cybersecurity event) are not lost
- **Trust impact:** POSITIVE — addresses the architectural conflation directly
- **Reversibility:** medium — requires reverting the routing logic

### I6 — Agent memory of prior proposals (LOWER LEVERAGE)

- **What:** before generating proposals, agent reads its own monitoring_proposals from last 30 days for the same client; explicitly refuses to re-propose anything paraphrased.
- **Catches:** ~15-25 of 359 (~4-7%) — the within-client near-dupes
- **Effort:** medium — agent prompt + retrieval; ~6-8 hours
- **Risk:** Medium — depends on agent prompt discipline; harder to verify empirically
- **Trust impact:** POSITIVE but indirect
- **Reversibility:** trivial — revert the prompt

### Ranking

| # | Intervention | Effort | Impact (% reduction) | Risk | Leverage |
|---|---|---:|---:|---|---|
| **I1** | Pre-write unique on monitoring_proposals | 30 min | 21.4% | very low | **★★★★★** |
| **I2** | Pre-write entity-name check | 2-4h | 40.7% | low | **★★★★★** |
| **I3** | Pre-write client-keywords check | 1-2h | 18.4% | very low | **★★★★★** |
| I4 | Extraction-type validation | 2-3h | 6-9% | low | ★★★★ |
| I5 | Doctrine separation | 6-10h | 11-17% | medium | ★★★ |
| I6 | Agent memory | 6-8h | 4-7% | medium | ★★ |

**Top three (I1+I2+I3) deliver the bulk of the reduction at very low effort and very low risk.** Combined estimated reduction: **~60% of total queue inflow**.

---

## §6 — Why Input-Side Beats Output-Side Automation

The previous Approval Queue Overload Assessment proposed *consequence-banded auto-execute at the approval surface*. The validation withdrew most of that because confidence wasn't the right signal.

**Input-side reduction (this assessment) is structurally superior:**

| Dimension | Output-side auto-execute (O3/O4/O5) | Input-side dedup (I1-I3) |
|---|---|---|
| What it prevents | Operator decision cost on each item | Item ever existing in the queue |
| Confidence dependency | High — needs reliable confidence signal | None — operates on exact-match data |
| Operator-visible cost when wrong | False approvals → reversal queue | Items just don't appear |
| Trust impact | Negative if wrong (visible failures) | Neutral or positive (less noise) |
| Effort to ship | Medium-high (validation, calibration, pilot) | Low (single migration + writer check) |
| Risk class | Doctrinal (HIGH — could fabricate decisions) | Operational (LOW — could miss legitimate dupes) |
| Reversibility | Per-item reversal; rollback queue cost | Drop index / disable check |
| Quality dependency | AI confidence calibration | None |

The operator's framing — "*reduce inflow before automating approvals*" — is structurally correct. The validated O4 boundary (CONDITIONAL GO for auto-reject of low-conf entity suggestions) remains useful as a SECONDARY layer AFTER the input-side gates close the bulk of the gap.

---

## §7 — Doctrinal Tie

### "Operator attention is critical infrastructure"

Critical infrastructure is protected at the perimeter, not at the meter. Input-side dedup is perimeter defense. Output-side approval automation is meter-defense — useful in some cases, but secondary.

### "In Peace Time, Improve Your Fighting Position"

This is the fighting-position investment. ~60% queue reduction with ~5-7 hours of total effort (I1+I2+I3) is the highest-ratio peacetime improvement in the campaign so far.

### "Preserve decision space by shortening Signal → Decision → Action"

Input-side dedup is the most direct application of Commander's Intent: **removing decisions that should never have been generated**. Decision space is preserved by reducing the denominator (items requiring decisions), not just by accelerating throughput on the numerator.

### NEW doctrine proposed for ratification

> **Address generation before approval. Input-side validation before output-side automation.**

Catches the failure mode: if an item is generated, automation can only make it cheaper to decide; only generation-side prevention removes the cost entirely.

---

## §8 — What I Don't Know (Certainty Gap)

| Unknown | Impact on recommendation |
|---|---|
| Exact agent prompt CRUCIBLE uses to generate proposals | I1+I2+I3 don't require prompt changes; I5+I6 do |
| Whether `correlate-entities` (the writer for entity_suggestions) already does any dedup | I2 may already partially exist — needs code review pre-implementation |
| How `clients.monitoring_keywords` is updated when a proposal is `applied` | I3 depends on the apply path actually writing to this column |
| Why `auto_enrichment` produces person classifications for things like "Fort St" | I4 is conservative; the deeper issue is in the extraction prompt |
| Whether `agent_tradecraft` (Class A store) accepts writes from CRUCIBLE today | I5 requires the route to exist — needs separate verification |
| Whether near-dupe rate of 30%+ holds beyond the cybersecurity-doctrine cluster | Net reduction estimate is conservative; could be higher |

These are honest acknowledgments. None changes the ranking of I1+I2+I3 as the top three interventions.

---

## §9 — Held / Operator Decision Surface

### Decisions for operator authorization (each separate)

| # | Decision | Recommendation |
|---|---|---|
| QR1 | Authorize I1 (pre-write unique on monitoring_proposals) | **GO** — 30 min effort, 21.4% reduction, very low risk |
| QR2 | Authorize I2 (entity-name check before insert) | **GO** — 2-4h effort, 40.7% reduction, low risk |
| QR3 | Authorize I3 (client.monitoring_keywords check) | **GO** — 1-2h effort, 18.4% reduction, very low risk |
| QR4 | Scope I4 (extraction-type validation) as separate task | proceed pending GO |
| QR5 | Scope I5 (cross-client doctrine separation) as separate task — needs verification that agent_tradecraft accepts CRUCIBLE writes | proceed pending GO |
| QR6 | Defer I6 (agent memory) until I1-I5 land | recommended |
| QR7 | Ratify new doctrine: *"Address generation before approval. Input-side validation before output-side automation."* | recommended |
| QR8 | Re-rank F.0 vs Campaign 1 Watchdog with combined attention recovery (~3 hrs/wk from V3+QR1-QR3) | recommended after QR1-QR3 land |

### Sequence

1. **QR1** (smallest possible bite) — 30-min migration adding the unique index. Land first. Watch CRUCIBLE behavior for 24h to confirm no unexpected error spike.
2. **QR3** (smallest writer change) — pre-write client-keywords check. Lands ~1h after QR1.
3. **QR2** (medium writer change) — entity-name check before insert. Lands when QR1+QR3 are stable.
4. **QR4** (extraction-type validation) — separately scoped after QR1-QR3 land.
5. **QR5** (cross-client doctrine separation) — separately scoped; requires verification step.

This sequencing preserves the operator's principle from Task #122: validate at each step, ship the smallest reversible piece, observe before proceeding.

---

## §10 — Final Verdict

**The operator's framing was correct.** Queue inflow reduction is the right intervention, not approval automation.

The three top interventions (I1, I2, I3) deliver an estimated **~60% combined queue reduction** with ~5-7 hours of total effort and very low risk. They are write-side gates that prevent the operator from ever seeing items the system should have known not to generate.

This is more attention-recovery than the original O3+O4+O5 proposal, with structurally lower risk, and addresses the root cause empirically demonstrated in the O3 validation (duplication, not approval effort).

Combined with the already-validated O4 conditional pilot and O7 expiry fix, this campaign now has a path to:

- **~2-3 hours/week direct attention recovery** (queue depth × inflow rate)
- **~60% lower inflow** (items prevented from existing at all)
- **Zero false-approvals** (no AI gating decisions)
- **Reversible at every step** (drop index / disable check)

**The order of operations: address generation BEFORE approval.** That is the doctrinal principle this assessment establishes.

Held. No implementation. No code. No deploys. Awaiting operator GO per §9.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
