# WO-FAMILY-SCAN-GAP — household members are held but never scanned

**Status:** LOGGED (do not start). **Opened:** 2026-08-31 (D2 sibling-audit ruling).
**Class:** product gap, NOT a wording defect.

## What it is
`generate-subject-exposure-report` enumerates family entities via `attributes.parent_vip_entity_id`
(index.ts ~line 146-147) to build the **Family & Child Safety** section — so the platform **holds the
identities** of the principal's household members. It **never scans them for exposure**. The subject scan
takes only the principal (name + emails) as search input.

The D2 fix corrected the P2 "Not saying" line from "we did not **find** your family members" (a fabricated
absence) to "we did not **search** for your family members — see the Scope & Method section." That makes the
gap **honest and visible** in the report; it does **not** close it.

## Why it matters
A protective-intelligence client would reasonably expect household members covered — the household is the
threat surface, not just the principal. We already know who they are; we just don't look.

## Scope later (do NOT scope now)
- What scanning a **minor's** exposure requires (this is the hard part — largely policy, not technical).
- Consent model: who authorizes scanning a household member.
- What is appropriate to **report** about a household member, and what is not.
- Whether a stored/emailable artifact about a child should exist at all.

## Relationship to other WOs
Subsumed-adjacent to **WO-SUBJECT-SCOPE-EXPANSION** (ADULT HOUSEHOLD + MINORS groups). This WO is the
concrete in-code manifestation (we hold identities, don't scan) that makes the broader expansion visible.
Both **BLOCKED ON** the per-group consent model (counsel question, sits with the CanLII terms question and
the PECL IP position).

## Do NOT
Do not scope. Do not build. Do not change the minor-refusal default (no DOB → cannot confirm adult → refuse)
until there is a policy behind it.
