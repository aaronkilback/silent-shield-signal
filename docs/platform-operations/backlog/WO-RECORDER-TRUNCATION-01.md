# WO-RECORDER-TRUNCATION-01 — Flight recorder silently drops the prompt tail

**Status:** LOGGED, not started. Awaiting operator prioritization.
**Provenance:** WO-PROMPT-ROSTER-01 live-verification attempt, 2026-08-12. Trying to grep a live `aegis_prompt_trace` capture for the client roster, the stored `system_prompt` was found to end in `…[TRUNCATED]` at 16,011 chars with the entire roster region absent.

## The defect
`_shared/flight-recorder.ts` caps **every** stored string field at `MAX_FIELD = 16_000` chars (`redactDeep`, line 90: `v.length > MAX_FIELD ? redactStr(v.slice(0, MAX_FIELD)) + "…[TRUNCATED]"`). Dashboard-ai-assistant system prompts routinely exceed this (the COP block alone is ~10 KB; a full prompt runs well past 16 KB). The client-roster region sits at the **tail** of the assembled prompt (after COP / agent-roster / agent-intelligence blocks), so **it is past the cap in the normal case**. Consequence: the recorder — the tool built specifically to capture prompts for forensic replay — has **never stored the tail of any prompt long enough to be truncated.** The stored `system_prompt` is a prefix, not the prompt. (`system_prompt_sha256` is computed over the full untruncated prompt, so the hash is faithful even though the stored text is not — a fingerprint without the document.)

## Two consequences to establish (this WO's scope)
1. **How much of every historical capture is missing.** Quantify: of all `aegis_prompt_trace` rows, how many hit the 16 KB cap (`system_prompt LIKE '%…[TRUNCATED]'`), and estimate the dropped tail size (full length is unknown post-truncation — may need a bounded re-capture to characterize). Establish which prompt sections systematically fall past the cap (roster, capabilities, anti-fabrication rules, tool guidance).
2. **Whether this contributed to INC-CTX-CONTAM's misdiagnosis.** The 2026-05-27 forensic examined seven retrieval surfaces and never the prompt (see [[WO-FORENSIC-SURFACE-COMPLETENESS-01]]). But even had it opened the flight recorder, the recorder was **silently dropping the exact region the leaked phrase lived in** (the `ACTIVE CLIENTS` roster in the template tail). If the prompt-capture tool could not have shown the phrase, that is part of the causal chain of the misdiagnosis — a second, compounding blind spot on top of "the forensic didn't look." Confirm the roster region was past the cap in the 05-03→05-27 CRT captures.

## Fix options (scope, do NOT decide now)
- **Raise the cap** for `system_prompt` specifically (or globally) — simplest, costs storage; pick a bound that fits real prompt sizes with margin.
- **Log the roster region as its own small context block** — capture the client-context slice (and other tail-critical sections) as dedicated short fields immune to the whole-prompt cap, so forensic replay always has the isolation-relevant region even if the body is truncated.

## Acceptance criterion (single)
Historical-truncation extent quantified AND the INC-CTX-CONTAM causal-chain question answered yes/no with evidence; a fix option chosen and the roster (isolation-relevant) region provably captured in full on a fresh session. One WO, one problem: the recorder's fidelity for isolation-relevant prompt regions.

## Related
[[WO-PROMPT-ROSTER-01]] (the fix whose live verification exposed this) · [[WO-FORENSIC-SURFACE-COMPLETENESS-01]] (the forensic never checked the prompt; this WO is why checking it might not have helped) · INC-CTX-CONTAM §9. Same family as `feedback-negative-finding-needs-complete-search`: a capture that silently drops a region turns every "not in the prompt" into an unprovable claim.
