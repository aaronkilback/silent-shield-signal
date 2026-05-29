# `agent_beliefs` ownership paradox — forensic finding

**Date:** 2026-05-29. **Scope:** the 8 operator questions about `agent_beliefs`'s 99.3% NULL-client_id pattern and the INC-LEARN-CONTAM containment effectiveness. **Status:** documentation only — no fixes proposed.

---

## TL;DR — **(C) both**

`agent_beliefs` is **both a dormant intelligence store AND a contamination risk** — the same 15,418 NULL-client_id rows behave differently depending on which surface reads them:

- **Operator-facing Aegis (`dashboard-ai-assistant`) and executive briefings (`generate-daily-briefing`)**: fully suppressed. 99.3% of the table never reaches operator-visible prompts. *Dormant from the executive surface.*
- **Agent-to-agent chat (`agent-chat`) and 5 other internal paths**: full access. All 15,418 NULL-client beliefs accessible without tenant scoping. *Contamination risk if any of those beliefs carry tenant-derived facts.*

The 99.3% NULL pattern is not an accident — it reflects writer intent (`knowledge-synthesizer` produces global tradecraft beliefs by design). But the table conflates two distinct concerns with no schema-level separation:

| Purpose | Belief types | client_id pattern | Count |
|---|---|---|---|
| **Global tradecraft** (AI-derived methodology, threat patterns, geographic risk knowledge) | `tactical_insight`, `threat_model`, `pattern`, `geographic_risk`, `actor_assessment`, `best_practice`, `methodology`, `framework`, others | NULL | **15,418 (99.3%)** |
| **Client-specific entity narratives** | `entity_narrative` exclusively | set, all to Petronas Canada client, all by AEGIS-CMD | **115 (0.7%)** |

---

## Q1 — Why 99.3% NULL client_id?

**Because the dominant writer intentionally creates global tradecraft beliefs.**

### Writers (4 distinct paths)

| Writer | Site | client_id at write time | What it produces |
|---|---|---|---|
| 1 | `knowledge-synthesizer/index.ts:197` | **never set** | mass tradecraft beliefs from cross-domain knowledge entries |
| 2 | `knowledge-synthesizer/index.ts:512` | `beliefClientId` (often null — comment says `client=global`) | per-client OR global beliefs from platform signals |
| 3 | `system-ops/index.ts:779` | **never set** | AEGIS-CMD calibration insight from user-engagement patterns |
| 4 | `synthesize-entity-narratives/index.ts:234` | `ent.client_id ?? null` (the only client-aware writer) | the 115 `entity_narrative` rows for Petronas Canada |

### Verified content character of NULL rows

Sampled 8 random NULL rows. All read as generic tradecraft:

> "Lessons learned from historical conflicts, such as the Vietnam War, emphasize the need for a comprehensive approach…" — ORACLE, tactical_insight
>
> "There is a tangible correlation between fluctuations in aluminum and copper spot prices and the incidences of infrastructure theft…" — SIM-COMMAND, pattern
>
> "Misdirection techniques, such as urban dry cleaning routes, are effective tactics for civilians to evade pursuers…" — MCM-ICS, tactical_insight

No tenant-identifying text in the sample. (But the sample is small; a comprehensive content-anonymization audit has never been performed — that's the INC-LEARN-CONTAM open work.)

### Mass-seed event

The earliest NULL row dates to **2026-03-23 19:27:54** — a one-shot population by 58 distinct agents over a short window. Continued writes through 2026-05-27. The seed event was almost certainly a knowledge-synthesizer initial run; the ongoing additions are recurring synthesis runs.

**Bottom line:** 99.3% NULL reflects intentional dual-purpose use of the table by emergent writer convention. No schema discipline enforces or documents the split.

---

## Q2 — Currently reachable in prod?

**Yes — reachable from 9 reader paths.** Not dormant.

---

## Q3 — Code paths reading `agent_beliefs` today

| Reader | Site | Scope filter | NULL rows reachable? |
|---|---|---|---|
| `dashboard-ai-assistant` | 10220 | `.in("client_id", tenantClientIds)` | **NO** — PostgREST IN excludes NULL |
| `agent-chat` | 703 | `.or("client_id.is.null,client_id.eq.<id>")` | **YES — explicit inclusion** |
| `generate-daily-briefing` | 78 | `.eq("client_id", clientId)` + `.neq("belief_type", "entity_narrative")` | NO (NULL excluded; entity_narrative excluded → effective zero) |
| `generate-daily-briefing` | 87 | `.eq("client_id", clientId)` + `.eq("belief_type", "entity_narrative")` | NO (NULL excluded; only Petronas matches) |
| `knowledge-synthesizer` | 146, 487, 507 | `.eq("agent_call_sign", callSign)` only | **YES** — no client filter |
| `academy-build-training` | 111 | `.eq("agent_call_sign", agentCallSign)` only | **YES** |
| `generate-academy-course` | 164 | `.eq("agent_call_sign", callSign)` only | **YES** |
| `get-login-summary` | 68, 77 | none (or `.gte("created_at", since)`) | **YES** |
| `synthesize-entity-narratives` | 115, 141, 204 | `.eq("belief_type", "entity_narrative")` | NO (the 115 owned subset only) |
| `decay-beliefs-from-calibration` | 103, 174 | `.eq("agent_call_sign", ...)` + confidence | **YES** |
| `system-watchdog` | 1476–1487, 2730 | count(*) or aggregated; data not surfaced | n/a (counts only) |
| `fortress-qa-agent` | 368 | `last_updated_at` only; no content | n/a (staleness check) |

---

## Q4 — Code paths writing today

The 4 writers above (Q1). Three of them write NULL client_id by intent. One writes client_id only for client-owned entities.

---

## Q5 — INC-LEARN-CONTAM suppression behavior

**Surface-specific and asymmetric.**

| Surface | Suppression of NULL rows | Suppression of cross-tenant client_id rows | Net behavior |
|---|---|---|---|
| `dashboard-ai-assistant` | **complete** (`.in()` excludes NULL) | **complete** (tenant-bounded `.in("client_id", tenantClientIds)`) | only own-tenant client_id-set beliefs reach the prompt |
| `agent-chat` | **none** (explicit `.or(client_id.is.null,…)`) | partial (`client_id.eq.<id>` excludes other clients but includes all NULL) | all global tradecraft + the chat's own client's beliefs |
| `generate-daily-briefing` | de-facto complete (no `IS NULL` matching path) | complete (`.eq("client_id", clientId)`) | typically zero rows (because the only client-set rows are excluded by the `belief_type` filter) |
| `knowledge-synthesizer` | none | none (`agent_call_sign` only) | all rows for that agent reachable |
| `academy-*` / `get-login-summary` / `decay-beliefs-from-calibration` | none | none | all rows reachable |

**The memory note "client-null branch suppressed" is accurate ONLY for `dashboard-ai-assistant`.** The platform's other consumers do not apply the same suppression.

---

## Q6 — % of Aegis responses currently using `agent_beliefs`

Last 7 days on prod:

| Surface | Invocations | Effective `agent_beliefs` rows reaching the prompt |
|---|---|---|
| `dashboard-ai-assistant` (Aegis chat) | 96 user turns | **0** for non-Petronas tenants; **77** (high-conf entity_narratives) for Petronas-tenant users |
| `agent-chat` (agent-to-agent) | 4 user turns | **up to 15** tradecraft beliefs per agent_call_sign, **per request** |
| `generate-daily-briefing` (cron, per-client) | ~7/day × N clients | **0 effective** for most clients (de-facto suppression); some entity_narratives for Petronas-only |
| Training surfaces (`academy-*`) | on-demand | up to 10 beliefs per agent_call_sign |
| `get-login-summary` (per analyst login) | per session | up to 5 high-confidence beliefs (no scope) |

**Effective answer:** Operator-facing Aegis chats use `agent_beliefs` ~0% (suppression makes it dormant). Agent-to-agent chats and training surfaces use them ~100% of the time. The "Aegis intelligence picture" the chat builds for executives is empty of agent beliefs for every tenant except Petronas Canada.

---

## Q7 — If suppression is working, how much intelligence is inaccessible?

**For operator-facing Aegis (`dashboard-ai-assistant`):** **15,418 tradecraft beliefs (99.3% of the table) are inaccessible.** That is effectively the entire body of agent-learned methodology, threat patterns, geographic risk knowledge, and best practices.

**For executive briefings (`generate-daily-briefing`):** same — effectively all of it is inaccessible.

**For agent-chat / training / login surfaces:** none of it is inaccessible.

The "intelligence inaccessibility" framing applies only to the **operator-facing** path. For that path, the answer is "approximately all of it." Whether that's the intended INC-LEARN-CONTAM containment outcome or an over-restriction is the question worth answering separately — the memory says the containment should restrict to "the caller-tenant's own client beliefs," which it does, but the practical effect is near-complete prompt-context loss for executive surfaces.

---

## Q8 — Bypass paths (i.e., paths where suppression is not applied)

| Path | Site | Bypass shape |
|---|---|---|
| `agent-chat` | 703 | explicit `.or("client_id.is.null, client_id.eq.<id>")` — by design |
| `knowledge-synthesizer` (self-updates) | 146, 487, 507 | `.eq("agent_call_sign", callSign)` only — reads any client_id |
| `academy-build-training` | 111 | `.eq("agent_call_sign", …)` only |
| `generate-academy-course` | 164 | `.eq("agent_call_sign", …)` only |
| `get-login-summary` | 68, 77 | no scope (and no `.eq("client_id", …)`) — read globally |
| `decay-beliefs-from-calibration` | 103, 174 | `.eq("agent_call_sign", …)` + confidence; no client filter |
| `synthesize-entity-narratives` (existence check) | 115, 141, 204, 216, 227 | belief_type+name; no client filter on the lookup |

Six functions can read NULL-owner beliefs freely. `agent-chat` is the only one that does so by explicit design (the comment says: *"Show global beliefs (client_id IS NULL) plus beliefs specific to this client"*). The other 5 simply omit the client filter and inherit the read because service-role bypasses RLS.

---

## Verdict — (C) both

**(A) Dormant?** Partially. For the operator-facing executive Aegis surface, yes — 99.3% suppressed, near-zero injection rate.

**(B) Contamination risk?** Partially. For agent-chat and the 5 internal paths, yes — all 15,418 NULL beliefs are pulled in, with no platform-wide guarantee that those beliefs are tenant-fact-free. The sampled rows look generic, but no anonymization gate verifies this at write time, and the writer that produces most NULL rows (`knowledge-synthesizer:197`) does not even inspect content for tenant identifiers.

**(C) Both — but on different surfaces.** This is the most useful framing:

- The **executive Aegis** surface treats `agent_beliefs` as **untrusted-by-default** (NULL suppression) and as a result has no access to the platform's learned tradecraft. That's a *capability deficit*, not a contamination risk.
- The **agent-mesh / training / login** surfaces treat `agent_beliefs` as **trusted-shared-pool** and rely on writer discipline (which is unaudited) to keep NULL rows tenant-fact-free. That's a *contamination risk*, not a capability deficit.

The single table serves both regimes simultaneously with no schema enforcement of the split. The duality is the bug class.

---

## What this audit does NOT do

- Does not propose any fix.
- Does not anonymization-audit the 15,418 NULL rows for actual tenant-identifier leakage. The sampled 8 are clean; the population is unaudited.
- Does not assess the analogous behavior of `agent_debate_records` (90.5% NULL) — which has the same dual-purpose risk per the earlier class inventory.
- Does not propose schema separation (e.g., split `agent_beliefs` into `agent_tradecraft_beliefs` global + `agent_client_beliefs` tenant-scoped). That's a Class B schema change, held alongside PR #36.
- Does not assess whether the executive Aegis's capability deficit (99.3% of learned intelligence unreachable) is the intended INC-LEARN-CONTAM outcome or an unintended over-restriction.

## Questions surfaced for operator direction (no fixes started)

1. **Is the operator-facing Aegis's 0% effective use of tradecraft beliefs the intended outcome of INC-LEARN-CONTAM containment, or a side effect to be addressed?** If intended, the table's tradecraft half is permanently dormant for the most important surface. If unintended, a tradecraft-aware retrieval surface needs to be built (with content anonymization gate at write time per the open INC-LEARN-CONTAM remediation plan).
2. **Should the agent-chat / training / login surfaces' tradecraft access continue under current scoping, or should the same "no NULL by default" discipline be extended to them?** Today they're trusted by writer discipline alone.
3. **Should `agent_beliefs` schema be split** along the dual-purpose lines (tradecraft global · entity_narrative tenant-scoped)? That's the Class B / schema work currently held alongside PR #36.
4. **Should the analogous `agent_debate_records` 90.5%-NULL pattern be audited next?** Same class of problem.
