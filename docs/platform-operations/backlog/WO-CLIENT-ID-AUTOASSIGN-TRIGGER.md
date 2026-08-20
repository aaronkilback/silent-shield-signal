# WO-CLIENT-ID-AUTOASSIGN-TRIGGER — the root of the cross-client mis-attribution (2026-08-20)

**Class:** provenance / cross-tenant integrity. **Status:** REPORTED — fix awaits operator ruling.
**Priority:** outranks the 580 mis-attributed rows it produced (root vs. symptom).

## What it is
A BEFORE-INSERT trigger on `public.entities` silently attributes any client_id-less insert to a real customer.

```
trg_auto_assign_entity_client_id  ->  public.auto_assign_entity_client_id()   [SECURITY DEFINER, ENABLED]

  IF NEW.client_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_client_id FROM public.clients WHERE status='active' ORDER BY created_at ASC LIMIT 1;
  NEW.client_id := v_client_id;                       -- oldest active client == Petronas Canada (today)
```

Then `trg_derive_entity_tenant -> entities_derive_tenant_id()` pulls that client's tenant to match — so the
row is fully, silently stamped to Petronas (client + tenant), origin-less.

## What set it / is it still in place
- **Still in place: YES, enabled** (`tgenabled='O'`).
- **It is in NO committed migration.** Repo grep for `auto_assign_entity_client_id` matches only a *comment* in
  `supabase/migrations/20260524040000_256_p4_provision_platform_security_client.sql` and the wraith function —
  never a `CREATE FUNCTION`/`CREATE TRIGGER`. **It is an out-of-band prod object** (applied via MCP, ledger
  divergence — same class as WO-LEDGER-RECONCILE).
- **It directly contradicts the doctrine its sibling migration enforces.** That #256 Phase-4 migration exists
  *specifically* to kill this exact anti-pattern for wraith — its header: *"attributed all platform-internal
  findings to the first active client returned by `...limit(1)`. That was arbitrary cross-tenant attribution...
  Per #256 doctrine: explicit ownership or skip; never an arbitrary first-row pick."* wraith was fixed to resolve
  a dedicated `__platform_security__` sentinel or **skip**. The blanket trigger does the forbidden first-row pick
  for **every** entity insert — the anti-pattern the same PR outlawed, re-encoded at the DB layer.
- **Provenance-Doctrine violation** (CLAUDE.md): NULL fallback is prohibited; unknown provenance must fail closed
  or quarantine, never silently downgrade to a real customer's ownership.

## What can hit it (blast radius)
- **Code (live):** audit of all 34 `entities`-insert sites found **osint-entity-scan was the only TS writer
  omitting `client_id`** (now disabled, WO-ENTITY-DEDUP writer #2). vip-deep-scan, agent-chat `create_entity`,
  and the SQL `approve_entity_suggestion_batch()` all pass an explicit client_id.
- **The real hazard is structural:** the trigger is a DB-level footgun for **any future writer, manual SQL insert,
  reactivated function, or new tool** that omits `client_id`. It fails *open* (silently attributes) instead of
  *closed*. Code discipline can't guarantee coverage; the trap sits under everything.
- **Produced:** ≥580 osint-discovered entities blanket-stamped Petronas (2025-11-17 → 2026-08-19). Of those, 54
  are now inside the frozen INC-AITOOLS-XTENANT 788 (untouchable until the hold lifts); 526 outside.

## Recommended fix (await ruling — do NOT apply unprompted)
1. **Drop the trigger + function** (`trg_auto_assign_entity_client_id`, `auto_assign_entity_client_id`) via a
   committed migration (single-file apply; ledger parity). An insert without ownership must **fail closed**, not
   get a customer assigned — consistent with Provenance Doctrine + RLS-at-Creation. Writers already supply
   client_id; the one that didn't is disabled.
2. Consider a **fail-closed replacement**: a BEFORE-INSERT guard that RAISES on `client_id IS NULL` unless an
   explicit `asset_class IN ('system','global_shared')` is set (Provenance invariant), rather than inventing an owner.
3. Because it is out-of-band, a committed migration is required **either way** (drop, or keep-with-justification) —
   fold into WO-LEDGER-RECONCILE.

## Downstream (separate, already reported)
- The **580 mis-attributed rows** (symptom) — cleanup boundary drawn (54 held / 526 free; 521 zero-ref junk, 5
  fabricated-edge, 9 already soft-deleted). Cleanup awaits its own ruling; fabricated edges on the Aaron survivor
  fold into this number (operator ruling, WO-ENTITY-DEDUP).
