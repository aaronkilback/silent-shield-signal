# WO-HAZARD-RELEVANCE — Phase 1 Evidence Report

**Date:** 2026-07-28 · **Scope:** prod `kpuqukppbmwebiptqmog`, client Petronas Canada (`0f5c809d-60ec-4252-b94b-1f4b6c8ac95d`) · **Status:** EVIDENCE ONLY — no changes. Phase 2 HELD.

**Doctrine under test:** hazard-class signals (wildfire / civil_emergency / weather / natural_disaster) are relevant ONLY via an impact pathway — (a) proximity to client facilities/assets, (b) pipeline/corridor overlap, (c) supply-chain routes, (d) employee travel or personal lives (incl. Calgary HQ). A fire with no pathway is awareness-tier at most, regardless of severity.

**Headline:** the relevance scorer has **no geographic computation of any kind** — no PostGIS, no distance, no coordinates. Hazard relevance is decided by an LLM matching the signal's location *text* against the client's `locations` *text array*, which contains province-wide entries ("British Columbia", "Northern BC"). The entire province therefore reads as "adjacent geography with credible spillover," so BC wildfires 400–600 km from PECL operations score 0.6–0.9 and auto-promote. The four pathways cannot currently be expressed, let alone enforced.

---

## 1. Does relevance scoring apply asset-distance to hazard signals? — NO

**Relevance pipeline** (`supabase/functions/ingest-signal/index.ts`):
- **Gate 1 — AI classification** (~L922–979): assigns `category` (incl. `wildfire`, `civil_emergency`), `severity`, `confidence`. No geography.
- **Gate 2 — AI relevance gate** (L1536–1785): fetches the client as **text** —
  ```ts
  .from('clients').select('name, industry, locations, high_value_assets')   // L1540
  ```
  and injects them into the LLM prompt as strings (L1652–1660):
  ```
  LOCATIONS: ${(clientForGate.locations || []).join(', ')}
  KEY ASSETS: ${(clientForGate.high_value_assets || []).join(', ')}
  SIGNAL: ${classification.normalized_text …}
  ```
  The scoring rubric (L1597–1602) has the model *reason verbally* about "adjacent geography with credible spillover" (0.6–0.79 band). **There is no `ST_Distance`, no `geography`/`geometry` query, no geocoding, no buffer test anywhere in the path.** The comparison is pure text/LLM heuristic.
- **Gate 3 — learned-pattern scorer** (`_shared/signal-relevance-scorer.ts:123–470`): 7 phases (content patterns, source reliability, source diversity, pgvector embedding similarity, learning-profile keywords, severity, recommendation). **Also no geographic component.** ("Distance" here is embedding cosine distance, not physical distance.)

**Why the Clinton signals scored ≥0.60:** the client `locations` array includes `"British Columbia"`, `"Northern BC"`, `"Northeast BC"`, `"Peace Region"`. A signal whose text says "wildfire near Clinton, B.C." text-matches "B.C." → the LLM rates it "adjacent geography with credible spillover" (0.6–0.79) or higher. **Clinton (Fraser Canyon, BC Interior) is ~350 km N of Vancouver and 500–600 km S of PECL's Montney/Fort St. John operations, and ~600 km SE of Kitimat — nowhere near any PECL asset or corridor — yet it scores like a neighbour because "BC" is in the client's location list.** Live scores (prod `signals`, this period):

| signal | category | sev | relevance |
|---|---|---|---|
| Wildfire aftermath in Clinton, B.C. | civil_emergency | high | **0.9** |
| Wildfires merge near Clinton, B.C. | civil_emergency | high | **0.9** |
| Wildfire near Lillooet out of control | civil_emergency | medium | **0.9** |
| Out-of-control wildfire near Boston Bar | civil_emergency | high | **0.9** |
| Wildfire near/damage/outside Clinton (×6) | civil_emergency | high–crit | 0.7–0.8 |
| Merging of Wildfires in Boston Bar | civil_emergency | critical | 0.8 |
| Wildfires exacerbated by climate change in Canada | civil_emergency | critical | 0.7 |
| Calgary air quality warning | health_concern | critical | 0.6 |
| Massive wildfires near Clinton | civil_emergency | critical | 0.6 |
| **Prescribed burn planned for Fort Nelson** | civil_emergency | low | **1.0** |

The gate reasoning is **not persisted** (`raw_json` has no `relevance_gate` object — confirmed `has_gate_json=false` across all rows), so the score cannot even be audited after the fact. Note the inversion: a **prescribed (planned, controlled) burn near Fort Nelson** — the one location actually near PECL country — scored **1.0**, while it is the *least* threatening item in the set. The scorer rewards place-name proximity in text and is blind to both distance and event nature.

---

## 2. PECL taxonomy — what exists, what's missing for the four pathways

Live `clients` row (`0f5c809d…`, active):
- **`locations`** (18, TEXT[]): Northeast BC, Peace Region, Montney Formation, Fort St. John, Dawson Creek, Kitimat, Prince Rupert, Northwest BC, **Coastal GasLink corridor**, Highway 16, Skeena, Bulkley Valley, Terrace BC, Smithers BC, **British Columbia**, **Northern BC**, Peace River, **Alberta**.
- **`high_value_assets`** (7, TEXT[]): LNG Canada terminal (Kitimat), Coastal GasLink pipeline, Progress Energy upstream (Montney), Peace Region wells/gathering, Prince Rupert Gas Transmission pipeline, Cedar LNG (proposed), PECL BC upstream operations.
- **`monitoring_keywords`** (42, TEXT[]).

**What exists to express pathways:** only free-text place/asset names. **What is missing (all four pathways are geometrically inexpressible today):**
- **(a) Asset proximity** — no `geometry(POINT,4326)`/`geography` on `clients`, `internal_assets` (`internal_assets.location` is TEXT and cyber-scoped), or any facilities table. No coordinates for Kitimat terminal, Montney wells, etc.
- **(b) Corridor overlap** — "Coastal GasLink corridor" / "Prince Rupert Gas Transmission pipeline" exist as **strings**, not `LINESTRING` geometries. No buffer test possible.
- **(c) Supply-chain routes** — "Highway 16" is a string; no route geometry. (`supply_chain_entities` column exists but is text names.)
- **(d) Employee travel / Calgary HQ** — **Calgary is NOT in `locations`** (only "Alberta" is, province-granularity). No `office_locations`, no `employee_bases`, no travel-corridor table. The Calgary HQ pathway — central to the doctrine — has no representation at all. (The "Calgary air quality" signal scored 0.6 only because the model happened to recognize Calgary as Alberta-ish, not because HQ is modelled.)

**No PostGIS geometry/geography column exists anywhere relevant** (PostGIS is installed for `spatial_ref_sys` only).

---

## 3. Manual pathway scoring of the named wildfires

Scored against the four-pathway test using PECL's real footprint (Montney/Peace upstream around Fort St. John–Dawson Creek; Kitimat LNG + CGL/PRGT corridors through NW BC; **Calgary HQ + employee homes**):

| Fire (as it appears in the incident table) | Nearest PECL footprint | Pathway hit? | Verdict |
|---|---|---|---|
| **Clinton ×5** (Fraser Canyon, Interior BC) | ~500–600 km from Montney; ~600 km from Kitimat/CGL | **NONE** — not proximate, not on any corridor, not a supply route, no employee base | **NO PATHWAY → awareness at most** |
| **Boston Bar** (Fraser Canyon, ~50 km S of Lytton) | same region as Clinton; far from all assets | **NONE** | **NO PATHWAY → awareness** |
| **Squamish-Lillooet** (Lillooet / Sea-to-Sky, SW BC) | ~500 km+ from NE/NW BC ops | **NONE** | **NO PATHWAY → awareness** |
| **Fort Nelson (FN)** (far NE BC) | northern edge of NE BC gas country; employee/ops adjacency | **(a) proximity + (d) employees** (weak–moderate) | **PATHWAY → keep (watch)** |
| **Calgary AQ** (air-quality warning, Calgary) | **PECL HQ + employee homes** | **(d) employee lives / HQ** | **PATHWAY → keep (awareness/watch)** |

**Result matches the operator's prediction exactly: only Fort Nelson and Calgary pass; Clinton ×5, Boston Bar, and Squamish-Lillooet have no pathway.** The current system does the opposite — it scored Clinton/Boston Bar/Lillooet 0.6–0.9 and promoted them to P2 incidents, while the genuinely-adjacent Fort Nelson item was (correctly, but for the wrong reason) not escalated only because it was a *low-severity prescribed burn*. Severity, not pathway, is doing all the work — and doing it wrong.

---

## Cross-reference to WO-INCIDENT-QA

These wildfires became incidents via `check-incident-escalation`, which gates on `severity_score ≥ 50` with **no relevance or pathway check** (see `docs/reports/WO-INCIDENT-QA-phase1-2026-07-28.md` §1, §4). So the hazard-relevance defect and the incident-creation defect are the same failure viewed twice: **world-severity is promoting true-but-irrelevant hazards into the client's incident queue.** The Clinton cluster is the shared cleanup test case.

---

## PHASE 2 — HELD FOR RULINGS

Surfaced, NOT implemented:

1. **Pathway scoring for hazard classes** — add geographic primitives: `geometry(POINT,4326)` for facility/asset locations + Calgary HQ + employee bases; `geometry(LINESTRING,4326)` for CGL / PRGT / Highway-16 corridors; per-asset-type distance buffers; a corridor buffer. Score hazard relevance from actual `ST_Distance`/`ST_DWithin`, not LLM text-matching.
2. **Cap no-pathway hazards below main tier** — a `civil_emergency`/`wildfire`/`weather` signal with no pathway hit is capped at awareness (`< 0.60`) regardless of severity; only a pathway hit lifts it to main tier.
3. **Re-score the current period** and **regenerate the brief section** once pathway scoring exists.
4. **Fold into WO-INCIDENT-QA ruling phase:** hazard incidents inherit "no pathway → no incident → awareness only." The Clinton incident cluster is the test case for the cleanup verdicts.

**Interim note (no action taken):** province-granular entries `"British Columbia"` / `"Northern BC"` in `clients.locations` are the specific tokens driving the over-scoring; even before geometry lands, tightening these to actual operating areas would reduce the false-positive rate — flagged for the ruling, not changed.
