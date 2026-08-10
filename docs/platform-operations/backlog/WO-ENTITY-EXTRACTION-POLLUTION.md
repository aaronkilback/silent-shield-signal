# WO-ENTITY-EXTRACTION-POLLUTION — auto-extracted entities are an over-attribution vector, not a data-quality chore (SCOPE, do not build)

**Operator ruling 2026-08-10:** "An entity list containing Trump, David Eby, 'firefighters' and 'Canadians' is not an entity list." Treat this as the **fifth instance of the cheap-proxy anti-pattern** ([[feedback_cheap_proxy_for_expensive_correct_signal]]): *extracted proper-nouns-from-signal-text substituted for the client's actual known people.*

## Measured audit (prod `kpuqukppbmwebiptqmog`, 2026-08-10)

| Client | person entities | human-created (`created_by` non-null) | auto (`created_by` NULL) | `active_monitoring_enabled=true` |
|---|---|---|---|---|
| **Petronas Canada** | **1,201** | 12 | **1,189 (99%)** | **0** |
| Kilbacks | 6 | (small) | most | — |
| BC Place | 8 | (small) | most | — |

- **99% of PECL's person entities are service-role auto-created** (`created_by IS NULL`), almost all `entity_status='suggested'`.
- **The names prove they are scraped proper nouns, not PECL people:** `Patrick Mahomes`, `Josh Allen`, `Nathan Lukes`, `Travis Lulay` (NFL/CFL quarterbacks), `Judge`, `fraudster`, `Reid`, plus the political/generic set found during slice 6 (`Trump`, `David Eby`, `Danielle Smith`, `Mark Carney`, `firefighters`, `Wildfire Service`, `Canadians`, `customers`, `Albertans`). A handful are real (`Peter Zebedee` = LNG Canada CEO).
- **Genuine PECL persons: ~a dozen.** The other ~1,190 are noise.

## Where they came from
`process-intelligence-document` extracts person/org names from every document's text and **inserts them as `suggested` entities** (service-role → `created_by=NULL`). Because the *signals themselves* were over-attributed to PECL (the 635 no-anchor set, the tier-2 broad-geo class), their proper nouns became PECL "entities." **Fabricated attribution generated fabricated entities.**

## Is it a live feedback loop? YES — but the SOFT form, not the hard one

- **Generation half (confirmed):** wrongly-attributed signal → LLM extracts its proper nouns → new `suggested` PECL entity.
- **Feedback half (soft / prompt-level):** those entities are injected as `entityContext` into the extraction prompt for future documents (`process-intelligence-document/index.ts:317-319`, filtered only to `entity_status != 'rejected'` — so `suggested` junk **is** included). A polluted list biases the model's entity-linking toward PECL.
- **The HARD loop is NOT present (verified):**
  - the client-attribution matcher `matchClientKeywords` keys **only** on `name / monitoring_keywords / competitor_names / high_value_assets / locations` — **NOT entity names** (`index.ts:383-457`). A fabricated entity does not born-create a signal by name-match.
  - `active_monitoring_enabled=0` for all 1,201 → they never enter the news/social monitor queue.
  - The PRIORITY-1 entity path (`index.ts:481-511`) uses a document's `metadata.entity_id` FK from an entity *scan*, not a text name-match against the 1,189.
- **Corollary:** the slice-6 "reject 635→485" was an artifact of anchoring on entity names — which the **live path never does.** Live keyword reject holds at ~632.

## Fix shape (scope, do not build)
1. **Gate the extraction→context loop.** Do not feed `suggested` (unreviewed, auto) entities back into the extraction prompt as known client entities — restrict `entityContext` to `entity_status='confirmed'` (human- or rule-promoted). Breaks the soft loop at the feedback edge.
2. **Do not auto-attribute an extracted entity to a client from an over-attributed signal.** An entity extracted from a signal should inherit the signal's attribution *basis* — if the signal is `sector`/`none` ([[project_source_provenance_model]] attribution_type), the entity is not a client `direct` person. Extraction must consume the attribution edge, not assume `direct`.
3. **Cleanup pass (append-only, not bulk-delete — [[feedback_cleanup_method_rulings]]):** classify the 1,189 by a person-name/role heuristic + known-noise list (political figures, sports figures, generic nouns like "firefighters"/"customers", non-persons like "Wildfire Service"). Demote to `entity_status='rejected'` (reversible, audited) rather than delete. NO bulk deletion.
4. **Provenance on entities:** record extraction source (`source_signal_id` / basis) so a future audit can trace which signals generated which entities — the entity twin of the signal attribution ledger.
5. **Same audit for Kilbacks + BC Place** before any entity-as-anchor use — both show the auto-extraction pattern at small scale.

## THE GATE IS BYPASSED — verified against code + data (operator challenge 2026-08-10)

The claim "client entities require operator approval before they become active" is **FALSE.** There are TWO paths to an `entities` row; the dominant one has no gate.

**Path A — reviewed (real, audited, ~dormant):** `entity_suggestions` → `EntitySuggestionsPanel.approveMutation` → INSERT into `entities` with `visibility_class='reviewed'`, and stamps `entity_suggestions.reviewed_by` + `reviewed_at`. This gate is REAL and WAS used — but barely: **55 approvals ever, by 3 reviewers, 2026-04-05 → 2026-06-15, then dormant** (~2 months silent). The queue holds **5,831 PENDING** suggestions never reviewed.

**Path B — bypass (dominant, ungated):** `process-intelligence-document/index.ts:1001` INSERTs **directly into `entities`** — `is_active:true` at birth (line 1008), `entity_status:'suggested'`, and **auto-promotes to `'confirmed'` on any second fuzzy-name mention** (line 992, `ilike %name%` containment — so "Reid"→"Reid Hoffman"). No reviewer, no timestamp, no `entity_suggestions` row. Same direct-write in `process-stored-document` + `process-security-report`.

**The data proves B dominates:**
| Measure | Value |
|---|---|
| PECL entities by `visibility_class` | **`extracted` (bypass): 4,720 · `curated`: 25** — 99.5% never reviewed |
| PECL auto (`created_by=NULL`) that are `is_active=true` | **3,879** (active at birth) |
| PECL auto `entity_status='confirmed'` with NO human creator | **1,376** (auto-confirmed on second-mention) |
| `entity_suggestions` ever approved via UI | 55 (3 reviewers, Apr 5–Jun 15 2026, then dormant) |
| PECL share of ALL 4,828 entities in the system | **~98%** (the table is essentially PECL extraction exhaust) |

**Answer to "enforced-and-unused, or bypassed?" → BYPASSED.** The review queue is real but governs a *parallel* stream (`entity_suggestions`, 5,831 pending); the extraction writer skips it and creates **active, auto-confirmed** entities directly in `entities`. There is **no `approved_by`/`approved_at` column on `entities`** — the "gate" persists no decision ([[feedback_no_unauditable_gates]] violation). And `'confirmed'` gates nothing downstream (no consumer filters on `entity_status='confirmed'`) — so the live harm is not the status, it is that **any non-rejected `entities` row (incl. `suggested`) feeds `entityContext` into 3 extraction prompts.** Pollution is NOT inert.

**This changes the fix (as the operator predicted the two cases would):** not "work the backlog" (that is the separate `entity_suggestions` stream). The fix is **route extraction THROUGH the existing queue** — `process-intelligence-document` / `process-stored-document` / `process-security-report` propose to `entity_suggestions` instead of direct-inserting into `entities`; `entityContext` reads **`visibility_class='reviewed'` / operator-curated only**. The mechanism already exists (Path A) — extraction simply doesn't use it. This is exactly the operator's lean: entity lists operator-curated only, extraction proposes to a review queue rather than writing directly.

## Priority
Higher than a hygiene chore: entities are injected into the extraction prompt (soft loop is live) and are the intended anchor for future proximity/social layers ([[WO-SOCIAL-PROXIMITY-LAYER]] fire-name tracking, [[WO-PRINCIPAL-LOCATION-TRACKING]]). A polluted entity list cannot be trusted as an anchor until cleaned + the loop gated. **Blocks entity-as-anchor adoption.**

**SCOPE only. Do not build.** Recorded 2026-08-10.
