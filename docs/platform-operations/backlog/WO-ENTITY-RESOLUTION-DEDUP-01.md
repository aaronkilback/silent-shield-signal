# WO-ENTITY-RESOLUTION-DEDUP-01 — the entity graph stores mentions, not resolved entities

**Logged 2026-08-12.** Surfaced by the investigation watch-list build: the only cross-file link fired on NAME, not entity_id.

## Finding (measured)
- **91 of 4,722 distinct entity names (~1.9%) resolve to more than one `entity_id`** — duplication, not resolution.
- Concrete: `Tourmaline` has **2** `entity_id` rows; INV-2026-047's Tourmaline ≠ INV-2026-0072's, so entity_id matching failed and the name fallback carried the link.
- Across the 9 closed investigations: 13 distinct entity_ids, **0 shared across files by ID.**

## Consequence
Any feature relying on entity_id cross-referencing (watch-list links, association graphs, dedup, incident_entities) silently under-matches and leans on name fallback. Fix = entity resolution / dedup (merge duplicate entity rows to a canonical id; resolve on ingest).

## Not started. Measured only. Do not fix under the watch-list WO.
