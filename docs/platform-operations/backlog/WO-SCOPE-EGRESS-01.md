# WO-SCOPE-EGRESS-01 — client-scope audit of the three unscoped report surfaces

**Opened:** 2026-07-30 (WO-PARTITION-01 static guard `scripts/check-generator-client-scope.mjs`).
**Status:** LOGGED, not started. **Do not start without an explicit go.**

**Explicit scope note:** WO-PARTITION-01's clean contamination result (F4a/F4b = 0, entity/belief
retrieval client-scoped) was scoped to **`generate-executive-report` ONLY**. It does **not** cover
the three surfaces below, which the (a) static guard flagged as reading tenant-bearing tables with
no `client_id`/`tenant_id` predicate.

## Priority order (when it runs)
1. **`send-daily-briefing`** (1 unscoped `signals` read). **EGRESS — highest priority.** Print:
   does it transmit to external recipients, to whom, and has it ever run against more than one
   client (i.e. could one client's signals reach another client's recipients)?
2. **`generate-security-briefing`** (2 unscoped reads: `signals`, `incidents`). Print every
   artifact it has produced and the client each was delivered to.
3. **`generate-poi-report`** (5 unscoped reads: `entities`, `entity_content`, `signals`, `entities`,
   `incidents`). Verify "entity-scoped by design" is intentional, and print what prevents one
   client's principal from appearing in another client's POI product (the entity graph is global
   and NOT engagement-partitioned — see WO-PARTITION-01 F4c).

Enforcement (client-scoped retrieval seam) only after the audits print, per the same
print-first / rule-first discipline as WO-PARTITION-01.
