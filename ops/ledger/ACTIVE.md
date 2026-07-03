# Active Control Board

Last reconciled: 2026-07-03

## WIP slots

- Class A active: Frontend delivery-lane certification (P0).
- Class B active: none.
- Class C active: none. PR #94 is ready in source, but not released.
- Blocked and parked lanes do not occupy a slot.

## Current workstreams

### Frontend delivery-lane certification

- Class/state: A / ACTIVE
- Proof: the main-to-deployment relationship is not sufficiently proven for routine release.
- Planned observation: merging ledger-only PR #95 may trigger the current `main`-connected build path. After merge, record whether a provider build occurred, its target, and whether any served application artifact changed. This is an observation for delivery-lane certification, not release authorization.
- Next gate: reconcile the exact trigger, target, artifact receipt, served-route verification, and rollback pointer.
- Priority: P0.

### Client-membership foundation

- Class/state: A / BLOCKED
- Proof: source and release packet exist. The staging preflight proved source and target, then failed closed at migration-history read. No apply ran.
- Next gate: follow the v3 ladder. After cooldown and explicit EO approval, prioritize the rung 2 alternate read path. Then run one governed original-path preflight if required. This is not gated on a support response. Apply needs a separate approval.
- Priority: P0.

### Aegis loading-state UI — PR #94

- Class/state: C / READY
- Proof: two-file source-only change reviewed; focused tests passed; PR open and unmerged.
- Next gate: certified delivery lane, then planned release decision and preview or live verification.
- Priority: P3.

### Wider authorization: reports, exports, Aegis, realtime

- Class/state: A / QUEUED
- Proof: some containment and personal-chat isolation work exists; it is not globally live-proven.
- Next gate: membership foundation live-proven; then one direct boundary at a time with two-client sentinel proof.
- Priority: P0.

### RLS Advisor inventory

- Class/state: EO / QUEUED
- Proof: warnings identified; exposure classification incomplete.
- Next gate: explicit read-only inventory, beginning with anon-reachable tables. No blanket RLS action.
- Priority: P3.

### Voice / Aegis-first

- Class/state: A / PARKED
- Proof: vision and failure modes understood; reliable conversation is not live-proven.
- Next gate: membership live-proven and a paying customer or channel partner requires voice.
- Priority: P4.
