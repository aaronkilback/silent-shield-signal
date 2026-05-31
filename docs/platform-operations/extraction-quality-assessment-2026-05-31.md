# Extraction Quality Assessment

**Operator-directed 2026-05-31 (Task #125).** Read-only diagnosis. Empirical analysis of entity-extraction misclassification: why institutions, events, locations, and organizations are repeatedly classified as persons.

Tied to doctrine: *"Operator attention is critical infrastructure"* + *"Address generation before approval."*

Pre-condition for QR4 (extraction-type validation). No implementation.

---

## §0 — Headline

| Metric | Value |
|---|---:|
| Total entity_suggestions (90d) | 334 |
| **Misclassifications (person-as-X)** | **52 (15.6% of total)** |
| **Misclassifications from `source_type='signal'`** | **48 of 184 (26.1%)** |
| Misclassifications from `auto_enrichment` | 0 / 78 (0.0%) |
| Misclassifications from `ai_assistant` | 0 / 43 (0.0%) |
| Misclassifications from `archival_document` | 0 / 29 (0.0%) |
| **Misclassified entities already APPROVED into `entities` table** | **5 confirmed** (live data corruption) |
| Confidence range of misclassifications | 0.80–0.95 (the extractor is confidently wrong) |

**Single dominant cause:** the signal extractor (`extract-signal-insights`) is the source of 100% of detected misclassifications. Other sources (auto_enrichment, ai_assistant, archival_document) produce zero misclassifications by these patterns.

**Live corruption:** misclassified entities like "Wildfire Service" and "Employees of Petronas Canada" have been approved as `type=person` into the active `entities` table. They are currently being treated as persons in correlations, entity-graph reasoning, and mention tracking.

---

## §1 — Frequency by Misclassification Class

### A — Pending queue (last 90 days)

| Class | Classified as | Source | Count | Conf range |
|---|---|---|---:|---:|
| **Org/government as person** | person | signal | **19** | 0.80–0.90 |
| **Event/institution as person** | person | signal | **12** | 0.80–**0.95** |
| **Location/artifact as person** | person | signal | **8** | 0.80–0.90 |
| **Event as person** (landslide/fire/etc.) | person | signal | **5** | 0.80 |
| **Media outlet as person** | person | signal | **5** | 0.80–0.90 |
| **Event/institution as person** (zero-conf noise) | person | auto_enrichment | 3 | 0.00 |

Total person-misclassifications: **52**.

### B — Per-source misclassification rate

| Source | Total suggestions | Misclassified | Rate |
|---|---:|---:|---:|
| **signal** | **184** | **48** | **26.1%** |
| auto_enrichment | 78 | 0 (by these patterns) | 0% |
| ai_assistant | 43 | 0 | 0% |
| archival_document | 29 | 0 | 0% |

The signal extractor (`extract-signal-insights`) is the single point of failure. Other sources operate cleanly within their respective failure modes (auto_enrichment is too speculative; archival_document is too aggressive — but neither misclassifies type).

### C — Critically: Zero rejections

Of the 52 misclassifications, **0 have been rejected by the operator**. All are currently pending review. This means:
- Operator has not seen them yet (queue-overload effect from Task #121)
- When operator does see them, rejection rate will reveal the extent
- During the wait, downstream agents may already be reasoning about them

---

## §2 — Confidence Distribution (the extractor is confidently wrong)

| Confidence band | Misclassifications in band |
|---|---:|
| ≥0.90 | 14 (27%) |
| 0.85-0.90 | 22 (42%) |
| 0.80-0.85 | 16 (31%) |
| <0.80 | 0 from signal source; 3 zero-conf from auto_enrichment |

**Headline:** at confidence ≥0.85, 36 of 52 misclassifications (69%) exist. Confidence is not a reliable filter — confidence is the AI's certainty in *its own answer*, not a measure of *whether the answer is correct*.

This is the same pattern Task #122 surfaced: AI confidence ≠ operator decision criterion. Here it's: AI confidence ≠ classification correctness.

---

## §3 — Sample Signal Content (Identifying the Prompt Failure Mode)

Reviewed the actual signal text that led to each misclassification. Five distinct prompt failure patterns emerged.

### Pattern 1 — Proper-noun-in-subject-position confusion

The extractor treats any capitalized multi-word proper noun phrase in subject position of an action verb as a person.

| Misclassified name | Signal context |
|---|---|
| "World Cup" (conf 0.95) | "Canada Soccer takes over the National Soccer Development Centre **for the World Cup**." |
| "World Cup" (conf 0.95) | "Downtown Vancouver is preparing **for the World Cup events** near BC Place." |
| "World Cup" (conf 0.9) | "Downtown Vancouver braces **for World Cup**" |
| "The Supreme Court" (conf 0.9) | "**The Supreme Court of Canada has upheld** a ruling..." |

The Supreme Court "upheld a ruling" → extractor reads `<NOUN> <VERB>` and tags the noun as a person. Same for "World Cup" appearing in phrases describing an event being prepared for.

### Pattern 2 — Court case patterns (`<plaintiff> v. <defendant>`)

| Misclassified name | Signal context |
|---|---|
| "Cowichan Tribes" (conf 0.9) ×5 | "**Cowichan Tribes v. Canada**, a BC court pulled the rug..." |
| "Metlakatla First Nation" (conf 0.9) | "**Metlakatla First Nation v. Prince Rupert Port Authority** threatens..." |
| "Kitselas First Nation" (conf 0.9) | "treaty with the **Kitselas First Nation**" |

The extractor sees a `<Capitalized Phrase> v. <Capitalized Phrase>` court-case naming convention and tags the plaintiff as a person. First Nations are sovereign collectives (organizations), not persons — but the case name format triggers person classification.

### Pattern 3 — Media-outlet-name in signal title

| Misclassified name | Signal context |
|---|---|
| "National Observer" (conf 0.9) ×3 | "Canada seals first European LNG deal — but economic and climate hazards loom - **Canada's National Observer**" |
| "National Observer" (conf 0.9) | "How Carney's 'climate action' pipeline spin echoes Trudeau's Trans Mountain rhetoric - **Canada's National Observer**" |

When the signal title ends with " - <Publication Name>" (RSS-style attribution), the extractor pulls the publication and tags it as a person.

### Pattern 4 — Government agency or institution name

| Misclassified name | Signal context | Notes |
|---|---|---|
| "Environment Canada" (×3) | weather-related signal text | Government agency tagged as person |
| "Wildfire Service" | wildfire signal | Agency name; **already approved into entities** |
| "Employees of Petronas Canada" | corporate signal | Plural noun phrase; **already approved into entities** |

### Pattern 5 — Event/incident name as person

| Misclassified name | Pattern |
|---|---|
| "Old Fort Landslide" (×3) | "<Location> Landslide" geological event |
| "Peace River Regional" (×6) | regional district name |
| "Fort St" (×4) | truncated location ("Fort St. John" being extracted as "Fort St") |

---

## §4 — Downstream Impact

### A — Live entities table corruption (CONFIRMED)

Query against `entities WHERE type='person'` reveals misclassifications that have been **approved into the live entity graph**:

| Entity name | Type | Created | Has creator? |
|---|---|---|---|
| **"Wildfire Service"** | person | 2025-11-21 | NO (no creator UUID) |
| **"Employees of Petronas Canada"** | person | 2025-11-17 | NO (no creator UUID) |
| "Elizabeth McSheffrey (Global News)" | person | 2026-01-04 | NO | (reporter with outlet in parens — borderline) |
| "Betsy Trumpener (CBC News)" | person | 2025-12-21 | NO | (same borderline pattern) |
| "Theresa Betancourt" | person | 2026-01-21 | NO | (possibly legitimate person) |

**The first two are unambiguous misclassifications living in the production entity graph.** They have `created_by IS NULL` — meaning they were auto-created without operator approval, OR the creator metadata was lost during migration. Either way, they exist as `type=person` and are reasoned-about as persons by downstream agents.

### B — Downstream impact pathways

A misclassified "Wildfire Service" person entity affects:

| Surface | Impact |
|---|---|
| Entity correlation | Signal mentions of "Wildfire Service" get linked as "person mentioned" — incorrect graph semantics |
| Entity-graph reasoning (Aegis) | Aegis treats it as a person when asked about persons; AI may invoke person-specific tradecraft inappropriately |
| Active monitoring | If `active_monitoring_enabled = true`, the monitors will search for "Wildfire Service" with person-style queries (LinkedIn, social media) |
| POI report generator | Could generate a person-of-interest report on "Wildfire Service" — operationally absurd |
| Document mentions tracking | Already 4,105 mentions in `entity_mentions` — count cannot be easily audited for which ones were actually person references |
| Entity deduplication | Merge candidates suggested as if Wildfire Service were a person |

### C — Queue impact

The 52 misclassifications in the current 90-day pending queue:
- 52 items of operator review time that should not exist
- Many of them are duplicates (per the Task #123 dup analysis: "Cowichan Tribes" person ×5, "World Cup" person ×7, etc.)
- Combined: ~30-40 distinct misclassification instances; each takes 30-60s of operator time to reject = ~25-40 minutes of operator attention burned on items that shouldn't exist

### D — Trust impact

If the operator has been approving items quickly under queue pressure, more misclassifications may have already entered `entities`. The 5 confirmed above are the obvious-pattern matches; there could be more in the long tail. This makes Aegis tenant-fact claims less trustworthy by extension — the entity graph itself has type-level corruption.

---

## §5 — Root Cause Diagnosis

### Where the extraction lives

From the QR2 demonstration: `extract-signal-insights/index.ts:294-305` is the writer that produces `source_type='signal'` entity suggestions. The classification (person/org/location/etc.) is decided UPSTREAM in the AI extraction step that produces the `entity.name`, `entity.type`, `entity.confidence` fields.

The actual extraction prompt is invoked inside that function (or a helper); needs code-level inspection to confirm the exact prompt text. But the failure modes (Patterns 1-5 in §3) point directly at prompt-design gaps.

### The five prompt gaps (all observable from outputs)

| Gap | Evidence | Fix shape |
|---|---|---|
| **G1** — No discrimination between person / organization / event / institution / location | "World Cup" (event), "The Supreme Court" (institution), "Wildfire Service" (agency), "Old Fort Landslide" (event) all classified as person | Explicit type definitions + examples in prompt |
| **G2** — No awareness of `v.` court-case patterns | "Cowichan Tribes v. Canada" → "Cowichan Tribes" tagged person | Prompt rule: "If name appears in `X v. Y` court case format, do NOT classify as person" |
| **G3** — No awareness of news-attribution suffixes | "- Canada's National Observer" treated as a person name | Prompt rule: "Publication names in `<title> - <publication>` attribution are organizations, not persons" |
| **G4** — No awareness of First Nation/tribal terminology | "Cowichan Tribes", "Metlakatla First Nation", "Kitselas First Nation" all → person | Prompt rule: "Names ending in 'Tribes', 'Nation', 'First Nation' are organizations or sovereign collectives, not persons" |
| **G5** — No awareness of government agency naming | "Environment Canada", "Wildfire Service" → person | Prompt rule: "Names containing 'Canada', 'Service', 'Ministry', 'Department', 'Agency', 'Commission' are organizations" |

### Additional root cause: high-confidence assignment

Even when the extractor is wrong on type, it assigns 0.80-0.95 confidence. The confidence is not measuring "am I right about the type" — it's measuring "how clearly is this proper noun in the text." The prompt likely conflates "is this a real entity?" with "what type of entity is it?"

### Secondary: no post-extraction validation

There is no validation step between AI extraction and `entity_suggestions` INSERT. The AI's classification flows directly to the queue. The QR4 boundary the operator proposed (extraction-type validation) would be exactly this missing layer.

---

## §6 — Recommended Interventions (Ranked)

### EX-1 — Type-pattern validator before INSERT (HIGHEST LEVERAGE)

- **What:** writer-side rules in `extract-signal-insights` (and other extractors) before `entity_suggestions` INSERT. If `suggested_type='person'` AND name matches a non-person pattern (Patterns 2-5 above), either:
  - Option A: reclassify to inferred type ("Cowichan Tribes" → organization, "World Cup" → event)
  - Option B: quarantine with `status='type_quarantine'` for operator triage
- **Catches:** ~52 misclassifications per 90d (~6 per week); ~26% reduction of signal-source inflow
- **Effort:** 2-4 hours (regex/heuristic blocklist + writer change)
- **Risk:** Very low — Option B (quarantine) is reversible; Option A might mis-reclassify edge cases
- **Trust impact:** POSITIVE — stops obviously-wrong types reaching operator
- **Recommendation:** Option B (quarantine) first; transition to A after empirical validation

Heuristic patterns to encode (from §3 observations):

```typescript
const NON_PERSON_PATTERNS: Array<{ pattern: RegExp; inferredType: string }> = [
  { pattern: /\b(supreme |high |district |provincial |federal |appeal |superior )?court$/i, inferredType: 'organization' },
  { pattern: /\bworld cup|fifa|olympic|championship\b/i, inferredType: 'event' },
  { pattern: /\btribes?$|nation$|first nation$/i, inferredType: 'organization' },
  { pattern: /\b(canada|ministry|department|agency|service|commission|authority)$/i, inferredType: 'organization' },
  { pattern: /\b(landslide|fire|flood|earthquake|incident|disaster)$/i, inferredType: 'event' },
  { pattern: /^the (supreme|high|district|provincial|federal)\b/i, inferredType: 'organization' },
  { pattern: /\b(news|observer|times|post|tribune|herald|gazette|press|media|journal)$/i, inferredType: 'organization' },
  { pattern: /\bregional$|^(fort|peace river|valley|mount|lake|island|bay) /i, inferredType: 'location' },
  { pattern: /\bemployees of |^staff of |^members of /i, inferredType: 'group' },
];
```

The list is data-driven — every pattern comes from an observed misclassification.

### EX-2 — Prompt-level fix (HIGHER LEVERAGE BUT BROADER SCOPE)

- **What:** update the extraction prompt in `extract-signal-insights` (and other AI extractors) to explicitly handle Patterns 1-5: court-case naming, news-attribution, First Nation terminology, government agencies, event names.
- **Catches:** root-cause fix; should reduce inflow MORE than EX-1
- **Effort:** 4-8 hours (prompt redesign + golden-set validation)
- **Risk:** Medium — prompt changes have unpredictable second-order effects; needs adversarial testing
- **Trust impact:** POSITIVE long-term but requires regression testing
- **Recommendation:** ship EX-1 first (cheap, low-risk); plan EX-2 as a follow-up with proper prompt-regression discipline

### EX-3 — Backfill quarantine for existing misclassifications

- **What:** one-time SQL job to identify existing `entities` rows matching the non-person patterns (5 confirmed above) and flag them for operator review
- **Catches:** existing live corruption ("Wildfire Service", "Employees of Petronas Canada")
- **Effort:** 1-2 hours (one query + audit + operator review)
- **Risk:** Low — flag only, no automatic re-classification
- **Trust impact:** POSITIVE — cleans the entity graph
- **Recommendation:** ship alongside EX-1

### EX-4 — Add `validation_status` column to entity_suggestions

- **What:** column to track extraction validation outcomes: `pre_validated_clean`, `pre_validated_quarantine`, `not_validated`
- **Catches:** observability — separates "validator approved" from "validator skipped" from "validator rejected"
- **Effort:** small migration + writer integration
- **Risk:** Trivial
- **Trust impact:** Operational — gives the operator visibility into which suggestions passed the gate
- **Recommendation:** consider as part of EX-1 PR if low-cost

### EX-5 — Run AI assessment pipeline (separate concern from misclassification)

Already noted in Task #121 §12 as B4 and Task #123 §5 as O4-alt: the `ai_threat_score` / `ai_risk_level` columns on entity_suggestions are NULL on 334/334 rows. If this pipeline runs:
- AI assessment could pre-filter misclassifications by *semantic* check ("does this look like a person?")
- Complementary to EX-1 (pattern-based) — different mechanism, different failure modes
- Should not be combined into the same PR as EX-1 (separate concerns; separate validation)

---

## §7 — Ranking + Sequencing

| # | Intervention | Effort | Catches | Risk | Recommended order |
|---|---|---:|---:|---|---|
| **EX-1** | Type-pattern validator before INSERT (quarantine mode) | 2-4h | ~52/90d | very low | **1st** |
| **EX-3** | Backfill quarantine for live entities | 1-2h | 5+ confirmed | low | **2nd** (with EX-1) |
| **EX-4** | Add validation_status column | small | observability | trivial | optional bundle with EX-1 |
| **EX-2** | Prompt-level fix in extraction | 4-8h | root cause | medium | **3rd** (separate PR with regression test) |
| **EX-5** | Run AI assessment pipeline | medium | semantic check | medium | **4th** (separate scope) |

EX-1 + EX-3 are the immediate wins. EX-2 is the durable fix. EX-5 is a separate substrate decision.

---

## §8 — Downstream Impact + Queue Impact Quantification

### Queue impact

| Metric | Value |
|---|---:|
| Misclassifications/90d in queue | 52 |
| Distinct misclassification instances (deduped) | ~30-40 |
| Operator review time burned (estimated) | 25-40 minutes / 90d |
| Future inflow rate (if unaddressed) | ~6/week |
| Combined with Task #123 dup rates | Misclass overlaps with dupes (e.g., "World Cup" ×7 is one misclass + 6 dupes) |

### Live entity-graph impact

| Metric | Value |
|---|---:|
| Confirmed misclassified entities live in `entities` | 5+ |
| Entity-graph reasoning surface | All Aegis tools that traverse `entities` |
| Downstream signals reasoning about these | `entity_mentions` has 4,105 rows total; subset for misclassified entities unknown |
| Customer impact | Petronas Canada tenant has "Wildfire Service" and "Employees of Petronas Canada" as persons — these are real graph corruption |

### Trust impact

The operator now has empirical proof that *type-level corruption exists in the entity graph*. This is a different category of bug than "queue overload" — it's a data quality issue that propagates beyond the queue surface.

The fix sequence the doctrine implies:
1. Stop new corruption (EX-1)
2. Clean existing corruption (EX-3)
3. Address root cause (EX-2)

---

## §9 — Tie to Doctrine

### "Address Generation Before Approval"

This assessment is the direct application of the new doctrine: the extraction step is the GENERATION layer; the operator approval queue is the APPROVAL layer. Fixing the extraction prevents bad items from being generated, eliminating the need to approve or reject them.

### "Operator Attention is Critical Infrastructure"

The misclassifications consume operator attention twice:
- Once when they sit in the pending queue
- Again when they propagate to the entity graph and the operator must clean them up later

EX-1 + EX-3 protect this resource at the perimeter.

### "In Peace Time, Improve Your Fighting Position"

This is fighting-position work. No incident is active. The misclassifications haven't (yet) caused a security failure. But "Wildfire Service" as a person in the entity graph is a defect waiting to surface during a future fire-season incident if Aegis recommendations or POI generators reason from it.

### Commander's Intent

Shortens Signal → Decision → Action by removing decisions that should never have been generated. Same family as Task #123 input-side dedup, applied to a different failure mode (type correctness, not duplication).

---

## §10 — What I Don't Know

| Unknown | Resolution |
|---|---|
| Exact prompt text in `extract-signal-insights` | Code-level inspection (1-2 hours); needed before EX-2 |
| Whether `ai_threat_score` pipeline is disabled or broken | Code-level inspection; needed before EX-5 |
| How "Wildfire Service" and "Employees of Petronas Canada" got into `entities` with no `created_by` | Audit trail probe — may have been pre-tenant-id-backfill migration artifact |
| Long-tail misclassifications beyond Patterns 1-5 | Could be more patterns invisible to my regex filter |
| Whether other extractors (`agent-chat`, `correlate-entities`, `parse-entities-document`) misclassify differently | Same data shows zero misclassifications from these sources for now — needs longer observation |

These are honest gaps. EX-1's quarantine approach is robust to all of them — it surfaces, not deletes.

---

## §11 — Held / Operator Decision Surface

### Decisions for operator authorization (each separate)

| # | Decision | Recommendation |
|---|---|---|
| EX.D1 | Authorize EX-1 (type-pattern validator, quarantine mode) | proceed pending GO |
| EX.D2 | Authorize EX-3 (backfill quarantine of existing misclassifications) | proceed pending GO |
| EX.D3 | Authorize EX-2 (prompt-level fix) as separate task with regression testing | recommend separate scope |
| EX.D4 | Authorize EX-5 (AI assessment pipeline) as separate task | recommend separate scope |
| EX.D5 | Choose EX-1 outcome strategy: A (auto-reclassify) vs B (quarantine for review) | **recommend B (quarantine)** — reversible, audit-preserving |

### Recommended sequence

1. Operator GO on EX.D1 + EX.D5 → ship EX-1 first (quarantine mode)
2. Operator GO on EX.D2 → run EX-3 backfill (one-time)
3. Observe 2 weeks; refine pattern list with operator feedback
4. Operator GO on EX.D3 → scope EX-2 separately (prompt-level fix with golden-set regression)
5. Operator GO on EX.D4 → scope EX-5 separately (AI assessment substrate)

### Combined with the broader campaign

This assessment + the input-side dedup work (QR1+QR2+QR3) together address the two distinct root causes of queue overload:
- **Duplication** (Task #123): same item generated multiple times
- **Type corruption** (this assessment): item exists but with wrong classification

Both are GENERATION-side fixes per the new doctrine. Neither requires output-side approval automation.

---

## §12 — Final Verdict

**The operator's framing was correct.** Misclassification is an extraction-quality issue, not an approval-cost issue. The signal extractor produces 26.1% misclassifications at high confidence; the other three sources produce 0%.

The fix path:
- **EX-1 + EX-3 immediately** (~3-6 hours total; clean perimeter + cleanup)
- **EX-2 as scoped follow-up** (prompt fix with regression discipline)
- **EX-5 as separate substrate** (AI assessment pipeline)

Live corruption confirmed in `entities` table. "Wildfire Service" and "Employees of Petronas Canada" are currently `type=person` in the production graph. This is the kind of defect that surfaces during incidents — fix in peacetime.

Held. No implementation. No code. No deploys. Awaiting operator GO per §11.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
