# Campaign 2 — Executive Reporting

**Strategic planning only.** No implementation, code, branches, or deploys. Tied to Commander's Intent: *"Preserve decision space by shortening Signal → Decision → Action."*

**Mission framing:** the decision owner has ~60 seconds before context switches. A report that requires more than 60 seconds to identify *what changed* and *what decision is required* is a report that fails the Decision Layer. Campaign 2 reshapes every report surface around that 60-second test.

---

## §1 — Inventory of current report types

### Production surfaces (referenced in CLAUDE.md or generator filenames)

| Generator | Cadence | Audience | Output shape | Critical-path? |
|---|---|---|---|---|
| `send-daily-briefing` (cron 13:00 UTC) | Daily | Operator-facing email | HTML briefing per tenant | YES — daily decision touchpoint |
| `generate-daily-briefing` (helper) | On-demand inside send-daily-briefing | Same | Composes the HTML | YES |
| `generate-poi-report` | User-triggered | Person-of-interest investigation output | HTML report with relationship graph + HIBP + claim taxonomy (Workstream D dark) | YES — customer-facing |
| `generate-fortress-report` | User-triggered (Aegis can invoke) | Generic threat report | HTML; smoke-tested in `test-aegis-tools.mjs` | YES — but signed-URL expiry defect (V4) still latent until INC-ART-001 closure verified |
| `generate-wildfire-daily-report` | User-triggered | Wildfire intel (FWI, station ratings, AQHI, restriction matrix) | HTML ~40KB | YES — seasonal-critical |
| `generate-poi-report` HIBP fallback path | Triggered when investigate-poi timed out | Person breach context | HTML subsection | partial |
| `assess-entity` writes `ai_assessment` | On-demand | Per-entity risk synthesis | DB JSON consumed by EntityDetailDialog Risk Assessment tab | YES |
| `briefing-feedback` | Email-triggered per-recipient | Operator → system back-channel | DB writes only (no consumer per Path A audit) | NO (loop is open per Impact Assessment 2026-05-30) |
| Audio briefing | On-demand | Operator (audio rendering of daily brief) | MP3/streaming | partial |
| Travel briefing / alert | Per-event (`monitor-travel-risks`) | Operator email | HTML | partial |
| Security bulletin | `SecurityBulletinGenerator` | Operator-curated | HTML | partial |
| Signal feed digest | `SignalHistory` UI | Operator dashboard | UI listing | NO — read surface, not a report |
| Executive Intelligence Brief (target) | Referenced as the convergence target | Operator decision-owner | Not yet a single surface | TARGET — convergence destination |

### Held / contaminated / pending

- INC-XTEN-class ownerless `executive_intelligence` reports (Task #53) — table-or-shape pending operator clarification
- Trent Reznor report — methodology-injection cure landed (#56); regeneration validation pending (#51)
- Flash↔Narrative contradiction proposal — signal-vs-threat separation; not yet authorized for implementation (#57)

---

## §2 — Report-generation architecture

```
Trigger (cron / user / Aegis tool call)
  ↓
Generator edge function (e.g., generate-daily-briefing)
  ↓
Retrieval layer
  ├── signals (tenant-scoped post-PR #77)
  ├── incidents (tenant-scoped post-PR #77)
  ├── entities (tenant-scoped post-PR #78 entity count; C.1 G2 workspaces)
  ├── investigations (tenant via clients FK)
  ├── signal_agent_analyses (tenant-scoped 2026-05-30 — Layer 1 fix)
  ├── agent_tradecraft (Class A; global tradecraft, intentional)
  ├── expert_knowledge / global_learning_insights / agent_beliefs (INC-LEARN-CONTAM FROZEN — read-disabled)
  ├── tenant_chunks / tenant_docs (Provenance Doctrine compliant; empty today)
  └── archival_documents (INC-CRT-DOCUMENT-SCOPE — no tenant_id column, latent)
  ↓
LLM composition layer (Aegis / specialized agents)
  ├── System prompt (AEGIS_CORE_IDENTITY + FORTRESS_PLATFORM_OVERVIEW + ANTI_FABRICATION_RULES + TOOL_USAGE_GUIDANCE + claim-frame R1-R6 prose-lint)
  ├── Tool-call layer (TENANT_SCOPED_TOOLS gate + executeTool)
  └── Output rendering
  ↓
Persistence layer
  ├── generated_reports (tenant_id NOT NULL ✓ Provenance compliant)
  ├── poi_reports (tenant_id YES nullable — partial compliance)
  ├── reports (tenant_id YES nullable — partial)
  └── shared_intel_products (no tenant_id column — non-compliant)
  ↓
Delivery
  ├── Email (Resend)
  ├── Signed URL (7-day; INC-ART-001 latent until verified closed)
  ├── In-app render (EntityDetailDialog Risk Assessment tab, SignalDetailDialog)
  └── Audio (Buzzsprout / direct stream)
```

**Hidden composition state:** the persona stack at `dashboard-ai-assistant:159-223` composes the Aegis system prompt at runtime. Reports generated via Aegis tool calls inherit this stack. Reports generated via specialized generators (e.g., generate-poi-report) have their own prompt assembly. **Two parallel prompt-assembly paths** — divergence is a current risk class.

---

## §3 — Current strengths

| Strength | Evidence |
|---|---|
| Tenant-scoped signal + incident retrieval in daily briefing | Layer 1 fix 2026-05-30 (task #60); generate-daily-briefing's `signal_agent_analyses` retrieval is tenant-bound |
| Workstream D claim-frame infrastructure prod-applied | PRs #38/#39/#40 merged 2026-05-28; four-question frame (Fact/Inferred/Confirmed/Hypothesis/Stale headline) + six-axis drill-down + prose-lint R1-R6 + append-only audit table |
| Class A tradecraft separation | 15,418 legacy agent_beliefs rows migrated to agent_tradecraft / agent_tradecraft_quarantine; tradecraft retrieval-injection prod-applied with prose-lint R7 |
| POI report rich-content layers | Strict sourcing rule, live HIBP fallback, relationship injection from `entity_relationships`, prior AI assessment context, OG image extraction |
| Wildfire report seasonal context | Off-season / shoulder / fire-season awareness; FWI estimation; restriction matrix; tiered flaring classifier |
| Signed-URL helper (`_shared/storage.ts`) | Centralized signing pattern; bucket registry |
| Aegis Flight Recorder | Operational; reconstructs report content lineage when invoked |
| Decision Layer Doctrine + R1.0 schema | Six-element Decision Frame ratified; foundation for converting reports to decision artifacts |
| Provenance Doctrine on key tables | `generated_reports.tenant_id NOT NULL`; named CHECK backstops |

---

## §4 — Current weaknesses

### Structural

1. **No unified Decision Frame across reports.** Each generator has its own template; the six-element frame (What changed / Why it matters / Who should care / What decision deserves attention / Consequence / Recommended action) is ratified but unimplemented.
2. **Workstream D claim-frame UI is dark** (`D_SLIM_SLICE_ENABLED` flag). Operator can see provenance in Aegis traces; customer cannot see provenance in reports.
3. **>60s read time.** Daily briefing and POI reports are dense prose; the *decision* the report points to is not always headlined.

### Trust + Provenance

4. **INC-LEARN-CONTAM-LEAK (P0.3) open.** Frozen shared-learning stores prevent active contamination but the prompt-injection class is structurally unfixed; freeze-lift would re-open the leak.
5. **18 LLM-derived analysis stores have Provenance gaps** (`agent_beliefs` 99.3% NULL ownership; `agent_debate_records` 90.5% NULL). Class B remediation held.
6. **INC-XTEN-class ownerless `executive_intelligence` rows** (Task #53). Schema target ambiguous; report content may surface ownerless rows.
7. **Methodology-injection cure not regression-tested across all surfaces.** Trent Reznor report (#56) cured; same class on other reports not exhaustively verified.

### Operational

8. **INC-ART-001 signed-URL expiry** — `generate_fortress_report` bulletin uses 7-day signed URL + not persisted to `reports`. Vince #4 finding. Status uncertain.
9. **Audio briefing pipeline brittleness** — no smoke check; failures discovered by operator.
10. **No A/B path for the future briefing structure** — promoting Workstream D layers from dark to lit is all-or-nothing today.

### Doctrine

11. **No Decision Frame validation on report output.** A report that doesn't headline a decision is not currently flagged.
12. **No automated check that recommendations are grounded** (Grounding-State Doctrine §4: *"no provenance → no recommendation"*).

---

## §5 — Recommended future briefing structure

### The 60-Second Brief format

Every report — daily briefing, POI report, Fortress report, wildfire report — converges to a common skeleton:

```
═══════════════════════════════════════════════════════════════════
[HEADER]
Tenant: <name>
Report: <title>
Date: <ISO>
Generated by: Fortress / <generator-id>
═══════════════════════════════════════════════════════════════════

▼ 60-SECOND SUMMARY (the only block guaranteed to be read)

What changed:
  <one-line factual delta>

Why it matters:
  <one-line stakeholder consequence>

Who should care:
  <one-line role + tenant scope>

Decision deserves attention:
  <one-line question or choice>

Consequence:
  <if action not taken in N hours, X happens>

Recommended action:
  <one-line; tied to a button / link / phone / Aegis prompt>

═══════════════════════════════════════════════════════════════════

▼ EVIDENCE (drill-down for the 5% who want it)

[Claim-frame layer: each factual claim tagged Fact / Inferred / Confirmed / Hypothesis / Stale]
[Source citations inline, with provenance trace]
[Per-claim "axes" drill-down: temporal, confidence, source-credibility, tenant-scope, doctrine-class, recency]

═══════════════════════════════════════════════════════════════════

▼ DECISION TRACE (operator-only; collapsed by default)

[Aegis Flight Recorder summary: which signals fed this, what tools fired,
what agent debated what, when the Decision Frame fired]
```

### Doctrinal alignment

- Decision Layer Doctrine six-element frame: §I1 (statistical noise without commitment impact ≠ Decision Frame) enforced — the SUMMARY block fires only on commitment-impacting events.
- Grounding-State Doctrine: every claim in EVIDENCE carries a grounding tag; recommendations without provenance are suppressed.
- Workstream D R1-R6 prose-lint: applied to every prose section.
- Aegis Authority Doctrine: tenant retrieval through certified surfaces only; cross-tenant tradecraft drawn from `agent_tradecraft` (intentional global).

### What this kills

- The "noise wall" — long-prose briefings the decision owner skips.
- Ungrounded recommendations — Aegis-style hallucination filtered structurally.
- Tenant-blind injections — frozen stores cannot reach a Decision Frame block.
- Report-to-report inconsistency — single skeleton means same look across surfaces.

---

## §6 — Quick wins

| # | Win | Effort | Customer-visible impact |
|---|---|---|---|
| Q1 | **Apply six-element Decision Frame to `send-daily-briefing` template** — restructure the existing prose into the SUMMARY block at top; leave existing content as EVIDENCE | Small (template change in `generate-daily-briefing/index.ts`) | HIGH — daily decision touchpoint becomes 60-second-readable |
| Q2 | **Promote Workstream D claim-frame UI from dark to lit on POI reports only** — flip `D_SLIM_SLICE_ENABLED=true` for the poi-report surface; observe 7 days | Small (flag flip + observation) | HIGH — customer sees provenance |
| Q3 | **Inline source URLs on every factual claim in daily briefing** — already in the signal model; render them | Small | MEDIUM |
| Q4 | **"Decision Required" header in all reports** — prepend a one-line "DECISION REQUIRED: …" or "FOR AWARENESS ONLY: …" to every report | Tiny (template) | HIGH |
| Q5 | **Regenerate Trent Reznor report via claim taxonomy** (task #51) — operator validation that the methodology-injection cure holds | Small | HIGH (one customer report) |
| Q6 | **Honest-empty discipline in reports** — when a section has no grounded content, render "No content for this section in current tenant scope" (mirrors Quarantine Doctrine read-leak rule applied to report sections) | Small | MEDIUM |

---

## §7 — Long-term redesign roadmap

| Phase | Scope | Gating prerequisite |
|---|---|---|
| **E.0** | Quick wins Q1-Q6 (above) | Operator GO per item |
| **E.1** | **Convergence skeleton** — refactor all report generators to consume a single `BriefingComposer` module that emits the 60-Second + Evidence + Decision-Trace structure. Each generator supplies content, not template. | E.0 stable + 2 weeks observation |
| **E.2** | **Grounding-State runtime enforcement** — every recommendation block runs through `tenantRetrieve()` provenance check; un-provenanced recommendations are suppressed with honest-refusal. | C.0–C.4 commitment-data scaffolding observation closes |
| **E.3** | **Class B Provenance closure on the 18 LLM-derived stores** — `agent_beliefs`, `agent_debate_records`, etc. get `tenant_id NOT NULL` + CHECK backstop + writer scoping. Reports stop reading from ownerless rows. | PR #36 G3 decision + INC-LEARN-CONTAM remediation gate |
| **E.4** | **INC-LEARN-CONTAM-LEAK closure** — prompt-level injection of frozen stores into report generators eliminated; anonymization gate built; freeze lifted | Class A migration pattern reapplied to the 3 frozen stores |
| **E.5** | **Decision Frame retroactive scoring** — yesterday's reports re-scored against six-element criteria; flag reports that lacked a Decision Frame block | Decision Layer R1.x landed (locked behind §11 inventory re-run) |
| **E.6** | **Multi-surface convergence verification** — every report surface (daily / POI / Fortress / wildfire / travel / audio) renders the same skeleton; provenance UI lit by default | E.1–E.4 stable |
| **E.7** | **Customer-facing Decision Trace** — operator-only "Decision Trace" surface opens to authorized customer roles for transparency | E.6 stable + operator GO |

**Estimated duration:** 4–8 weeks for E.0; 12–20 weeks for E.1 through E.4; E.5–E.7 future-gated.

---

## §8 — How this serves Commander's Intent

A report that takes longer than 60 seconds to convey *what changed* and *what decision* is a report that lengthens the *Signal → Decision* interval. The current Daily Briefing fails this test routinely — long prose, decision buried, claims ungrounded, customer-trust risk via INC-LEARN-CONTAM-LEAK.

Each item in this campaign compresses the interval:

- Q1 (six-element frame in daily): the decision is the first thing the operator sees.
- Q2 (claim-frame UI lit on POI): customer sees provenance, asks fewer "is this real?" questions.
- E.2 (grounding-state runtime): recommendations the operator sees are decision-actionable, not exploratory.
- E.3 + E.4 (Provenance + INC-LEARN-CONTAM closure): the *trust* substrate that makes the Decision Frame credible.
- E.6 (multi-surface convergence): the operator's mental model becomes "every Fortress report is the same shape" — context-switch cost approaches zero.

The end-state Executive Intelligence Brief isn't a new report surface — it's *every* report surface restructured around the Decision Layer Doctrine.

---

## §9 — Held

- No implementation
- No code, branch, migration, deploy
- No flag flips (Q2 requires separate operator GO)
- No regeneration of customer reports without explicit authorization
- No closure of INC-LEARN-CONTAM-LEAK without anonymization-gate gate
- Phase E.0–E.7 each separately gated; no automatic promotion
