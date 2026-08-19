# WO-LONGTAIL-COVERAGE-01 — Google organic under-surfaces long-tail reputational exposure

**Status:** OPEN — logged, NOT resolved, NOT a blocker. 2026-08-19.

## The limitation
Serper.dev returns **Google organic**, which ranks authoritative sources UP (newspapers, LinkedIn, official records) and long-tail personal blogs / forums / obscure sites DOWN. Empirically: `christopherdiarmani.com`'s page on the Kilback case **exists and is reachable**, but Serper does not surface it (`site:christopherdiarmani.com Kilback` → 0 on Serper; the distinctive quote surfaces the Vancouver Sun instead). A different backend (the Claude Code WebSearch tool, likely Bing) *did* rank christopherdiarmani.

## Why it matters
**For reputational exposure, the ugly material often sits on small blogs, forums, and obscure sites — not newspapers.** A principal usually already knows about the newspaper coverage; the thing they most need to find (per the PRODUCT STANDARD — "a finding they already knew is not a finding") is the buried forum thread or personal-blog repost they've never seen. **Google organic may systematically under-surface exactly the highest-value class of finding.** This is in direct tension with the obscurity-is-a-value-signal ranking (PS2): the tool's index bias fights the product's value model.

## To test later (mitigation candidates)
- Run the same 3-query acceptance harness against **Brave Search API** and **Bing Web Search API**; compare long-tail recall (do they surface christopherdiarmani + forum/small-blog content Serper misses?).
- If they do, a **multi-provider union** (Serper for authoritative + Brave/Bing for long-tail, deduped/clustered) is likely the answer — the `searchProvider()` abstraction (`_shared/subject-retrieval.ts`) already isolates this to one function; a union is a new case + a merge.
- Cost stays negligible (each provider ~$1–15/1000; a union of 2–3 providers per scan is still ~$2–5).

Cross-ref: `docs/platform-operations/specs/vip-reputational-retrieval-design.md` (acceptance test + PS2 obscurity ranking); `_shared/subject-retrieval.ts` `searchProvider()`.
