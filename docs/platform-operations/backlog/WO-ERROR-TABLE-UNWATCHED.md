# WO-ERROR-TABLE-UNWATCHED — edge_function_errors is written but not read

**Status:** LOGGED (do not start). **Opened:** 2026-08-31 (WO-SONAR-CREDENTIAL final ruling).

## The finding
`public.edge_function_errors` has carried Perplexity **credit-rejection rows since 2026-03-11**
(severity `critical`, `request_context.issue = 'api_credits_exhausted'`). The failure was **recorded for
~5 months and never surfaced** — the credential death was logged the whole time; nothing watched it.

**Compounding (population problem):** only **monitor-travel-risks** calls `logError` for Perplexity
failures — and even it logs **once per invocation** (`perplexityFailureLogged` latch). The other six sonar
callers (agent-chat, agent-knowledge-seeker, dashboard-ai-assistant, ingest-expert-media,
query-expert-knowledge, tech-radar-scanner) fail closed with a bare `console.error` / early return and
**write nothing to `edge_function_errors`**. So for six of the seven there was no record to miss in the
first place. Sparse writer + no reader = a health signal that cannot fire.

## Two open questions (answer population-first, per the just-ratified standing rule)
1. **What reads `edge_function_errors` today, if anything?** (dashboards, agent-sentinel probes, alerts,
   any cron aggregator — or nothing). If nothing reads it, every write to it is silent by construction.
2. **Which deployed functions write to it on failure, and which fail silently?** Enumerate the FULL
   population of edge functions (deployed set, not repo subset — per Population-Before-Check) and classify
   each: writes `edge_function_errors` on error / writes only to console / swallows. The gap is the set
   that can fail invisibly.

## Class
Same family as **WO-SUBSET-RULE-DEFECT** (subset-vs-population blindness) and the non-executing
`drift.mjs` (a check that never runs): a control that exists on paper but produces no watched signal.
The fix direction (once ruled) is likely a reader (agent-sentinel probe over `edge_function_errors`
severity=critical, unresolved, recent) + a standard failure-logging seam so functions stop failing silent.

## Do NOT (per ruling)
Log only. Do not investigate the two questions, do not build a reader, do not change failure logging yet.
