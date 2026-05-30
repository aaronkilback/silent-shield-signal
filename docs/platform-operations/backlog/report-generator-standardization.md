# Backlog Item — Report Generator Standardization

**Created:** 2026-05-30  
**Status:** BACKLOG — Commander's Intent recorded; no planning, no implementation.  
**Classification:** unscoped (deliberately — no planning work permitted at this stage).

## Commander's Intent

All Fortress report generators should converge toward the **Executive Intelligence Brief** structure and decision-support philosophy.

## Why this is preserved as a backlog item

Operator-stated direction for cross-surface report consistency. No implementation, no planning, no code, no PR. This document is **context preservation only** — captures the intent, current state, dependencies, and constraints so a future authorized workstream can proceed without re-discovering them.

## Current Fortress report surfaces (inventory; not exhaustive)

Reports and report-like artifacts known to exist in the codebase as of 2026-05-30:

- Executive Intelligence Brief (the convergence target)
- Daily briefing (`send-daily-briefing`, `generate-daily-briefing`)
- POI / Investigation Report (`generate-poi-report`)
- Fortress Report (`generate-fortress-report`)
- Wildfire Daily Report (`generate-wildfire-daily-report`)
- Travel briefing
- Audio briefing
- Security bulletin generation
- Signal feed digest formats (various)

Each generator has its own prompt, output shape, sourcing discipline, and decision-support framing. No canonical structural skeleton exists today.

## Doctrine adjacency

- **Decision Layer Doctrine (ratified 2026-05-29)** defines the six-element Decision Frame: What changed / Why it matters / Who should care / What decision deserves attention now / Decision consequence / Recommended action. The Doctrine is presumably the canonical structural skeleton if Report Standardization adopts a unified frame.
- **Workstream D — confidence + provenance layers (prod-applied 2026-05-28)** establishes the four-question frame (Fact / Inferred / Confirmed / Hypothesis / Stale headline) and prose-lint R1–R6 for `generate-poi-report` and adjacent surfaces. This is partial cross-surface convergence already in flight (single surface — POI report).
- **Grounding-State Doctrine** requires recommendations to carry tenant-provenance. Any standardized report skeleton must respect this — every claim grounded in a certified tenant retrieval trace or framed as general method.

## What this is NOT

- Not authorized for planning work today.
- Not an architectural change yet — operator has reserved the right to determine scope (single skeleton vs per-surface adapters vs full ADR-grade unification).
- Not blocking C.4 adoption window, Path A restoration, or Decision Layer detector work.

## Dependencies (recorded for future prioritization)

| Depends on / interacts with | Direction |
|---|---|
| Decision Layer Doctrine (six-element frame) | Likely structural source; Doctrine already ratified |
| Workstream D claim-frame taxonomy (R1–R6 prose lint) | Existing partial convergence in `generate-poi-report`; provides a template |
| Grounding-State Doctrine (tenant provenance per claim) | Hard constraint on any report payload schema |
| Feedback Loop Restoration (Path A) | Independent. Reports do not consume `learning_profiles` directly. |
| C.4 adoption window | Independent. C.4 is about commitment data capture, not report shape. |
| R1.x Decision Layer detectors | If detectors emit Decision Frames as standardized payloads, Report Standardization could surface them natively. Sequencing not decided. |
| INC-LEARN-CONTAM / Aegis Authority Modes | Constrains what cross-tenant content can appear in any standardized report. |

## When to re-evaluate

Operator-led. No timeline. After C.4 adoption window closes, after §11 inventory re-run, after Feedback Loop Restoration prioritization decision — operator may pick this up, defer indefinitely, or scope it down to a single surface adapter.

## Held (scope discipline)

- No planning artifacts produced.
- No ADR drafted.
- No surface inventory beyond the high-level list above.
- No prompt convergence work.
- No prose-lint widening beyond Workstream D's existing scope.
- This backlog item exists to **preserve intent**, not to anchor active work.
