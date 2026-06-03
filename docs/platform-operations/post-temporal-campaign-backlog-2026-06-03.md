# Post-Temporal Campaign — Prioritized Backlog & Decision Package

**Status:** PLANNING ONLY. Begins **only after** Temporal Integrity is formally closed
(C2 → B3 → C3 → C4 → Trust Validation PASS). No code, no implementation, no solution design here.

**Evidence discipline (Capability Integrity Doctrine):** each item is tagged
- **[CAMPAIGN]** — directly observed/verified during the Temporal Integrity campaign, or
- **[PRIOR]** — documented in earlier assessments (memory), **not re-verified** this campaign → the next
  campaign must re-confirm before acting.

Nothing below is a commitment; it is a ranked menu for the go/no-go on the next campaign.

---

## 1. RETRIEVAL QUALITY

| Item | Impact | Evidence | User-facing symptom | Priority |
|---|---|---|---|---|
| **F-TEMPORAL-3 — broken-column Aegis tools** | `search_signals` selects non-existent `source`; `get_related_signals` + `get_entity_summary_for_signal` select non-existent `correlated_entity_ids`. PostgREST 400 → swallowed → `{"result":[]}`. These tools return **empty in production today**, so their temporal tagging is inert. | **[CAMPAIGN]** Confirmed via `information_schema` on **both** prod & staging (only `source_id`/`auto_correlated_entities` exist); selects predate temporal work. | Operator/Aegis asks "find signals about X" or "related signals" → gets *nothing*, indistinguishable from "no data." Silent blind spot. | **P0** — cheap, high trust, unblocks entity-adjacent retrieval |
| **Silent-empty failure mode** | `const { data } = await query` ignores the error object; a failed/4xx query yields `null → []`. A broken tool is **indistinguishable from a genuinely empty result**. | **[CAMPAIGN]** Root of F-TEMPORAL-3's invisibility; only caught because sibling tools (entities/incidents) returned data while signals didn't. | Operators trust an empty answer as "nothing there" when the tool actually failed → false confidence. | **P0** — class fix; prevents the next silent regression |
| **Entity-context retrieval path duplication** | Two entity→signal paths exist: the **certified seam** `tenant-entity-graph.ts` (correct column `auto_correlated_entities`, tenant-scoped) and the **ad-hoc** `ai-tools-query` tools (broken columns, not the certified path). Divergence invites drift. | **[CAMPAIGN]** Observed while tracing the BC-Place entity-context path; certified seam was the real fix surface. | Inconsistent entity results depending on which tool Aegis picks. | **P1** — consolidate onto the certified seam |
| **Tool-path observability / health harness** | `scripts/test-aegis-tools.mjs` hardcodes the **prod** URL/key (ignores `SUPABASE_STAGING_URL`), and records every failure as the opaque literal `"error"`. It cannot validate staging and cannot attribute failures. | **[CAMPAIGN]** The 2026-06-03 "26/86" run was invalid as a staging gate (hit prod); 59/60 failures were undiagnosable from the artifact. | Validation gates produce misleading green/red; near-derailed this deployment. | **P0** — every future campaign depends on a trustworthy gate |

**Section read:** retrieval has **concrete, cheap, high-trust defects** that are currently *invisible* to
operators. This is the lowest-cost / highest-trust cluster in the whole backlog.

---

## 2. COLLECTION QUALITY

| Item | Evidence | Consequence | Expected user impact |
|---|---|---|---|
| **Signal freshness / event_date quality** | **[CAMPAIGN]** ~21% NULL `event_date`; ~28% cosmetic-midnight or copied-from-`created_at`; future-dated parser misfires; staging corpus was **100% timing-unknown** (all dates ungrounded). | A large share of signals cannot be classified **Current** even when genuinely recent — they fall to Timing-Unknown. | Operators see more "Timing Unknown" than ideal; "what changed this week" under-reports real current events. |
| **surface_date capture (publication time)** | **[CAMPAIGN]** Column added; population is **forward-only**; historical backfill from `raw_json` is net-~0; monitors do not yet reliably capture upstream pubDate (Google-News family: 285 NULLs, **0 recoverable** pubDate). | The strongest recency axis (became-news date) stays mostly empty until monitors capture it. | Recency leans on `event_date` alone; news items lack a true publication timestamp. |
| **Source attribution quality** | **[PRIOR]** ~36% of signals carry no source label (collection-reality baseline, not re-verified). | Provenance gaps weaken trust and the Grounding/Provenance doctrines. | Operators can't always see *where* a signal came from. |
| **Monitor effectiveness / dead streams** | **[PRIOR]** github / darkweb / csis / court monitors ~0 yield; social runs-but-stale; wildfire = best stream. | Advertised coverage exceeds real coverage; silent zero-yield. | "Dark web coverage" etc. implied but not delivered. |
| **Fort St. John coverage** | **[PRIOR + CAMPAIGN touch]** Petronas tenant (`feff5c44`) collects energy/activism/wildfire/cyber only — **zero crime keywords**; FSJ crime questions answered from a scoped corpus = a Mark-I **collection** gap, not reasoning. | NE-BC operational picture is partial; boundary not surfaced to the user. | Operator may over-trust an FSJ answer that the corpus can't support. |
| **Actor / POI coverage** | **[PRIOR]** 12 monitored POIs have 0–2 grounded signals each; Fitzgerald / Vashouk = 0; grounded ∩ actor-authored ∩ monitored = **empty**. | POI monitoring produces almost no actor-authored intelligence; Mark-II posting-time analytics not validatable. | "We're monitoring X" implies more than the data shows. |
| **Keyword quality** | **[PRIOR]** Historical capping/scoping issues in `monitor-news-google`; activist-native feeds added. | Coverage breadth depends on keyword cardinality + scoping correctness. | Relevant activity can be missed or buried in noise. |

**Section read:** collection is the **structural ceiling** — partly data-quality (fixable at the writer),
partly genuine coverage gaps (require new collection). This is where the biggest, most expensive bets live.

---

## 3. AEGIS INTELLIGENCE QUALITY — where is the next bottleneck?

Framed against the standing doctrine (Aegis ceiling = collection, not reasoning) and this campaign's findings:

| Dimension | Finding (this campaign + adjacent) | Bottleneck? |
|---|---|---|
| **Presentation** | The temporal masquerade (created_at-as-recency, NULL→Current) was a **presentation/retrieval-layer** defect — now repaired by this campaign. | **Largely addressed** (pending C3 confirmation) |
| **Retrieval** | **[CAMPAIGN]** Concrete defects: F-TEMPORAL-3 broken tools + silent-empty mode → Aegis **had data but retrieval failed/returned empty**. Cheap to fix, currently invisible. | **YES — secondary, cheap** |
| **Collection** | **[PRIOR]** Dead monitors, 0-footprint POIs, scoped corpora (FSJ), missing source labels → Aegis **lacked data**. The deeper, expensive ceiling. | **YES — primary, expensive** |
| **Reasoning** | No campaign evidence that reasoning is the limiter; Aegis correctly refused ungrounded/parametric claims (grounding doctrine), and classified correctly when given grounded data (helper proof). | **NO** |

**Coverage vs reasoning — the three observed modes:**
- **Aegis correctly refused** — **[PRIOR]** Grounding-State doctrine (INC-CTX-CONTAM): refuses ungrounded
  tenant-fact claims (e.g. parametric "BC Children's Hospital"). *Working as intended.*
- **Aegis lacked data** — **[PRIOR/CAMPAIGN]** FSJ crime question against a corpus with no crime keywords;
  POIs with ~0 footprint. *Collection gap.*
- **Aegis had data but retrieval failed** — **[CAMPAIGN]** F-TEMPORAL-3: `search_signals`/`get_related_signals`
  return empty despite matching rows existing. *Retrieval gap — newly proven this campaign.*

**Intelligence Boundary Awareness (IBA):** **[PRIOR]** designed but VISION/NOT-PRESENT. The FSJ case shows
the missing capability — Aegis should state *what it does and does not collect* so a scoped corpus is not
mistaken for full coverage. Directly serves "false certainty destroys decision space."

> **Bottleneck verdict:** the next bottleneck is **collection (primary) and retrieval (secondary)** — **not
> reasoning, and no longer chiefly presentation.** Retrieval fixes are cheap and should clear first; collection
> is the campaign-scale frontier.

---

## 4. CAMPAIGN PRIORITIZATION — top 10 post-temporal initiatives

Trust impact scale: ⬤⬤⬤ high / ⬤⬤ med / ⬤ low. Complexity: S / M / L.

| # | Initiative | Operator trust | Exec trust | Aegis usefulness | Complexity | Why next / not |
|---|---|---|---|---|---|---|
| 1 | **Fix F-TEMPORAL-3 broken-column tools** [CAMPAIGN] | ⬤⬤⬤ | ⬤⬤ | ⬤⬤⬤ | **S** | Cheapest high-trust win; makes entity/related retrieval actually return data and fire temporal tagging. Do first. |
| 2 | **Trustworthy validation harness** (target staging, decode per-tool errors, health taxonomy) [CAMPAIGN] | ⬤⬤ | ⬤⬤ | ⬤⬤ | **S/M** | Nearly derailed *this* deploy; every future campaign needs a gate that can't lie. Foundational. |
| 3 | **Eliminate silent-empty failure mode** (surface query errors, not `[]`) [CAMPAIGN] | ⬤⬤⬤ | ⬤⬤ | ⬤⬤ | **M** | Removes the "looks empty, actually broken" class — the trust-killer behind #1. |
| 4 | **surface_date capture in monitors** [CAMPAIGN] | ⬤⬤ | ⬤ | ⬤⬤ | **M** | Completes the temporal axis with real publication dates → more items correctly **Current**. Compounds the temporal win. |
| 5 | **event_date quality remediation** (cosmetic/copied/future at the writer) [CAMPAIGN] | ⬤⬤ | ⬤⬤ | ⬤⬤ | **M/L** | Raises the share classifiable as Current vs Timing-Unknown; directly improves "what changed this week." |
| 6 | **Intelligence Boundary Awareness** (Aegis states collection scope) [PRIOR] | ⬤⬤⬤ | ⬤⬤⬤ | ⬤⬤ | **M** | Prevents false certainty on scoped corpora (FSJ). High trust for modest cost; pairs with collection work. |
| 7 | **Source attribution coverage** (close the ~36% no-label gap) [PRIOR] | ⬤⬤ | ⬤⬤ | ⬤ | **M** | Provenance underpins every doctrine; needs re-verification first. |
| 8 | **Dead-monitor triage** (revive or honestly decommission github/darkweb/csis/court; watchdog 0-yield flag) [PRIOR] | ⬤⬤ | ⬤⬤⬤ | ⬤⬤ | **M** | Stops implying coverage we don't deliver; exec-trust sensitive. Re-verify yields first. |
| 9 | **Actor-authored POI collection** (give the 0-footprint POIs real data) [PRIOR] | ⬤⬤⬤ | ⬤⬤⬤ | ⬤⬤⬤ | **L** | Highest *intelligence* value and the gate to Mark-II posting-time — but expensive and depends on #1–#5 being solid. Big bet, not first. |
| 10 | **Tenant collection-scope expansion** (e.g. FSJ crime keywords for Petronas) [PRIOR] | ⬤⬤ | ⬤⬤ | ⬤⬤ | **M** | Concrete coverage fix once IBA (#6) makes scope explicit; sequence after boundary awareness. |

**Sequencing logic (not a plan — a recommendation for the go/no-go):**
- **Wave A (cheap, trust-critical, retrieval/observability):** #1, #2, #3 — small, fast, remove invisible
  blind spots and give us a gate that doesn't lie. Strong candidate for the *immediate* next campaign.
- **Wave B (temporal-completion + data quality):** #4, #5 — compound the temporal win with real dates.
- **Wave C (trust framing + collection truth):** #6, #7, #8 — make coverage honest.
- **Wave D (collection capability — the frontier):** #9, #10 — the expensive bets that raise the Aegis
  ceiling; only after Waves A–C make the foundation trustworthy.

---

## Decision posture

- This package uses **only** evidence from the Temporal Integrity campaign and clearly-labeled prior
  baselines; **[PRIOR]** items must be **re-verified** before any commitment (no production investigation
  was performed here).
- **No item is started.** The recommendation, when Temporal Integrity is formally closed, is to open the
  next campaign on **Wave A (retrieval + observability)** — cheapest, highest-trust, and it repairs the
  blind spots this campaign exposed — then decide Waves B–D against fresh evidence.
- Commander's Intent honored: **finish Temporal Integrity first**; this is the prepared battlefield for what
  comes after.
