# Aegis Capability Registry

**Task #175 · 2026-06-01** · Operator-facing reference for the capability registry deployed to staging in `dashboard-ai-assistant`. Source of truth: `supabase/functions/_shared/aegis-capability-registry.ts`.

Principle (operator-ratified 2026-06-01):
> *"Fortress must never imply a capability exists when it does not. Absence of findings is not the same as absence of capability."*

The registry sits **one layer above Coverage Confidence**. If a question targets a NOT_OPERATIONAL capability, Coverage Confidence is moot — the response uses the capability's `required_language` instead.

---

## §0 — How it works

1. **System prompt always carries the full registry** (every Aegis chat session sees the operational + partial + not-operational lists with their required language).
2. **Per-question detection** runs server-side on the user's latest message. If keywords match a capability, a **focused per-question warning** is injected at high prompt priority — Aegis MUST emit the `required_language` for the first NOT_OPERATIONAL match.
3. **Defense in depth**: both layers fire. LLM-side instruction + server-side keyword detection. The keyword detector also logs the matched capability to console + Flight Recorder.

---

## §1 — NOT_OPERATIONAL (7 capabilities)

These capabilities do **not** exist in production today. Aegis must refuse with the `required_language` rather than imply they searched and found nothing.

### Account Cycling Detection
- **Status**: NOT_OPERATIONAL
- **Description**: Detection of single actor controlling multiple new accounts to evade bans / rate limits / takedowns
- **Supported questions**: NONE
- **Unsupported questions (samples)**: *"Has any threat actor been cycling between accounts?"* · *"Is this banned user reappearing under a new identity?"*
- **Required language**: *"Account Cycling Detection is not yet operational. Fortress cannot detect cycling activity at this time. This capability is on the roadmap (CRT Tier B) but requires social acquisition and Entity Resolution prerequisites. Note: this is a capability gap, not an absence of findings — Fortress is not yet able to look."*
- **Roadmap**: Task #154 §1; Task #173 #9

### Image Recognition / Suspect Identification
- **Status**: NOT_OPERATIONAL
- **Description**: Face matching against CRT-curated ban list or entity-photos
- **Supported questions**: NONE
- **Unsupported questions**: *"Is this person in the photo on our ban list?"* · *"Run face matching on this image."*
- **Required language**: *"Image Recognition is not yet operational. Fortress cannot perform face matching at this time. This capability requires a Legal Authorization Surface and a pre-deployment bias audit as hard gates."*
- **Roadmap**: Task #154 §2; Task #173 #10

### Historical Reconstruction (defensible timeline)
- **Status**: NOT_OPERATIONAL
- **Description**: Defensible chronology of past events with original-content evidence
- **Supported questions**: NONE (Aegis can summarize past signals as a best-effort summary, but not produce a defensible reconstruction)
- **Unsupported questions**: *"Reconstruct what happened at the BC Place protest in 2022."* · *"Build a defensible timeline since date X."*
- **Required language**: *"Defensible Historical Reconstruction is not yet operational. Fortress can summarize available signals about a past event, but cannot produce a defensible chronological reconstruction at this time. This is a compound capability that depends on Temporal Integrity (T-3 chain), Information Fidelity (snapshotting), Flight Recorder coverage expansion, and Entity Resolution — all currently held or not yet built."*
- **Roadmap**: Task #156 Tier A; Task #173 #11

### Cross-Platform Entity Resolution
- **Status**: NOT_OPERATIONAL
- **Description**: Automated linking of same actor across platforms / aliases
- **Supported questions**: NONE (Aegis can show operator-curated `entity_relationships` — currently a sparse 35-row graph)
- **Unsupported questions**: *"Is this Twitter account the same person as this Reddit user?"* · *"Resolve identity X."*
- **Required language**: *"Cross-platform Entity Resolution is not yet operational. Fortress can show operator-curated entity relationships (currently a sparse graph) but cannot automatically link accounts across platforms."*
- **Roadmap**: Task #154 §1.3; Task #173 #8

### Trajectory Analysis
- **Status**: NOT_OPERATIONAL
- **Description**: Behavioral-change-over-time detection with defensible escalation / de-escalation / stability claims
- **Supported questions**: NONE
- **Unsupported questions**: *"What is the escalation probability?"* · *"Is this becoming more dangerous?"* · *"Show me the trajectory."*
- **Required language**: *"Trajectory Analysis is not yet operational at defensible coverage. Fortress can report point-in-time signal severity but cannot produce defensible trajectory or escalation-probability claims. Per-entity behavioral baselines are not yet computed."*
- **Roadmap**: Task #156 Tier A; Task #173 #11

### Original-Content Snapshotting
- **Status**: NOT_OPERATIONAL
- **Description**: At-acquisition snapshot of source content
- **Required language**: *"Original-Content Snapshotting is not yet operational. Fortress preserves source URLs but does NOT snapshot the content at acquisition time. URLs may decay or change between acquisition and review."*
- **Roadmap**: Task #157 §9; Task #173 #7

### Image Content Extraction (OCR / description / vectors)
- **Status**: NOT_OPERATIONAL
- **Description**: OCR + description + face vectors from image content
- **Required language**: *"Image Content Extraction is not yet operational. Fortress preserves image URLs but does not extract image content."*
- **Roadmap**: Task #157 §1; Task #154 §2 prereq

---

## §2 — PARTIAL (4 capabilities)

These exist in some form but with significant limitations Aegis must disclose.

### Social Intelligence Collection
- **Status**: PARTIAL
- **Supported**: News-via-CSE that references social content; community local news; RSS feeds
- **Unsupported**: Direct X / Reddit / Discord / Telegram / TikTok collection
- **Required disclosure**: *"Direct Social Media Collection is currently limited. X (Twitter) is retired (budget); Meta (Facebook/Instagram) is currently offline (token reactivation pending); Instagram CSE path produces zero yield; Reddit, Discord, Telegram, and TikTok are not collected. When a question requires social context, Fortress will NOTE the explicit collection gap."*
- **Roadmap**: Task #167 #2 (Meta reactivation); Task #173 #3

### Threat Attribution (automatic)
- **Status**: PARTIAL
- **Supported**: Operator-curated entity links on signals; entity_relationships lookup
- **Unsupported**: Automatic attribution from content alone
- **Required disclosure**: *"Automated Threat Attribution is partial. Fortress can show operator-curated entity links but cannot automatically attribute threats to specific actors based on content alone."*

### Executive Threat Assessment
- **Status**: PARTIAL
- **Supported**: Per-entity current-state risk profile; signal feed; current risk_level enum
- **Unsupported**: Defensible-trajectory claims; cross-platform breach context
- **Required disclosure**: *"Executive Threat Assessment provides current-state signal context and operator-curated risk profiles. It does NOT produce trajectory predictions or behavioral-change claims (Trajectory Analysis is not yet operational)."*
- **Roadmap**: Existing `assess-entity`; Task #168 §1.6

### Evidence Package Generation
- **Status**: PARTIAL
- **Supported**: POI reports with STRICT SOURCING; cited-source compilation
- **Unsupported**: Snapshot-verified evidence; Workstream D claim-frames in default rendering (feature-flag dark); legally-defensible chain-of-custody
- **Required disclosure**: *"Evidence Package Generation produces cited-source POI reports. Original-content snapshots are NOT preserved (URLs may decay). For legal/insurance use, additional independent verification is recommended."*
- **Roadmap**: Existing `generate-poi-report`; Task #168 §1.3

---

## §3 — OPERATIONAL (2 capabilities)

These are healthy and can answer reliably for their supported question set. Aegis may use them freely with standard Coverage Confidence.

### Signal Feed Retrieval (tenant-scoped, last 7d)
- Tenant-scoped signal feed lookup
- Supported: *"What signals this week?"* · *"Recent high-severity signals?"*

### Entity Profile Lookup
- Per-entity attributes, risk_level, recent activity, operator-curated relationships
- Supported: *"What do we know about entity X?"* · *"Show me the profile for principal Y."*

---

## §4 — How Aegis is instructed (prompt-side)

Every chat session now includes (in priority order):

1. **Per-question capability warning** (only when keywords match) — fires at high priority above the registry; emits required_language to use verbatim
2. **Full Capability Registry** — listed by status with all required_language strings
3. **Coverage Confidence block** — only consulted if no NOT_OPERATIONAL capability was targeted

Aegis is explicitly instructed:
> *"Specifically: do NOT say 'no signals indicating \<X\>' if the capability to detect \<X\> does not exist. That phrasing falsely implies Fortress searched and found nothing. The truth is Fortress is not yet able to look."*

---

## §5 — Validation gate

The operator-named validation requirement remains:

> *"Does Fortress understand the difference between (1) a capability exists and produced no findings (2) a capability does not exist and therefore cannot produce findings?"*

To validate on staging, re-run the test scenarios from the original test plan with particular attention to:

| Scenario | Expected behavior |
|---|---|
| 4. Account cycling question | Aegis emits Account Cycling Detection required_language. Does NOT say "no signals indicating cycling." |
| 5. Reconstruction-style question | Aegis emits Historical Reconstruction required_language for the defensible-timeline ask. Best-effort summary acceptable but explicitly framed as such. |
| 7. Unknown vs Unknowable (private DMs) | Aegis emits Unknowable framing per Communication Doctrine; the capability registry doesn't add anything because the question is not about a Fortress capability — it's about an inherent epistemic limit. |
| 3. BC Place 2022 historical | If framed as "reconstruct," capability registry fires (Historical Reconstruction NOT_OPERATIONAL). If framed as "summarize what we know," operational signal-feed retrieval applies + Coverage Confidence. |
| Image / face matching question | Aegis emits Image Recognition required_language; refuses to claim it ran face matching. |
| Trajectory / escalation question | Aegis emits Trajectory Analysis required_language; refuses to emit numeric probability. |

---

## §6 — Honest limits

1. **Detection is keyword-based, not semantic.** A question that doesn't use the registered keywords may slip through. Server-side detection is defense-in-depth; the LLM-side instruction is the primary guard.
2. **Keyword false positives possible.** *"What's the trajectory of the conversation"* (English idiom) could falsely match Trajectory Analysis. Mitigation: keywords are tuned to capability-context phrasings; false positives can be reviewed in console logs.
3. **PARTIAL capability disclosure is the LLM's job.** Server-side per-question warning fires; LLM is expected to weave the disclosure into the response. If the LLM omits the disclosure, that's a future enforcement gap (server-side post-emission scanner not yet wired).
4. **Registry contents are static.** Status changes require code-side PR. This is by design (auditable changes) but means the registry can drift from operational reality if forgotten. Roadmap-ref fields point operators to the source documents.
5. **The registry does NOT yet enforce post-emission.** If the LLM ignores both prompt-block and per-question warning and emits "no signals indicating cycling," server-side post-stream scanning would catch it — that's the next slim slice if validation reveals LLM non-compliance.
6. **No customer-validated language yet.** The `required_language` strings are operator-named principle + my drafting; customer-validated phrasing may differ.

---

## §7 — Operator decision surface

**Zero new decisions proposed today.** The registry is shipped to staging.

| Active item | Status |
|---|---|
| Capability Registry deployed to staging | **Live** |
| Coverage Confidence slim slice deployed to staging | **Live** |
| Operator re-test of staging scenarios | **Pending operator** |
| Prod merge | HELD pending operator-validated staging usefulness |

Standing by for operator re-test of the 7+ staging scenarios. Particular focus on whether Aegis:
- Emits `required_language` for NOT_OPERATIONAL capabilities (e.g., Account Cycling)
- Discloses PARTIAL limitations for Social Intelligence Collection / Threat Attribution / etc.
- Refuses opaque numeric scores (Trajectory probability) replaced by required-language refusal

🤖 Generated with [Claude Code](https://claude.com/claude-code)
