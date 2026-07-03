# Decisions

This is an append-only record of owner decisions.

## 2026-07-02 — Delivery-lane certification

Frontend delivery-lane certification is the active Class A lane. Scope: source and release-path certification only. This entry does not start a merge, deployment, migration, connection, or other runtime action. The blocked client-membership lane does not occupy the active Class A WIP slot.

## 2026-07-02 — Staging recovery ladder

The v3 recovery ladder governs the client-membership retry gate. Breaker cooldown plus explicit Aaron Evidence Operation approval governs an original-path retry; a support response is not a prerequisite. When the ladder activates, rung 2 alternate read path is prioritized before an original-path retry. This entry does not authorize a connection, retry, apply, or configuration change.

## 2026-07-02 — Weekly value-gate counting

A client-usable artifact may count once. A preview that has counted may not count again until it ships through a trusted delivery lane. This rule does not create release authority or pressure to ship an unsafe change.
