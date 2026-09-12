# WO-QUALIFIER-DEAD — the AEGIS lead qualifier does not convert and has almost no traffic

**Status:** OPEN — report only, do not investigate yet
**Opened:** 2026-09-12
**Class:** revenue-path / product (not a defect — a surface that isn't working)

## Finding

The AEGIS lead qualifier has produced **17 conversations in its entire lifetime**:

- **16 synthetic**, 1 real.
- **All on 2026-08-24** (a single ~6h window).
- **All still `status = in_progress`** — the one real conversation was never completed.
- **0 qualified** (`qualified_at` null across all 17).
- **0 callback numbers** captured.
- **0 pushed to CRM.**

That is a sales surface that **does not convert and has had almost no traffic.**

## Why it is worth knowing

It sits directly on the revenue path. Three distinct hypotheses, unresolved:

1. **Traffic** — almost nobody reaches the qualifier (top-of-funnel / entry-point problem).
2. **Conversation design** — people reach it but abandon before completing (17 started, 0 finished).
3. **Qualification threshold** — conversations complete but nothing clears the bar to qualify.

These are different problems with different fixes. Which one it is, is currently **unknown**.

## Related

- The outbound alert path (`send-sms` `operator_alert` branch) was **fixed and deployed 2026-09-12** (PR #214, prod v122) under WO-INBOUND-WEBHOOK-UNSIGNED. So *when* a lead finally qualifies, the operator will be paged. Until this WO is worked, there is nothing upstream producing a qualified lead to page about.
- The zero-qualified finding was surfaced while diagnosing why the `operator_alert` alert had never fired (it had never fired because the path 400'd AND because no lead has ever qualified — two independent reasons).

## Next (when picked up)

Report only for now. When investigated: measure funnel entry volume, per-conversation drop-off stage, and the qualification-threshold logic — one measurement per hypothesis above, before changing anything.
