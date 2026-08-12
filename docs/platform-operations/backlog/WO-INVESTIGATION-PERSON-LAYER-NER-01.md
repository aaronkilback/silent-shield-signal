# WO-INVESTIGATION-PERSON-LAYER-NER-01 — investigation person/narrative content outside the entity graph

**Logged 2026-08-12.** Two branches of the same problem: investigation content the entity graph cannot reference by id.

## Finding (measured)
1. **`investigation_persons`: 36 person rows across 13 files with NO `entity_id`** — name/phone/company free text. The person-of-interest layer is entirely outside the entity graph: not resolvable, not watch-listable, not cross-linkable by id.
2. **Narrative-only investigations** (~7–9 of 20 have entities only in `synopsis`/`information`, not `correlated_entity_ids`) — need NER extraction to become watch-able entities.

## Consequence
The watch-list build could only backfill `correlated_entity_ids` (13 entities). Persons and narrative entities are invisible to it. Fix = NER extraction + entity resolution to bring persons/narrative mentions into the graph (link `investigation_persons` to `entities`; extract from narrative).

## Not started. Deferred from the watch-list scope.
