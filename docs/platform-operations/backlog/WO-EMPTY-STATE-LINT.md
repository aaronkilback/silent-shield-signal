# WO-EMPTY-STATE-LINT — lint rule to stop the eighth false-zero

**Status:** LOGGED (do not build). **Opened:** 2026-08-31 (false-zero class fix).

The `AsyncListState` primitive (src/components/ui/async-list-state.tsx) fixes the seven known
false-zero surfaces, but nothing STOPS a new list component from being written the old way
(error folded into an empty state, no `isError` branch). Follow-on: a lint rule (eslint custom
rule or a grep-based CI guard) that flags a component rendering an empty-state string
("No ...", "all clear", "inbox zero", "nominal", "none") from a data query without routing through
`AsyncListState` or branching on `error`/`isError` first. Audit-only first (per the transitional-guard
discipline), then blocking once the surfaced set is triaged.
