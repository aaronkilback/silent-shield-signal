# Model Provider Data Handling — Verified Terms (2026-07-09)

> **Re-verification cadence: quarterly. Next review: October 2026.** Providers change terms without notice; re-verify before any client contract execution.

Companion to ops/inventories/PRIORITY1-MODEL-DATA-EGRESS-2026-07-09.md. That inventory records what leaves Fortress and to whom; this document records what each provider does with it, per their current published terms. Together they form the factual basis of the client-facing governance one-pager. Terms verified July 9, 2026 against provider documentation. Providers change terms; re-verify quarterly and before any client contract execution.

## Summary

| Provider | Trains on API data? | Default retention | ZDR available? | Fortress exposure |
|---|---|---|---|---|
| OpenAI | No (default) | 30 days, BUT see legal hold | Yes, on approval | Dominant: workhorse, vision, judgment tier, embeddings, voice. Heaviest sensitive egress. |
| Google Gemini | No on PAID tier. YES on free tier, incl. human review | Limited-period abuse logging (paid) | Yes, on approval | Doc OCR and image analysis — uploaded client documents. TIER VERIFIED PAID 2026-07-09 (gen-lang-client-0624925628, Tier 2 · Postpay). |
| Perplexity | No | Zero — ZDR by default | Built in | OSINT, live web, travel, tech radar. |
| Anthropic | No (Commercial Terms) | Deleted within 30 days | Yes, per-org on approval | wraith-security-advisor only (Opus 4.6, Haiku 4.5) — receives edge-function source code. |

## OpenAI

API inputs and outputs are not used for training by default under OpenAI's enterprise privacy commitments. Standard retention is up to 30 days for abuse monitoring, then deletion, with access limited to authorized employees and bound contractors. SOC 2 Type 2, AES-256 at rest, TLS 1.2+ in transit.

**Active caveat — litigation hold.** A court order in the New York Times case currently requires OpenAI to preserve consumer and API content beyond its standard deletion schedule. OpenAI is challenging the order. Customers with Zero Data Retention agreements are exempt; standard API customers are not. Practical effect for Fortress today: effective retention on our OpenAI traffic is indefinite pending litigation, not 30 days.

**Implication.** OpenAI carries our most sensitive egress (VIP PII + HIBP breach data, travel itineraries, client profiles and assets, uploaded documents). Two remediation paths: (a) pursue a ZDR agreement with OpenAI covering the sensitive-egress endpoints, or (b) route sensitive-egress workflows to a provider with stronger default posture. This decision belongs in the model-routing work order.

## Google Gemini

The controlling document is the Gemini API Additional Terms of Service, and everything turns on paid vs. unpaid status:

**Paid Services** (API accessed through a Cloud Project with an active billing account): Google does not use prompts, system instructions, cached content, files, or responses to improve its products. Processing falls under the Data Processing Addendum. Prompts and responses are logged for a limited period solely for abuse detection and legal compliance.

**Unpaid Services** (free AI Studio quota, unpaid API quota): Google uses submitted content and responses to provide, improve, and develop Google products and machine-learning technologies, and human reviewers may read, annotate, and process API input and output.

**VERIFICATION — RESOLVED / CLEAR (2026-07-09).** The GEMINI_API_KEY in Supabase Vault belongs to a **billing-enabled (paid) Cloud Project**, so Paid Services terms apply: no training, no human review, DPA governs. Evidence:
- Google AI Studio API-keys page shows all keys on project **gen-lang-client-0624925628**, Billing Tier **"My Billing Account — Tier 2 · Postpay"** (paid, postpay), including keys **Fortress** (`…Oc-8`) and **fortress-staging** (`…097k`).
- The prod Supabase Vault `GEMINI_API_KEY` value ends `…Oc-8`, matching the paid **Fortress** key. (len 39, `AIza…` format.)
- Conclusion: uploaded client document content sent to Gemini (via `fortress-document-converter` vision OCR) is under Paid Services terms — **not** eligible for Google human review or product-improvement training. No rotation required.

*(Original blocking concern retained for the record: had the key been free-tier / unpaid AI Studio quota, client document content would have been contractually eligible for human review and product improvement at Google, requiring immediate rotation to a paid-project key.)*

Additional notes: ZDR is available on approval per project. Grounding with Google Search, if ever enabled, carries mandatory 30-day storage that cannot be disabled — do not enable it on sensitive workflows.

## Perplexity (Sonar API)

Strongest default posture of the four. Perplexity maintains zero data retention on the Sonar API: prompts and responses are not stored, are not used for training, and the only data collected is billing metadata (request counts, API key identification) containing no content. SOC 2 Type II. Compute runs on AWS in North America; no on-prem or private-cloud option exists.

Consumer-side Perplexity controversies (tracking allegations, consumer training defaults) concern the consumer product, not the Sonar API, which operates under separate processor terms. No action required. Suitable as-is for the OSINT, live-web, travel, and tech-radar workflows it currently serves.

## Anthropic

Commercial Terms govern API usage: Anthropic does not train models on customer content. API inputs and outputs are automatically deleted within 30 days of receipt, except for longer-retention features under customer control, Usage Policy enforcement, or a ZDR agreement. ZDR is available on approval, applied per organization; under ZDR, Anthropic still retains User Safety classifier results for policy enforcement. ISO 27001, ISO 42001, SOC 2 Type I & II. DPA with SCCs incorporated into Commercial Terms.

**Covered Models note.** Claude Fable 5 and Claude Mythos 5 are designated Covered Models requiring 30-day retention as part of Anthropic's safety obligations; ZDR is not available for them. Fortress currently uses Opus 4.6 and Haiku 4.5 (wraith-security-advisor only), which are not Covered Models. If the routing WO ever considers Fable-class models, this retention requirement is a selection criterion.

**Exposure note.** Our Anthropic traffic is edge-function source code sent by WRAITH for security analysis. Under Commercial Terms this is not trained on and is deleted within 30 days. Acceptable posture; ZDR optional hardening.

## Actions

1. ~~BLOCKING: verify Gemini key billing status. If free-tier, rotate to a paid-project key immediately and record the finding.~~ **DONE / CLEAR 2026-07-09** — key is paid (project gen-lang-client-0624925628, Tier 2 · Postpay; vault key `…Oc-8` = Fortress). No rotation required.
2. Routing WO input: OpenAI litigation hold means sensitive-egress workflows need either an OpenAI ZDR agreement or re-routing. Decide deliberately, per workflow.
3. Client-facing language (for the one-pager): "Fortress sends narrow, task-scoped requests to commercial AI APIs under terms that prohibit training on our data. The intelligence itself — client risk profiles, signal history, outcomes — resides exclusively in Fortress infrastructure. Provider terms are re-verified quarterly."
4. Quarterly re-verification cadence: add to the ledger with an October 2026 review date.

## Sources

OpenAI enterprise privacy page and platform data-controls documentation; OpenAI statement on NYT data demands. Gemini API Additional Terms of Service (ai.google.dev/gemini-api/terms); Gemini API ZDR documentation. Perplexity API privacy and security documentation (docs.perplexity.ai). Anthropic Claude Platform API and data retention documentation (platform.claude.com); Anthropic Privacy Center commercial retention articles.
