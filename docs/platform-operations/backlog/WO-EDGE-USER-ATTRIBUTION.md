# WO-EDGE-USER-ATTRIBUTION — per-request user context on edge functions

**Opened:** 2026-07-30 (INC-EXT-SIGNUP-2026-07-30). **Priority:** high — forensic prerequisite.

## Problem
`function_telemetry` has **no `user_id` column**. The success path of every edge function is
**not attributed to a caller.** User context exists only in `edge_function_errors` (errors only),
`aegis_request_trace`, and `aegis_invocations` (subset of functions). Consequence surfaced by
INC-EXT-SIGNUP: for an unrecognized external account we could prove it *created no rows* and *left
no trace in the tables that log user context*, but we **could not prove it made zero edge-function
calls** — a service-role invocation would not have been recorded against the user.

## Scope
1. Add `user_id` (and `tenant_id` / resolved `client_id` where applicable) to `function_telemetry`,
   populated from the verified caller JWT at the top of the shared telemetry helper.
2. Every authenticated-invocable edge function records the caller on BOTH success and failure.
3. Backfill is not possible; from ship date forward, "who invoked what" is answerable in SQL
   (Measurability-is-part-of-the-feature).
4. Pairs with WO-SCOPE-EGRESS-01 (the service-role tenant-scoping sweep): attribution tells us WHO
   called; scoping tells us whether the call could cross tenants.

## Acceptance
A test invocation by a known user appears in `function_telemetry` with that `user_id`, on the
success path, verifiable in SQL.
