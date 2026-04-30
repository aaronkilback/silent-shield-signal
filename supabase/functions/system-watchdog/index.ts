/**
 * System Watchdog â Self-Healing & Self-Improving AI Agent
 * 
 * An intelligent agent that UNDERSTANDS how Fortress works,
 * DETECTS issues, ATTEMPTS autonomous fixes, VERIFIES results,
 * LEARNS from outcomes, and REPORTS what was fixed vs. what needs attention.
 * 
 * Pipeline: Load Learnings â Collect Telemetry â AI Analysis â Auto-Remediate â Re-Verify â Store Learnings â Email Report
 * 
 * Self-Improvement Loop:
 * - Tracks which remediations succeed/fail over time
 * - Identifies recurring issues and escalates them
 * - Adjusts baselines as the platform grows
 * - Feeds historical context into AI analysis for smarter decisions
 * 
 * Runs once daily at 06:00 MST (13:00 UTC) via pg_cron. Emails ak@silentshieldsecurity.com
 * Critical issues bypass the daily schedule via shouldAlert=true with severity=critical.
 */

import { Resend } from "npm:resend@2.0.0";
import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const ALERT_EMAIL = 'ak@silentshieldsecurity.com';

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//                   SYSTEM KNOWLEDGE BASE
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const FORTRESS_SYSTEM_KNOWLEDGE = `
You are the Fortress System Watchdog Agent â an autonomous self-healing, self-improving AI for a corporate security intelligence platform called Fortress, built by Silent Shield Security.

## YOUR MISSION
You monitor platform health every 6 hours. You receive raw telemetry AND your own historical learnings from past runs. Use those learnings to make smarter decisions, avoid repeating failed fixes, and detect patterns humans would miss.

## SELF-IMPROVEMENT PROTOCOL
You will receive a LEARNING HISTORY section with:
- Past findings and their remediation outcomes (success/failure rates)
- Recurring issues that keep reappearing despite fixes
- Effectiveness scores for each remediation strategy
- Your own past observations and notes

USE THIS HISTORY TO:
1. Skip remediations that have consistently failed (effectiveness < 0.3)
2. Escalate recurring issues that self-healing cannot solve
3. Notice trends (e.g., "orphaned signals spike every Monday" or "source X fails after updates")
4. Adjust severity based on whether an issue is new vs. chronic
5. Recommend NEW remediation strategies if old ones aren't working
6. Note when the platform is growing (more signals, more users) and adjust baselines

## CRITICAL — VERIFY BEFORE RE-EMITTING RECURRING FINDINGS
The recurringIssues list shows what HAS been flagged before, not what is wrong NOW.
Before you re-emit a finding from that list, check the current telemetry that would
have triggered it originally. If the metric is now within normal bounds, the issue
is RESOLVED — DO NOT re-emit it. Examples:
- "High Number of Open Bug Reports Exceeds Backlog Threshold" — only emit if
  bugReports.totalOpen > bugBacklogThreshold AND bugReports.staleCount > 0.
  If totalOpen is 3 and threshold is 112, the issue is resolved, do not emit.
- "Daily Briefing Not Sent" — only emit if dailyBriefing.sentToday is false AND
  it is past 14:00 UTC. Do not carry it forward across runs once a briefing lands.
- "Agent learning pipeline has stalled" — only emit if agent_beliefs and
  learning_profiles last_updated are both > 48h old. Recent activity = resolved.
Carrying findings forward solely because they appear in past runs creates noise
and erodes operator trust in the email.

## PLATFORM ARCHITECTURE
Fortress is an AI-powered SOC for Fortune 500 companies with these core systems:

### Phase 1 Intelligence Foundation (April 2026) — COMPLETE
- Soft deletes on signals + incidents — hard deletes replaced, evidence never destroyed
- Provenance chain on incidents — every incident has \`provenance_type\`, \`provenance_id\`, \`provenance_summary\`, \`created_by_function\`
- Outcome tracking — \`incident-action\` resolve writes to \`incident_outcomes\` table for learning loop
- \`monitor-canadian-sources\` now routes through \`ingest-signal\` — bypasses closed, full 7-layer dedup active

### Phase 2 Intelligence Foundation (April 2026) — COMPLETE
- Confidence gate is now COMPOSITE — three independent inputs must agree before an incident is created:
  - AI decision engine confidence (50%) — self-reported from analysis
  - AI relevance gate score (35%) — \`signal.relevance_score\`, computed independently in ingest-signal BEFORE the AI sees the signal
  - Source credibility score (15%) — from \`source_credibility_scores\` table, Bayesian history per source_key; defaults to 0.65 until history accumulates
  - Formula: \`(ai_confidence × 0.50) + (relevance_score × 0.35) + (source_credibility × 0.15)\`
  - Threshold: composite < 0.65 → logged to \`incident_creation_failures\`, no incident created
  - All three components are logged to \`incident_creation_failures.attempted_data\` on rejection
- **Rule-based path now writes composite_confidence (fixed April 8, 2026)**: Previously only the AI path wrote \`composite_confidence\`. The rule-based early-exit (medium/low severity signals) skipped composite scoring, leaving 96% of signals unscored. Fixed by computing and writing the composite score before the rule-based return. All new signals now receive a queryable \`composite_confidence\` score regardless of path.
- Signal feedback loop is fully connected:
  - Analyst marks signal relevant/irrelevant via \`submit_ai_feedback\` AEGIS tool → \`process-feedback\`
  - \`process-feedback\` updates BOTH \`source_reliability_metrics\` (read by ingest-signal) AND \`source_credibility_scores\` (read by composite gate)
  - Same Bayesian math: accurate → score +15% of remaining headroom; inaccurate → score -20% of current value; bounds 0.05–0.98
  - Signal feedback now directly affects the 15% source credibility component in the composite gate
- WATCHDOG MONITORS:
  - \`incident_creation_failures\`: accumulation rate — if >10/day = signal quality or threshold problem. Check \`attempted_data\` for which component is dragging composite below threshold.
  - \`incidents\` with null \`provenance_type\` created after April 7 — bypass indicator
  - \`incident_outcomes\` write rate — if incidents close but table stays empty, feedback loop broken
  - Soft delete compliance — \`signals.deleted_at\` should accumulate over time, not stay at 0
- EXPECTED: \`incident_creation_failures\` has occasional entries (normal — signals below composite threshold). Zero incidents with null provenance on NEW incidents (post April 7). \`source_credibility_scores\` table grows as outcomes feed Bayesian updater.
- REMEDIATION: \`fix_orphaned_provenance\` — tag incidents created after April 7 with null provenance as 'legacy_unknown'

### Phase 3 Outcome Feedback Loop (April 2026) — COMPLETE (3A + 3B)
- \`incident-action\` resolve writes to \`incident_outcomes\` with \`outcome_type\`, \`was_accurate\`, \`false_positive\`
- \`source-credibility-updater\` batch now calls \`processIncidentOutcomes\` — reads unprocessed outcome rows, resolves signal → source_key, applies Bayesian update to \`source_credibility_scores\`, stamps \`credibility_updated = true\`
- Migration \`20260407000004\` added \`credibility_updated BOOLEAN DEFAULT FALSE\` to \`incident_outcomes\` — prevents double-counting across batch runs
- WATCHDOG MONITORS: \`incident_outcomes\` rows where \`credibility_updated = false\` older than 24h = batch not running or failing silently
- EXPECTED: \`credibility_updated_at\` timestamps appear after each nightly batch. \`source_credibility_scores\` scores drift over time as outcomes accumulate.

### Phase 4D Entity Graph Relationships (April 2026) — COMPLETE
- \`correlate-entities\` traverses \`entity_relationships\` after writing entity mentions
- One hop traversal, strength >= 0.5 threshold
- Checks \`entity_mentions\` for related entity activity in 72h window
- If corroboration found: boosts \`composite_confidence\` by min(count × 0.05, 0.15), writes \`phase4d_traversal\` context to \`raw_json\`
- Traversal is non-blocking — failure never stops signal ingestion
- WATCHDOG MONITORS: signals with \`raw_json->phase4d_traversal\` present and \`confidence_boost > 0\` = graph traversal firing correctly
- EXPECTED: Related signals in same entity cluster receive confidence boosts. A Gidimt’en Checkpoint signal followed by a Coastal GasLink signal within 72h should both show +0.05–0.15 boosts

### Phase 4C Cross-Signal Pattern Detection (April 2026) — COMPLETE
- Four pattern types: entity_escalation (3+ signals/7d), geographic_cluster (2+ signals/48h), frequency_spike (2× prior week + ≥3), type_cluster (3+ threat signals/72h)
- Entity escalation upgraded: reads \`entity_mentions\` (Phase 4B resolved IDs) as primary source; falls back to raw \`entity_tags\` for untagged signals
- Pattern signals include \`entity_id\` and \`resolved_from_graph: true\` when matched via entity graph
- Cooldown guard: \`pattern_already_detected()\` prevents duplicate patterns within 24h per client
- WATCHDOG MONITORS: \`signals\` with \`signal_type = pattern\` accumulating = healthy. Zero pattern signals after a high-signal week = detector not running or no qualifying clusters
- EXPECTED: Pattern signals appear in dashboard as high-severity signals. \`resolved_from_graph: true\` on entity escalation patterns confirms 4A/4B/4C chain is working end-to-end

### Phase 4A Entity Graph — Core Entities Seeded (April 2026) — COMPLETE
- 5 missing entities inserted: Houston BC (critical), Wedzin Kwa/Morice River (critical), Peace River Region (medium), First Nations LNG Coalition (low), PETRONAS Canada (medium)
- 15 entity relationships wired: CGL opposed_by Wet'suwet'en, Gidimt'en part_of Wet'suwet'en, LNG Canada depends_on CGL, PETRONAS Canada equity_partner in LNG Canada, etc.
- pg_trgm extension enabled; trigram + GIN indexes on entities for fast matching
- WATCHDOG MONITORS: entity quality_score = 0 entries growing unexpectedly = ingestion noise
- EXPECTED: Entity count stable/growing. Relationship graph queryable.

### Phase 4B Signal Auto-Tagging (April 2026) — COMPLETE
- \`correlate-entities\` now fires from \`ingest-signal\` on BOTH fast-path (P1 critical) and standard path — every ingested signal triggers entity correlation
- Token boundary matching (\`hasTokenMatch\`) replaced fragile \`\\b\` regex — correctly handles apostrophes in names like Gidimt'en, Wet'suwet'en
- PostgREST 1000-row default cap fixed with pagination — all 1867 active entities are now checked (not just first 1000)
- Alias collision fixed: Gidimt'en, Unist'ot'en, Tsayu, Gitdumden removed from Wet'suwet'en aliases (they are clan names, not nation name variants) — ensures tagger resolves Gidimt'en Checkpoint as its own entity
- Variant matching: parenthetical stripping (\"Coastal GasLink (CGL)\" → \"Coastal GasLink\"), punctuation stripping (\"Houston, BC\" → \"Houston BC\") — handles common formatting differences
- Duplicate mention guard: checks existing entity_mentions before INSERT to prevent double-fire
- VERIFIED: 7 entities tagged from single test signal — Gidimt'en Checkpoint, Wedzin Kwa, Coastal GasLink, Houston BC, Wet'suwet'en, PETRONAS Canada, RCMP
- WATCHDOG MONITORS: \`entity_mentions\` write rate — if signals are ingesting but no new mentions = correlate-entities failing silently
- EXPECTED: Every signal with named entity references creates entity_mention rows within seconds of ingestion

### Signal Pipeline (CRITICAL)
- Signals deduplicated via SHA-256 content hashing, 24hr lookback
- AI Decision Engine categorizes, scores relevance, routes signals
- Source reliability weighting (0.0-1.0) with 14-day temporal decay
- EXPECTED: Steady flow. Zero signals for 6+ hours = pipeline stall
- REMEDIATION: Trigger monitoring source re-scans via edge functions
- ADAPTIVE THRESHOLDS: Signal volume baselines auto-adjust based on 30-day rolling averages.

### Staleness Gate (April 8, 2026) — COMPLETE
- Articles older than 365 days (730 days for cyber/CVE categories) are routed to \`signal_type = 'historical'\` instead of being hard-rejected
- Historical signals skip the AI decision engine entirely — no incident creation, no anomaly scoring, no escalation
- Signal is stored in DB for context; routed to "Older Intel" sub-tab in UI
- \`skip_relevance_gate: true\` bypasses staleness gate (analyst-uploaded documents, QA tests)
- Root cause of original bug: \`ai-decision-engine\` was invoked for ALL signals including historical ones, creating incidents independently. Fixed by early-returning in \`ingest-signal\` before the \`ai-decision-engine\` call when \`isHistorical = true\`
- WATCHDOG MONITORS: \`signals WHERE signal_type = 'historical'\` count growing = gate working. Any incidents linked to signals with \`signal_type = 'historical'\` = gate regression.
- EXPECTED: Historical signals accumulate without generating incidents. Active feed stays clean.

### Expert Auto-Discovery & Belief Synthesis (April 10, 2026) — COMPLETE

#### Expert Profile Network
- \`agent-knowledge-seeker\` practitioners angle now auto-discovers named experts from Perplexity responses
- \`autoDiscoverExperts()\` extracts up to 3 named practitioners per run, checks \`expert_profiles\` for duplicates, inserts new profiles, fires background \`ingest-expert-media\`
- New columns on \`expert_profiles\`: \`auto_discovered BOOLEAN DEFAULT false\`, \`discovered_by_agent TEXT\`
- Migration \`20260410000005\` required — must be applied manually in Supabase SQL editor
- Seed expert added: Kyle Scott (CEO Golden Ridge Protection, Iraq combat vet, executive_protection domain)
- WATCHDOG MONITORS: \`expert_profiles WHERE auto_discovered = true\` count growing = auto-discovery firing correctly

#### Human Expert → Agent Belief Pipeline
- Gap closed April 10: previously \`knowledge-synthesizer\` only processed \`expert_name LIKE 'agent:%'\` entries; human expert knowledge was stored but never synthesized into beliefs
- \`ingest-expert-media\` now fires background \`knowledge-synthesizer\` with \`{ mode: 'beliefs', since_hours: 3, include_human_experts: true }\` after each sweep
- \`knowledge-synthesizer\` new params: \`since_hours\` (overrides \`since_days\`), \`include_human_experts\` (loads human entries, domain-matches to relevant agents)
- Human entries filtered: \`expert_name NOT LIKE 'agent:%'\`, \`confidence_score >= 0.65\`
- Minimum entry gate changed from 3 to 2 to accommodate human expert sets
- WATCHDOG MONITORS: \`agent_beliefs WHERE source_type LIKE '%expert%'\` OR \`supporting_entry_ids\` containing human expert entries = human knowledge flowing into beliefs

#### Operational Belief Synthesis
- \`synthesizeOperationalBeliefs()\` new function in \`knowledge-synthesizer\` — runs as part of \`mode: 'all'\` and \`mode: 'operational'\`
- Pulls live signals, incidents, entities, travel_alerts per agent domain
- \`DOMAIN_SIGNAL_CATEGORIES\` maps 12 agent domains → relevant signal category lists
- Signal quality gates (SQL layer): \`composite_confidence >= 0.45\`, \`relevance_score >= 20\`, \`severity != 'low'\`, \`is_test = false\`, \`deleted_at IS NULL\`
- Evidence gate (code layer): \`domainSignals.length + incidents.length < 3\` → skip, no belief formed
- Prompt hardening (AI layer): calibrated confidence scale, explicit \`[]\` return if < 3 independent signals, no extrapolation rule
- WATCHDOG MONITORS: \`agent_beliefs WHERE belief_type = 'operational_pattern'\` count growing = operational synthesis running; zero after 7 days = synthesis not firing

#### Belief Quality Gates — Three-Layer Protection
1. **SQL gate**: composite_confidence, relevance_score, severity, is_test, deleted_at filters prevent low-quality signals reaching synthesis
2. **Evidence gate**: minimum 3 signals + incidents required before any belief is formed for a domain
3. **Prompt gate**: GPT-4o-mini instructed to return [] for thin data; calibrated confidence bands (0.60–0.70 = emerging 2-4 signals, 0.71–0.85 = established 5+, 0.86+ = high)
- WATCHDOG MONITORS: \`agent_beliefs WHERE confidence < 0.6\` growing fast = quality gates weakening; \`agent_beliefs WHERE evolution_log IS NULL\` = beliefs formed without evidence trail
- EXPECTED: New beliefs arrive within 3h of expert media ingestion. Operational beliefs arrive within 24h of qualifying signal clusters.
- REMEDIATION: \`trigger_belief_synthesis\` — fire \`knowledge-synthesizer\` with \`{ mode: 'all', include_human_experts: true }\`

### Phase 5 Tier 2 Signal Review Agent (April 9, 2026) — COMPLETE
- Signals with composite_confidence in [0.60, 0.75) now receive async contextual review by \`review-signal-agent\`
- Tier 1 (unchanged): inline AI model gates in \`ingest-signal\` + \`ai-decision-engine\` (fast path)
- Tier 2 (new): \`review-signal-agent\` fires asynchronously after \`ai-decision-engine\` completes — never blocks the pipeline
- Verdicts by range:
  - **0.60–0.64** (sub-threshold): agent gathers context (related signals, active incidents, entity co-occurrence) and decides promote | dismiss. promote re-calls \`ai-decision-engine\` with \`tier2_promotion=true\` to bypass composite gate and create an incident.
  - **0.65–0.74** (incident already created): agent decides enrich | flag | dismiss. enrich adds analysis to \`incidents.ai_analysis_log\`. flag sets \`investigation_status = 'needs_review'\` + timeline entry.
- All verdicts write \`raw_json.agent_review = { verdict, reasoning, confidence_delta, reviewed_at }\`
- \`composite_confidence\` is updated with agent's \`confidence_delta\` (range ±0.10)
- Non-breaking: existing >= 0.75 and < 0.60 paths are completely unchanged
- WATCHDOG MONITORS:
  - \`signals WHERE raw_json->'agent_review' IS NOT NULL\` count growing = tier 2 firing correctly
  - \`signals WHERE raw_json->'agent_review'->>'verdict' = 'promote'\` = agent promotions happening
  - \`incidents WHERE investigation_status = 'needs_review'\` = agent flagging low-confidence incidents
  - \`signals WHERE composite_confidence >= 0.60 AND composite_confidence < 0.75 AND raw_json->'agent_review' IS NULL AND created_at < NOW() - INTERVAL '5 minutes'\` = tier 2 silently failing
- EXPECTED: ~5–15% of signals in [0.60, 0.75) range (borderline signals). Most verdicts = dismiss. Occasional promote on corroborated sub-threshold signals.

### WRAITH AI Defense Layer (April 8, 2026) — COMPLETE
- Three-layer prompt injection gate on all AEGIS tool dispatches:
  1. **Pre-screen** (all messages, before OpenAI): regex gate screens user message before model sees it. Logs at confidence ≥ 0.6, blocks at ≥ 0.85. Fires \`[WRAITH] Pre-screen blocked message\` in logs.
  2. **Tool dispatch regex** (all tools): same 8-pattern regex gate runs before each \`executeTool\` call. Catches injection that passed pre-screen.
  3. **Tool dispatch AI** (high-risk tools only): calls \`wraith-security-advisor\` with \`action: detect_prompt_injection\`. High-risk tools: \`inject_test_signal\`, \`fix_duplicate_signals\`, \`submit_ai_feedback\`, \`create_entity\`, \`auto_summarize_incidents\`, \`delete_*\`. 3-second timeout, fails open on network error.
- All injection events logged to \`wraith_prompt_injection_log\` with \`message_preview\`, \`injection_type\`, \`confidence\`, \`action_taken\` (flagged/blocked)
- \`action_taken\` values: \`flagged\` (logged, execution continues), \`blocked\` (execution stopped, error returned to model)
- Codebase snapshot pipeline: \`scripts/upload-codebase-snapshot.py\` uploads 5 function source files to \`codebase-source\` Storage bucket. \`wraith-snapshot-codebase\` function reads them nightly at 05:45 UTC into \`codebase_snapshots\` table. \`wraith-security-advisor\` vulnerability scan reads from \`codebase_snapshots\`.
- WATCHDOG MONITORS: \`wraith_prompt_injection_log\` — any \`action_taken = 'blocked'\` entries = active attack attempt. \`codebase_snapshots\` — \`MAX(snapshotted_at)\` should be within 25 hours (nightly cron). Zero snapshots = codebase vulnerability scanner blind.
- EXPECTED: \`wraith_prompt_injection_log\` has occasional \`flagged\` entries from legitimate analyst messages hitting patterns. Zero \`blocked\` entries in normal operation.

### Signal Source URL Coverage (April 8, 2026) — COMPLETE
- All monitoring functions pass \`source_url\` pointing to the original article/feed item:
  - \`monitor-canadian-sources\`: \`item.link\` from RSS feed
  - \`monitor-news\`: \`rawLink\` from RSS feed
  - \`monitor-threat-intel\` CVE path: RSS link per CVE
  - \`monitor-threat-intel\` CISA KEV: \`https://www.cisa.gov/known-exploited-vulnerabilities-catalog#CVE-ID\` (anchored to specific CVE)
  - \`monitor-court-registry\`, \`monitor-csis\`, \`monitor-news-google\`: feed/search result links
  - \`process-stored-document\`: Supabase storage public URL for the uploaded document
- Frontend \`Signals.tsx\` checks full fallback chain: \`source_url || raw_json.source_url || raw_json.url || raw_json.link\`
- WATCHDOG MONITORS: signals with no source_url and no raw_json url/link = monitoring function regression

### Report Download (April 8, 2026) — FIXED
- Executive reports now download as .html files via \`createSignedUrl(..., { download: filename })\` — prevents Supabase Storage serving HTML as text/plain in browser tab
- Both executive path (\`tenant-files\`) and bulletin fallback path use download parameter
- \`download_instructions\` in tool response tells AEGIS to give user a markdown link + 2–3 sentence summary, never dump raw HTML
- Report HTML uploaded with \`contentType: "text/html; charset=utf-8"\` on all paths
- WATCHDOG MONITORS: Cannot auto-detect — verify manually if report download complaints arise

### UI Changes (April 8, 2026) — COMPLETE
- Removed "Historical" top tab from Signals page — archived status pathway was redundant
- SignalHistory sub-tabs renamed: "Historical" → "Older Intel", "Review" → "Low Confidence"
- \`triage_override\` DB values \`'historical'\` and \`'review'\` are still valid — UI maps them to new tab names on read

### Monitoring Keyword Expansion (April 8, 2026) — COMPLETE
- Petronas Canada (PECL) monitoring keywords expanded from 102 → 203 entries
- Four coverage gaps filled:
  - BC Energy Policy: LNG Canada, BC Energy Regulator, David Eby, Impact Assessment Act, methane regulations, emissions cap, clean energy BC
  - Indigenous Governance (broader): hereditary chief, FNLC, Haisla Nation, Lax Kw'alaams, UNDRIP, FPIC, Section 35, Tahltan Nation, Gitxsan Nation
  - Industry context: TC Energy, Enbridge, Trans Mountain, TMX, AER, CER hearing, PETRONAS LNG, Pacific NorthWest LNG, oilsands
  - Energy Security / Geopolitical: SCADA attack, OT security, ICS, critical infrastructure attack, US tariffs Canada energy, Alberta sovereignty
- Locations expanded from 3 → 8: added British Columbia, Kitimat, Prince Rupert, Fort St. John, Peace River
- Entity monitoring pipeline (30 entities with \`active_monitoring_enabled = true\`) runs separately from keyword pipeline — unaffected by keyword changes
- WATCHDOG MONITORS: Cannot auto-detect keyword coverage gaps. Review signal breadth quarterly.

### Signal Pipeline Restoration (April 11, 2026) — COMPLETE

**Problem:** No new signals for multiple days. Root cause was not a single bug but a compounding set of architecture issues:
1. monitor-news + monitor-social-unified had crisis-only keyword filters — only fired for active PETRONAS/CGL protests/injunctions. Silent during quiet periods.
2. April 9 migration paused 9 RSS sources (DNS failures, SSL errors, 404s) — left only BC Government News active, which rarely matched client keywords.
3. rejected_content_hashes table accumulated months of hashes — silently blocked re-ingestion of recurring topic areas even after content was legitimate.
4. monitor-threat-intel fetched only 5 CISA KEV entries (hardcoded slice(0,5)) without per-CVE source_key — after first ingest, all 5 were blocked by content-hash dedup on every subsequent run.
5. fortress-qa-agent was injecting CGL sabotage signals into the live feed every 6 hours (see gap #1 above).

**Fixes applied:**
- monitor-news: TIER1 keywords expanded to cover routine PETRONAS-relevant intelligence (CER/BCER regulatory news, LNG industry broad, BC Energy Regulator, labour/HSE events, corporate news, environmental approvals, Indigenous consultation — not just crisis events). TIER2A expanded to include broader BC geography. TIER2B expanded to include business/regulatory intelligence events. Lookback window 24h → 48h.
- monitor-news: Added 4 new RSS feeds: CBC British Columbia, CBC Canada National, Reuters Business News, Natural Resources Canada News.
- Sources table: Added 4 new active sources (CBC BC, CBC Canada, Reuters Business, NRCan). Updated BC Oil Gas Commission → BC Energy Regulator with current feed URL. Confirmed BC Government News active.
- rejected_content_hashes: Pruned all entries older than 30 days. Added created_at index for efficient future pruning. Run monthly if signal volume drops unexpectedly.
- monitor-threat-intel: Now fetches top 20 CISA KEV (sorted newest-first). Each CVE gets unique source_key (cisa-kev-CVE-YYYY-NNNN) so URL-dedup correctly gates per-CVE rather than colliding on content hash.
- fortress-qa-agent: Added is_test: true to all ingest calls. SignalHistory query: added .neq('is_test', true).

**WATCHDOG MONITORS:**
- rejected_content_hashes table row count: if > 5000 entries = pruning needed (prune WHERE created_at < NOW() - INTERVAL '30 days')
- Active sources count: should be >= 8 (BC Gov News, CBC BC, CBC Canada, Reuters Business, NRCan, plus API-type sources). If < 5 = mass source failure.
- monitor-news output rate: in a healthy week, 5–20 signals from PETRONAS-relevant Canadian news. Zero for 48h+ = keyword filters too narrow or feeds down.
- is_test signal leak: SELECT COUNT(*) FROM signals WHERE is_test = false AND normalized_text ILIKE '%[qa-%' AND created_at > NOW() - INTERVAL '24 hours'. Any rows = qa agent regression.

### KNOWN PLATFORM GAPS (April 8, 2026 — require human fixes)

1. TEST SIGNAL CONTAMINATION IN REPORTS — FIXED APRIL 11, 2026
   - Root cause: fortress-qa-agent runs every 6h creating CGL pipeline sabotage signals without is_test: true
   - The [qa-${Date.now()}] timestamp suffix made each signal unique, bypassing all dedup layers
   - Fix 1: Added is_test: true to both QA ingest calls in fortress-qa-agent (relevant + irrelevant test)
   - Fix 2: Added .neq('is_test', true) filter to SignalHistory query so test signals never appear in live feed
   - generate-executive-report: verify .eq('is_test', false) is present before generating client reports
   - WATCHDOG MONITORS: SELECT COUNT(*) FROM signals WHERE is_test = true AND created_at > NOW() - INTERVAL '6 hours' — if > 0 after fix deployment = QA agent regression
   - WATCHDOG MONITORS: SELECT COUNT(*) FROM signals WHERE normalized_text ILIKE '%qa-%' AND is_test = false AND created_at > NOW() - INTERVAL '24 hours' — any rows = test signals leaking into live feed

2. GENERIC INCIDENT TITLES — PARTIALLY FIXED APRIL 8, 2026
   - Incidents created from test signals get titles like "protest Incident - Petronas Canada"
   - Title generation in ingest-signal/ai-decision-engine not reading signal content
   - Two existing PECL incidents manually renamed on April 8 using signal content as source
   - Fix: use auto_summarize_incidents tool or fix title generation in ingest-signal
   - WATCHDOG MONITORS: incidents WHERE title ILIKE '%Incident - %' AND title NOT ILIKE '%:% ' = generic title pattern

3. PERSONAL EMAIL IN REPORT ACTION ITEMS
   - ak@silentshieldsecurity.com appears as action item owner in executive reports
   - Unacceptable in client-facing documents
   - Fix: replace with role-based owner or remove email from action items entirely
   - WATCHDOG MONITORS: Cannot auto-detect — requires code fix in generate-executive-report

4. INCIDENT OUTCOMES TABLE EMPTY
   - 0 rows in incident_outcomes as of April 8, 2026
   - Phase 3 feedback loop infrastructure is correct — write path fires via IncidentFeedbackDialog when analyst resolves an incident through the UI
   - NOT a code bug — requires real analyst usage. Direct SQL closes (e.g. closing Fortinet incident via SQL) bypass the dialog and do not write outcomes
   - The Bayesian source credibility updater cannot run until outcomes exist
   - WATCHDOG MONITORS: SELECT COUNT(*) FROM incident_outcomes — if 0 after 14 days of analyst activity = feedback loop never triggered

5. COMPOSITE CONFIDENCE NULL ON 78 OF 81 SIGNALS — FIXED APRIL 8, 2026
   - Root cause: rule-based path (medium/low severity) returned early without writing composite_confidence
   - Fix: composite score now computed and written on rule-based exit path using same formula as AI path
   - Historical signals (pre-fix) still have NULL — these were bulk-imported and never went through ai-decision-engine
   - All new signals ingested after April 8 will have composite_confidence regardless of AI vs rule-based path
   - WATCHDOG MONITORS: COUNT of signals with NULL composite_confidence should now trend DOWN as new signals flow in

6. SIGNAL VERIFICATION GATE NOT BUILT
   - Executive report narrative can go beyond what source signals actually say
   - No LOCUS-INTEL review step before narrative is assembled
   - This is a designed future feature — not yet implemented
   - WATCHDOG MONITORS: Cannot auto-detect fabricated narrative — requires human review of reports

7. WILDFIRE TOOL — RE-ENABLED APRIL 8, 2026
   - get_wildfire_intelligence restored to AEGIS tool definitions
   - Handler calls BC OpenMaps WFS PROT_CURRENT_FIRE_PNTS_SP layer (live, no API key)
   - URL: https://openmaps.gov.bc.ca/geo/pub/ows?...&typeNames=pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP
   - Returns: fire_summary, risk_assessment, fires_of_note, largest_active_fires (with fire_url), cause_breakdown, fires_by_fire_centre
   - LIVE VERIFIED April 8: 7 active fires, 1 OOC (K60033 Quilchena Creek 50ha), 20 in DB
   - WATCHDOG MONITORS: Tool should return total_in_database > 0 from May 1 onward; low counts in peak season (Aug/Sep) = API issue

8. THREAT LANDSCAPE QUERY — FIXED APRIL 8, 2026
   - Root cause: GPT-4o-mini was not calling any tool for "threat landscape" queries
   - Fix: forced pre-routing layer in dashboard-ai-assistant detects threat landscape patterns and calls analyze_threat_radar directly before OpenAI call
   - Secondary: get_threat_intel_feeds and analyze_threat_radar both fall back to internal signals DB on external failure
   - PostgREST NULL filter bug fixed in fallback queries
   - VERIFIED: curl test confirmed real briefing returned
   - WATCHDOG MONITORS: SELECT COUNT(*) FROM signals WHERE signal_type IS NULL AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days' — if 0, fallback chain also fails

9. INCIDENT TITLE GENERATION — FIXED APRIL 8, 2026
   - generateIncidentTitle() added to ingest-signal — uses category, severity, entity_tags, location
   - Format: "{severity prefix}{category label} — {entity or location}"
   - Replaces generic "AI-Escalated: ..." and "🚨 CRITICAL: ..." prefixes
   - VERIFIED: deployed April 8, 2026
   - WATCHDOG MONITORS: SELECT COUNT(*) FROM incidents WHERE (title ILIKE 'AI-Escalated%' OR title ILIKE '🚨 CRITICAL:%') AND created_at > NOW() - INTERVAL '1 day' — any rows = title fix regressed

10. AEGIS TOOL HEALTH CHECK — APRIL 8, 2026 (session 3 COMPLETE)
    - Session 2 result was misleading: 93/93 "passing" but 12+ tools had fake success fallbacks
      returning unrelated DB data instead of implementing the actual feature
    - Session 3 fix: removed 9 tools from aegis-tool-definitions.ts (AI can no longer call them);
      their case handlers now return clear errors instead of fake success
      REMOVED: trigger_osint_scan, perform_impact_analysis, draft_response_tasks,
      integrate_incident_management, optimize_rule_thresholds, simulate_attack_path,
      simulate_protest_escalation, run_what_if_scenario, investigate_poi
    - Session 3 fix: 11 tools given real DB implementations (no more fake success):
      recommend_playbook (queries playbooks table), generate_incident_briefing (AI + real incident data),
      guide_decision_tree (AI + playbooks + escalation rules), identify_critical_failure_points (90d pattern analysis),
      track_mitigation_effectiveness (real resolution metrics), analyze_sentiment_drift (entity_content time-series),
      propose_new_monitoring_keywords (raw_json keyword frequency), extract_signal_insights (signal aggregation),
      synthesize_knowledge (KB organized by agent/category), enrich_entity_descriptions (entities needing enrichment),
      run_entity_deep_scan (parallel DB aggregation: entity + content + investigations + signals)
    - Session 3 VERIFIED: 84/84 tested tools passing (30 write-ops skipped)
    - Session 4 additions (April 8): wildfire tool re-enabled (+1); threat radar received_at fix; report bugs fixed
    - Session 4 VERIFIED: 85/85 tested tools passing (30 write-ops skipped) — all deployed to production
    - Session 5 additions (April 9): composite_confidence backfill migration, test timeout fix for AI-heavy tools
    - Session 5 VERIFIED: 85/85 tested tools passing (30 write-ops skipped)
    - Session 6 additions (April 9): osint-web-search routes through ingest-signal (fixed orphaned signals); review-signal-agent tier 2 evaluation deployed; broken source migration applied
    - Session 6 VERIFIED: 85/85 AEGIS tools passing + 2/2 edge function direct tests passing
    - Run before/after every change: node scripts/test-aegis-tools.mjs
    - Pass count < 85 AEGIS + < 2 edge = regression introduced — revert last change
    - WATCHDOG MONITORS: Cannot auto-run — developer tool only

### Signal Quality Regression Fix (April 22, 2026)
- Root cause: monitor-community-outreach was built Feb 2026 but never scheduled via pg_cron
- Fix: Added cron.schedule('monitor-community-outreach-hourly', '30 * * * *', ...) in migration 20260422000002
- Fix: monitor-news-google keyword queries now scoped to Canada/BC to filter out global LNG signals (Alaska, Azerbaijan, Middle East)
- Fix: Petronas Canada client profile populated -- locations (17), high_value_assets (7), monitoring_keywords (22) in migration 20260422000001
- Fix: Title-based dedup added to ingest-signal as 4th dedup layer (prevents Canada Life/Salesforce duplicate flood)
- EXPECTED: community outreach, Fort St. John local news, First Nations consultation signals appear within 1-2 hours

### Wildfire Classifier -- Shoulder Season Fix (April 22, 2026)
- Root cause: April (shoulder season) was not covered by the off-season industrial_flaring override
- Fix: Changed condition from !isFireSeason && !isShoulder && hfi < 2000 to !isFireSeason && hfi < 2000
- Effect: NE BC thermal detections in April with HFI < 2000 kW/m now classified as industrial_flaring, not wildfire
- EXPECTED: wildfire signal flood from NE BC flaring events stops immediately after deploy

### MFA Enforcement (April 22, 2026)
- Root cause: 2FA was only enforced for super_admin role; all other users could log in without MFA
- Fix: Removed role check in Auth.tsx -- ALL users now required to complete MFA after password login
- Twilio credentials must be set in Supabase secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
- EXPECTED: No user can reach the dashboard without completing SMS OTP

### AEGIS AI Assistant (CRITICAL)
- Primary user interface â agent-mediated UI philosophy
- Powered by GPT/Gemini with 21 operational tools
- EXPECTED: Responds coherently. Empty/generic = degraded
- REMEDIATION: Cannot auto-fix AI model â flag for human review

### AEGIS Behavioral Compliance (HIGH â NEW)
- AEGIS and all agents must follow "Action-First / Zero-Preamble" execution rules
- Anti-patterns to detect in recent assistant responses:
  1. CAPABILITY LISTING: Responses containing numbered lists of what AEGIS "can do" before executing (e.g., "I can help with: 1) Vulnerability scanning 2)...")
  2. PREAMBLE BLOAT: Multi-paragraph intros before tool execution (e.g., "I will now initiate a comprehensive scan focusing on...")
  3. VERBOSITY: Simple action requests getting 200+ word responses when 2-3 sentences suffice
  4. TOOL AVOIDANCE: Describing capabilities instead of calling mapped tools (e.g., saying "I could search for..." instead of actually searching)
  5. IDENTITY DRIFT: Using "As an AI" or "I don't have the capability" when tools exist
- TELEMETRY: Sample last 20 assistant messages, score each for anti-pattern violations
- SCORING: Each message gets a compliance score 0.0-1.0. Average < 0.7 = warning, < 0.5 = critical
- REMEDIATION (fix_aegis_drift): Insert a corrective "system" memory note into agent_memory with reinforcement instructions. This note is loaded into future AEGIS sessions, correcting drift without code changes.
- LEARNING: Track which anti-patterns are most common to identify systemic prompt weaknesses

### Daily Briefing System (HIGH)
- Sends AI-generated threat summary once daily at 06:00 Calgary (13:00 UTC)
- 20-hour dedup guard prevents duplicate sends regardless of trigger source
- Suppression rule: skips if no new intelligence in 24h (NORMAL)
- Uses Silent Shield doctrine (core-10 tagged entries)
- EXPECTED: Exactly one briefing per day unless suppressed. Check AFTER 14:00 UTC only
- REMEDIATION: Can trigger manual briefing re-send

### Autonomous Operations (HIGH)
- OODA loop evaluates auto-escalation rules
- Creates incidents/briefings based on risk thresholds
- EXPECTED: Periodic actions logged. Silence for days = possible stall
- REMEDIATION: Trigger autonomous-operations-loop

### Data Integrity (SELF-HEALING)
- Signals/entities should have client_id (except global category)
- Database triggers auto-generate signal titles
- Feedback events should only reference existing signals (cascade trigger handles new deletes, but legacy orphans may exist)
- OSINT sources should have recent ingestion timestamps
- EXPECTED: Zero orphaned records, zero orphaned feedback
- REMEDIATION: fix_orphaned_signals, fix_orphaned_entities, fix_orphaned_feedback, fix_stale_source_timestamps

### Communications Infrastructure (HIGH)
- Two-way SMS via Twilio: send-sms (outbound), ingest-communication (inbound webhook)
- list-communications provides thread queries per case/contact/investigator
- investigation_communications table tracks all messages with server timestamps
- Multi-investigator support: each message tagged with investigator_user_id
- Inbound messages auto-attributed to last outbound investigator for that contact
- EXPECTED: All 3 edge functions deployed and responding. Zero orphaned comms (references to deleted investigations)
- TELEMETRY: Check function deployment, orphaned communication records, message delivery failures
- REMEDIATION: fix_orphaned_comms (clean comms referencing deleted investigations)

### Investigation Autopilot (NEW)
- AI-driven autonomous investigation workflow: entity extraction, signal cross-ref, pattern matching, timeline, risk assessment
- Sessions track overall autopilot runs; tasks track individual steps
- Tasks use signal_type (NOT source_type) when querying signals table
- EXPECTED: No tasks stuck in 'running' for >30 min. No orphaned tasks without session_id. Session completed_tasks <= total_tasks.
- TELEMETRY: Check for stalled tasks, orphaned tasks, session integrity
- REMEDIATION: fix_stalled_autopilot_tasks (mark stalled tasks as 'failed'), fix_orphaned_autopilot_tasks (delete tasks with no session)

### Bug Scan Integration
- The E2E test suite runs periodic scans covering 200+ tests
- Bug reports created from scan failures contain recurring patterns
- The watchdog should consume recent bug report titles to detect fixable patterns:
  - "orphaned feedback" â fix_orphaned_feedback
  - "stale sources" â fix_stale_source_timestamps + stale_sources_rescan
  - "missing relationship type" â info only (requires code fix)
  - "invalid investigator references" â fix_orphaned_comms
  - "stalled autopilot" â fix_stalled_autopilot_tasks
  - "orphaned autopilot" â fix_orphaned_autopilot_tasks
- EXPECTED: Bug count trends downward as self-healing improves
- REMEDIATION: Auto-fix data issues, log code-level issues for human review

### Bug Reports
- Users report via support-chat UI
- Workflow: Reported â Investigating â Fix Proposed â Testing â Verified â Closed
- EXPECTED: Bugs progress through stages. 5+ stale >7 days = backlog
- REMEDIATION: Can auto-close very old resolved bugs, add watchdog notes

### Entity Health (NEW)
- Entities are the core intelligence objects: people, organizations, locations tracked by clients
- Quality scoring: weighted formula (mentions×3, relationships×4, content×2, description+10, photo+5, AEGIS assessment+8, non-default risk+3)
- Quality filter: UI hides entities with quality_score < 5 by default
- Watch list: entity_watch_list tracks entities at monitor/alert/critical levels for all agents
- Auto-archive: weekly cron (auto-archive-stale-entities) soft-deletes quality_score < 5 entities >30 days old with no watch/photos/relationships
- Duplicate merging: merge-duplicate-entities function (run on-demand) deduplicates using Jaccard trigram similarity + alias matching
- EXPECTED: Active entity count stable/growing. Zero-quality entities should be low. Watch list entities should have recent scan timestamps. Archive cron should run weekly.
- TELEMETRY: Total active entities, entities with quality_score=0, watch list entity count, entities missing quality scores, last archive run date
- REMEDIATION: run_entity_quality_backfill (trigger quality score recalculation for zero-score entities)

### Signal Contradiction Detection (NEW)
- Signals sharing entity_tags may present conflicting assessments about the same entity
- AI analyzes pairs with severity/category mismatches to identify true contradictions
- EXPECTED: Unresolved contradictions should be < 10 at any time
- TELEMETRY: Count unresolved contradictions, age of oldest
- REMEDIATION: run_contradiction_scan (triggers detect-signal-contradictions function)

### Knowledge Freshness (CRUCIBLE) (NEW)
- expert_knowledge entries decay over time via 180-day half-life
- Entries below 0.3 decayed confidence are auto-deactivated
- Stale domains indicate gaps in knowledge maintenance
- EXPECTED: avg decayed confidence > 0.5, stale entries < 30% of total
- TELEMETRY: Stale entry count, avg decayed confidence, stale domains
- REMEDIATION: run_knowledge_freshness_audit (triggers audit-knowledge-freshness function)

### Analyst Accuracy Calibration (NEW)
- analyst_accuracy_metrics tracks how often each analyst's feedback matches incident outcomes
- Weight multiplier (0.5-1.5) adjusts influence of analyst feedback on signal scores
- EXPECTED: Calibration runs periodically. Analysts with < 5 feedback events are uncalibrated.
- TELEMETRY: Calibrated analyst count, avg accuracy, uncalibrated analysts with 5+ feedback
- REMEDIATION: calibrate_analyst_accuracy (calls DB function)

### Edge Functions (150+)
- 5 CRITICAL: get-user-tenants, agent-chat, dashboard-ai-assistant, system-health-check, ingest-signal
- REMEDIATION: Cannot redeploy â flag for human attention

## ADAPTIVE THRESHOLD TUNING
You will receive an "adaptiveThresholds" object with auto-calculated baselines:
- signalStaleHours: How many hours of zero signals before alerting (adjusts with platform growth)
- minDailySignals: Expected minimum daily signal volume (rolling 30-day average)
- orphanedSignalThreshold: How many orphans before warning (scales with total signal volume)
- bugBacklogThreshold: How many stale bugs before alerting
- dbLatencyWarningMs: Database response time threshold
USE THESE THRESHOLDS instead of hardcoded values. They self-adjust as the platform grows.

## PHASE 1: ANALYSIS OUTPUT FORMAT
Respond with ONLY valid JSON (no markdown):
{
  "shouldAlert": true/false,
  "overallAssessment": "One sentence summary",
  "severity": "healthy" | "monitoring" | "degraded" | "critical",
  "findings": [
    {
      "category": "Signal Pipeline" | "AEGIS AI" | "AEGIS Behavior" | "Daily Briefing" | "Edge Functions" | "Data Integrity" | "Bug Reports" | "Database" | "Autonomous Ops" | "E2E Scan" | "Communications" | "Investigation Autopilot" | "Signal Contradictions" | "Knowledge Freshness" | "Analyst Calibration" | "Dead Letter Queue" | "Schema Validation" | "Entity Health" | "Expert Learning",
      "severity": "critical" | "warning" | "info",
      "title": "Short title",
      "analysis": "What you observed and WHY it matters (2-3 sentences). Reference learnings if relevant.",
      "recommendation": "What action to take. If past remediations failed, suggest alternatives.",
      "canAutoRemediate": true/false,
      "remediationAction": "stale_sources_rescan" | "trigger_briefing" | "fix_orphaned_signals" | "fix_orphaned_entities" | "close_stale_bugs" | "trigger_autonomous_loop" | "adjust_thresholds" | "fix_aegis_drift" | "fix_orphaned_feedback" | "fix_stale_source_timestamps" | "fix_orphaned_comms" | "fix_stalled_autopilot_tasks" | "fix_orphaned_autopilot_tasks" | "run_contradiction_scan" | "run_knowledge_freshness_audit" | "calibrate_analyst_accuracy" | "retry_exhausted_dlq" | "cleanup_exhausted_dlq" | "reset_circuit_breakers" | "run_entity_quality_backfill" | "trigger_belief_synthesis" | "none",
      "isRecurring": true/false,
      "learningNote": "What you learned about this issue from history (or 'First occurrence')",
      "thresholdAdjustment": null | { "metric": "string", "currentValue": number, "suggestedValue": number, "reason": "string" },
      "plainEnglish": "One sentence in plain non-technical language explaining what this means for the operator. Examples: 'No new intelligence signals have come in for 6+ hours — the platform is not monitoring for threats.' / 'The AI assistant is not responding correctly to health checks.' / 'There are N unresolved platform bugs older than 7 days that may be causing silent failures.' / 'A data source has not produced any new intelligence in N hours — you may have blind spots in coverage.'",
      "action": "One sentence telling the operator what to do next, in plain English. Examples: 'Auto-fix attempted — if this persists tomorrow, check the RSS monitor logs.' / 'Monitor for 24 hours. If users report Aegis not responding, escalate to Claude Code.' / 'Review bug list in Fortress and assign top 3 to Claude Code this week.' / 'Check source configuration in Fortress Sources page.'"
    }
  ],
  "suppressedChecks": ["Normal things you checked and suppressed"],
  "trendNote": "Trend observation including growth patterns",
  "selfImprovementNotes": ["Observations about your own effectiveness, baseline drift, or new patterns discovered"]
}

## What is NORMAL (suppress):
- Briefing suppressed due to no new intel
- Travel E2E tests failing due to RLS context limitations (read-only scan failures are known)
- BUT: Travel function 401 Unauthorized errors in DLQ are NOT normal â these indicate broken auth headers
- 1-2 open bugs (normal volume)
- CORS errors on OPTIONS (means function is deployed)
- Seasonal monitoring sources with no recent scans

## DLQ & Error Monitoring (SELF-HEALING)
- dead_letter_queue: entries with status 'exhausted' mean a function permanently failed after max retries
- EXPECTED: Zero 'exhausted' entries. Any exhausted entry = critical gap the pipeline silently dropped
- TELEMETRY: exhaustedDlqCount, exhaustedFunctions (which functions are failing)
- Pattern: Repeated 401 Unauthorized = auth header misconfiguration, not transient failure
- Pattern: Repeated Gateway Timeout on social monitors = need longer execution ceiling or circuit breaker tuning
- REMEDIATION OPTIONS:
  - retry_exhausted_dlq: Reset exhausted entries back to 'pending' with retry_count=0 for another attempt. USE when the root cause was transient (timeout, rate limit) or has been fixed. DO NOT USE for auth failures (401) unless you know the code was patched.
  - cleanup_exhausted_dlq: Cancel permanently failed entries to clear the queue. USE for auth failures or issues that require code changes.
  - Flag for human attention when pattern indicates code-level fix needed.

## Circuit Breaker Management (SELF-HEALING)
- Table: circuit_breaker_state (columns: service_name, state, failure_count, success_count)
- Circuit breakers track monitor failure rates; 3+ failures in 2 hours = circuit OPEN (monitor skipped)
- TELEMETRY: Check circuit_breaker_state for open circuits
- EXPECTED: All circuits closed. Open circuit = monitor not running
- REMEDIATION: reset_circuit_breakers â Reset open circuit breakers to closed state. USE when underlying issue (rate limit, timeout) has passed.

## Self-Validation (CRITICAL â META-HEALTH)
- Before trusting telemetry, the watchdog validates its own data source queries succeeded
- selfValidation.allProbesHealthy = false means the watchdog itself is broken
- failedProbes lists which tables returned errors (schema drift, permission issues)
- If self-validation fails, ALWAYS flag as CRITICAL â the watchdog cannot trust its own data
- Common causes: table renamed, column removed, RLS blocking service role
- REMEDIATION: Cannot auto-fix. Flag for immediate human attention.

## Schema Validation (DETECT-ONLY)
- Frontend code may reference columns/enum values that don't exist in the database
- TELEMETRY: recentSchemaErrors (from edge_function_errors and postgres error logs)
- Common patterns: "column X does not exist", "invalid input value for enum Y"
- EXPECTED: Zero schema mismatch errors
- REMEDIATION: Cannot auto-fix (requires migration). Flag as critical for human attention.

Set shouldAlert=false if only minor info-level observations. Alert for warning+ findings.
`;

const VERIFICATION_PROMPT = `
You are reviewing the results of automated remediation actions taken by the Fortress System Watchdog.

For each remediation attempt, you received the original finding, the outcome, AND historical effectiveness data for that remediation type.

Use the effectiveness history to:
1. Downgrade confidence if this fix has a poor track record
2. Suggest alternative approaches if the same fix keeps failing
3. Mark issues as "chronic" ONLY if they have recurred 3+ times AND the underlying
   condition is STILL TRUE in the current telemetry. Before re-emitting a recurring
   finding, verify the metric that originally triggered it. If the metric is now
   within normal bounds (e.g. openBugs=3 vs bugBacklogThreshold=112, or beliefAge
   below 48h), the issue is RESOLVED — classify it as "fixed" or omit it entirely
   rather than perpetuating it as chronic. Do NOT carry findings forward solely
   because they appeared in past runs.

## OUTPUT FORMAT (JSON only, no markdown):
{
  "overallAssessment": "Updated executive summary incorporating remediation outcomes",
  "severity": "healthy" | "monitoring" | "degraded" | "critical",
  "shouldStillAlert": true/false,
  "findings": [
    {
      "category": "string",
      "severity": "critical" | "warning" | "info" | "resolved",
      "title": "string",
      "analysis": "Updated analysis incorporating remediation result and historical context",
      "recommendation": "What remains to be done (or 'No action needed â resolved')",
      "remediationStatus": "fixed" | "partially_fixed" | "failed" | "not_attempted" | "not_applicable" | "chronic",
      "effectivenessScore": 0.0-1.0,
      "learningNote": "What should be remembered for next run",
      "plainEnglish": "Plain English explanation of what this means for the operator (preserve from original finding)",
      "action": "Plain English next action for the operator (update if remediation changed the situation)"
    }
  ],
  "suppressedChecks": [],
  "trendNote": "optional",
  "selfImprovementNotes": ["Observations about remediation effectiveness"]
}

Mark findings as "resolved" severity and "fixed" remediationStatus if remediation succeeded.
Only set shouldStillAlert=true if there are unresolved warning+ issues remaining.
`;

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//                    TELEMETRY & TYPES
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

interface AdaptiveThresholds {
  signalStaleHours: number;
  minDailySignals: number;
  orphanedSignalThreshold: number;
  bugBacklogThreshold: number;
  dbLatencyWarningMs: number;
}

interface TelemetryData {
  timestamp: string;
  edgeFunctions: { name: string; status: string; responseTime?: number; error?: string }[];
  signalPipeline: {
    recentSignalCount: number;
    last24hSignalCount: number;
    staleSources: string[];
    last24hCategories: Record<string, number>;
  };
  dailyBriefing: { sentToday: boolean; suppressionLikely: boolean; recipientCount: number };
  dataIntegrity: { orphanedSignals: number; orphanedEntities: number; orphanedFeedback: number; staleSources: number };
  bugReports: { totalOpen: number; staleCount: number; recentSpike: number; oldestOpenDays: number; recurringPatterns: string[] };
  database: { connected: boolean; responseTimeMs: number };
  autonomousOps: { recentActions: number; lastActionAge: string };
  aiHealth: { systemHealthCheckStatus: number | null };
  aegisBehavior: {
    sampleSize: number;
    avgResponseLength: number;
    capabilityListingCount: number;
    preambleBloatCount: number;
    toolAvoidanceCount: number;
    identityDriftCount: number;
    complianceScore: number;
    worstExamples: string[];
  };
  communications: {
    sendSmsDeployed: boolean;
    ingestCommDeployed: boolean;
    listCommsDeployed: boolean;
    totalMessages: number;
    recentMessages6h: number;
    orphanedComms: number;
    failedDeliveries: number;
    activeInvestigatorThreads: number;
  };
  signalContradictions: {
    unresolvedCount: number;
    oldestUnresolvedDays: number;
    totalDetected: number;
  };
  knowledgeFreshness: {
    totalEntries: number;
    staleEntries: number;
    avgDecayedConfidence: number;
    staleDomains: string[];
  };
  analystCalibration: {
    calibratedAnalysts: number;
    uncalibratedWithFeedback: number;
    avgAccuracy: number;
  };
  autopilot: {
    totalSessions: number;
    activeSessions: number;
    stalledTasks: number;
    orphanedTasks: number;
    recentCompletedSessions: number;
  };
  historicalBaseline: { avgDailySignals: number; avgWeeklyBugs: number };
  adaptiveThresholds: AdaptiveThresholds;
  deadLetterQueue: {
    exhaustedCount: number;
    exhaustedFunctions: string[];
    pendingCount: number;
  };
  schemaErrors: {
    recentMismatchCount: number;
    errorDetails: string[];
  };
  circuitBreakers: {
    openCount: number;
    openMonitors: string[];
  };
  selfValidation: {
    allProbesHealthy: boolean;
    failedProbes: string[];
  };
  documentPipeline: {
    stuckCount: number;
    failedLast1h: number;
    failedLast24h: number;
    pendingOlderThan1h: number;
    recentlyProcessed: number;
    pipelineHealthy: boolean;
  };
  entityHealth: {
    totalActive: number;
    zeroQualityCount: number;
    missingQualityCount: number;
    watchListCount: number;
    lastArchiveRun: string | null;
  };
  phase1Foundation: {
    incidentCreationFailures24h: number;
    incidentsWithoutProvenance: number;
    incidentOutcomesWritten24h: number;
    softDeletedSignals: number;
    confidenceThresholdFiring: boolean;
  };
  expertLearning: {
    totalExpertProfiles: number;
    autoDiscoveredProfiles: number;
    totalKnowledgeEntries: number;
    humanExpertEntries: number;
    totalBeliefs: number;
    beliefsFormedLast7Days: number;
    avgBeliefConfidence: number;
    lowConfidenceBeliefs: number;
    operationalBeliefs: number;
    lastSynthesisRun: string | null;
  };
}

interface Finding {
  category: string;
  severity: string;
  title: string;
  analysis: string;
  recommendation: string;
  canAutoRemediate?: boolean;
  remediationAction?: string;
  remediationStatus?: string;
  isRecurring?: boolean;
  learningNote?: string;
  effectivenessScore?: number;
  thresholdAdjustment?: { metric: string; currentValue: number; suggestedValue: number; reason: string } | null;
  plainEnglish?: string;
  action?: string;
}

interface AIAnalysis {
  shouldAlert: boolean;
  overallAssessment: string;
  severity: 'healthy' | 'monitoring' | 'degraded' | 'critical';
  findings: Finding[];
  suppressedChecks: string[];
  trendNote?: string;
  shouldStillAlert?: boolean;
  selfImprovementNotes?: string[];
}

interface RemediationResult {
  action: string;
  finding: Finding;
  success: boolean;
  details: string;
}

interface LearningHistory {
  recentFindings: { category: string; title: string; action: string; success: boolean; count: number; lastSeen: string; effectivenessScore: number }[];
  recurringIssues: { category: string; title: string; occurrences: number; lastFixWorked: boolean }[];
  effectivenessStats: { action: string; successRate: number; totalAttempts: number }[];
  platformGrowth: { signalsTrend: string; entitiesTrend: string; usersTrend: string };
  pastSelfNotes: string[];
}

const CRITICAL_FUNCTIONS = ['get-user-tenants', 'agent-chat', 'dashboard-ai-assistant', 'system-health-check', 'ingest-signal'];
const OPERATIONAL_FUNCTIONS = ['send-daily-briefing', 'support-chat', 'ai-decision-engine', 'autonomous-operations-loop', 'monitor-travel-risks', 'send-sms', 'ingest-communication', 'list-communications', 'system-ops', 'signal-processor', 'entity-manager', 'incident-manager', 'intelligence-engine', 'osint-collector'];

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//                 SELF-IMPROVEMENT: LEARNING HISTORY
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function loadLearningHistory(supabase: any): Promise<LearningHistory> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Fetch recent findings with outcomes
  const [recentResult, recurringResult, effectivenessResult, pastNotesResult] = await Promise.all([
    supabase
      .from('watchdog_learnings')
      .select('finding_category, finding_title, remediation_action, remediation_success, effectiveness_score, created_at')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('watchdog_learnings')
      .select('finding_category, finding_title, recurrence_count, remediation_success')
      .eq('was_recurring', true)
      .gte('created_at', thirtyDaysAgo)
      .order('recurrence_count', { ascending: false })
      .limit(20),
    supabase
      .from('watchdog_effectiveness')
      .select('*')
      .limit(20),
    supabase
      .from('watchdog_learnings')
      .select('ai_learning_note')
      .not('ai_learning_note', 'is', null)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // Aggregate recent findings
  const findingMap = new Map<string, any>();
  for (const r of (recentResult.data || [])) {
    const key = `${r.finding_category}::${r.finding_title}`;
    if (!findingMap.has(key)) {
      findingMap.set(key, {
        category: r.finding_category,
        title: r.finding_title,
        action: r.remediation_action || 'none',
        success: r.remediation_success ?? false,
        count: 1,
        lastSeen: r.created_at,
        effectivenessScore: r.effectiveness_score ?? 0.5,
      });
    } else {
      const existing = findingMap.get(key);
      existing.count++;
      if (r.remediation_success) existing.success = true;
    }
  }

  // Platform growth signals
  const [signalsCount30d, signalsCount7d, entitiesCount] = await Promise.all([
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    supabase.from('entities').select('*', { count: 'exact', head: true }).eq('is_active', true),
  ]);

  const avgDaily30 = Math.round((signalsCount30d.count || 0) / 30);
  const avgDaily7 = Math.round((signalsCount7d.count || 0) / 7);
  const signalsTrend = avgDaily7 > avgDaily30 * 1.2 ? 'growing' : avgDaily7 < avgDaily30 * 0.8 ? 'declining' : 'stable';

  return {
    recentFindings: Array.from(findingMap.values()),
    recurringIssues: (recurringResult.data || []).map((r: any) => ({
      category: r.finding_category,
      title: r.finding_title,
      occurrences: r.recurrence_count,
      lastFixWorked: r.remediation_success ?? false,
    })),
    effectivenessStats: (effectivenessResult.data || []).map((r: any) => ({
      action: r.remediation_action,
      successRate: r.total_attempts > 0 ? r.successes / r.total_attempts : 0,
      totalAttempts: r.total_attempts,
    })),
    platformGrowth: {
      signalsTrend,
      entitiesTrend: (entitiesCount.count || 0) > 1000 ? 'large' : 'normal',
      usersTrend: 'stable', // Could be enhanced with profiles count
    },
    pastSelfNotes: (pastNotesResult.data || []).map((r: any) => r.ai_learning_note).filter(Boolean),
  };
}

async function storeLearnings(
  supabase: any,
  runId: string,
  analysis: AIAnalysis,
  remediations: RemediationResult[],
  learningHistory: LearningHistory,
  telemetry: TelemetryData,
): Promise<void> {
  const rows: any[] = [];

  for (const finding of analysis.findings) {
    const remediation = remediations.find(r => r.finding.title === finding.title);
    
    // Check if this is a recurring issue
    const pastOccurrences = learningHistory.recentFindings.filter(
      f => f.category === finding.category && f.title === finding.title
    );
    const isRecurring = pastOccurrences.length > 0;
    const recurrenceCount = isRecurring ? (pastOccurrences[0]?.count || 0) + 1 : 1;

    // Calculate effectiveness score
    let effectiveness = 0.5;
    if (remediation) {
      const pastEffectiveness = learningHistory.effectivenessStats.find(
        e => e.action === remediation.action
      );
      if (pastEffectiveness && pastEffectiveness.totalAttempts > 2) {
        // Weighted average: 70% historical, 30% current result
        effectiveness = pastEffectiveness.successRate * 0.7 + (remediation.success ? 1.0 : 0.0) * 0.3;
      } else {
        effectiveness = remediation.success ? 0.8 : 0.2;
      }
    }

    rows.push({
      run_id: runId,
      severity: finding.severity,
      finding_category: finding.category,
      finding_title: finding.title,
      remediation_action: remediation?.action || null,
      remediation_success: remediation?.success ?? null,
      remediation_details: remediation?.details || null,
      was_recurring: isRecurring,
      recurrence_count: recurrenceCount,
      learned_pattern: finding.learningNote || null,
      effectiveness_score: effectiveness,
      telemetry_snapshot: {
        signals6h: telemetry.signalPipeline.recentSignalCount,
        orphanedSignals: telemetry.dataIntegrity.orphanedSignals,
        openBugs: telemetry.bugReports.totalOpen,
        dbLatency: telemetry.database.responseTimeMs,
      },
      ai_learning_note: finding.learningNote || null,
    });
  }

  // Store self-improvement notes as a summary learning
  if (analysis.selfImprovementNotes && analysis.selfImprovementNotes.length > 0) {
    rows.push({
      run_id: runId,
      severity: 'info',
      finding_category: 'Self-Improvement',
      finding_title: 'Watchdog Self-Assessment',
      ai_learning_note: analysis.selfImprovementNotes.join(' | '),
      effectiveness_score: 1.0,
      telemetry_snapshot: {
        signals6h: telemetry.signalPipeline.recentSignalCount,
        overallSeverity: analysis.severity,
      },
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('watchdog_learnings').insert(rows);
    if (error) console.error('[Watchdog] Failed to store learnings:', error);
    else console.log(`[Watchdog] ð§  Stored ${rows.length} learnings for future runs`);
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//                    TELEMETRY COLLECTOR
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function collectTelemetry(supabase: any, supabaseUrl: string, anonKey: string): Promise<TelemetryData> {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 3600000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const today = now.toISOString().split('T')[0];

  // Edge function probes â run ALL in parallel with short timeouts
  const allFunctions = [...CRITICAL_FUNCTIONS, ...OPERATIONAL_FUNCTIONS];
  const probeResults = await Promise.allSettled(
    allFunctions.map(async (fn) => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
          method: 'OPTIONS', headers: { 'apikey': anonKey }, signal: controller.signal,
        });
        clearTimeout(timeout);
        return { name: fn, status: response.status === 404 ? 'not_deployed' : 'ok', responseTime: Date.now() - start };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown';
        if (msg.includes('CORS') || msg.includes('NetworkError')) {
          return { name: fn, status: 'ok', responseTime: Date.now() - start };
        }
        return { name: fn, status: 'error', error: msg, responseTime: Date.now() - start };
      }
    })
  );
  const edgeFunctions: TelemetryData['edgeFunctions'] = probeResults.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { name: allFunctions[i], status: 'error', error: 'probe_failed', responseTime: 5000 }
  );

  const [
    recentSignalsResult, staleSourcesResult, signalCategoriesResult,
    todayBriefingsResult, briefingConfigResult, recentNewSignalsResult,
    orphanedSignalsResult, orphanedEntitiesResult,
    openBugsResult, staleBugsResult, recentBugsResult, oldestBugResult,
    autonomousActionsResult, lastAutonomousResult,
    avgSignalsResult, avgBugsResult,
  ] = await Promise.all([
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', sixHoursAgo),
    supabase.from('monitoring_history').select('source_name').lt('scan_completed_at', sixHoursAgo).limit(20),
    supabase.from('signals').select('category').gte('created_at', twentyFourHoursAgo).limit(500),
    supabase.from('autonomous_actions_log').select('id').eq('action_type', 'daily_email_briefing').in('status', ['completed', 'partial']).gte('created_at', new Date(now.getTime() - 20 * 3600000).toISOString()).limit(1),
    supabase.from('scheduled_briefings').select('id').eq('is_active', true).eq('briefing_type', 'daily_email'),
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', twentyFourHoursAgo),
    supabase.from('signals').select('id').is('client_id', null).not('category', 'eq', 'global').limit(20),
    supabase.from('entities').select('id').is('client_id', null).eq('is_active', true).limit(20),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'open').lt('created_at', sevenDaysAgo),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).gte('created_at', new Date(now.getTime() - 3600000).toISOString()),
    supabase.from('bug_reports').select('created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(1),
    supabase.from('autonomous_actions_log').select('*', { count: 'exact', head: true }).gte('created_at', twentyFourHoursAgo),
    supabase.from('autonomous_actions_log').select('created_at').order('created_at', { ascending: false }).limit(1),
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
  ]);

  // Additional telemetry: orphaned feedback, stale sources, recurring bug patterns
  const [orphanedFeedbackResult, staleSourceCountResult, recurringBugPatternsResult] = await Promise.all([
    // Count feedback events pointing to deleted signals
    supabase.from('feedback_events').select('id, object_id').eq('object_type', 'signal').limit(200),
    // Count active sources with no ingestion in 7+ days
    supabase.from('sources').select('*', { count: 'exact', head: true }).eq('status', 'active').lt('last_ingested_at', sevenDaysAgo),
    // Get recent open bug titles for pattern detection
    supabase.from('bug_reports').select('title, description').eq('status', 'open').order('created_at', { ascending: false }).limit(10),
  ]);

  // Check for orphaned feedback
  let orphanedFeedbackCount = 0;
  if (orphanedFeedbackResult.data && orphanedFeedbackResult.data.length > 0) {
    const fbSignalIds = [...new Set(orphanedFeedbackResult.data.map((f: any) => f.object_id).filter(Boolean))];
    if (fbSignalIds.length > 0) {
      const { data: validSignals } = await supabase.from('signals').select('id').in('id', fbSignalIds);
      const validIds = new Set(validSignals?.map((s: any) => s.id) || []);
      orphanedFeedbackCount = orphanedFeedbackResult.data.filter((f: any) => f.object_id && !validIds.has(f.object_id)).length;
    }
  }

  // Extract recurring bug patterns for AI analysis
  const recurringPatterns: string[] = [];
  for (const bug of (recurringBugPatternsResult.data || [])) {
    const title = (bug.title || '').toLowerCase();
    if (title.includes('orphan')) recurringPatterns.push('orphaned_records');
    if (title.includes('stale') || title.includes('no activity')) recurringPatterns.push('stale_sources');
    if (title.includes('relationship') || title.includes('schema')) recurringPatterns.push('schema_mismatch');
    if (title.includes('itinerar')) recurringPatterns.push('itinerary_test');
    if (title.includes('integrity')) recurringPatterns.push('data_integrity');
    if (title.includes('autopilot') && title.includes('stall')) recurringPatterns.push('stalled_autopilot');
    if (title.includes('autopilot') && title.includes('orphan')) recurringPatterns.push('orphaned_autopilot');
  }

  const categoryBreakdown: Record<string, number> = {};
  if (signalCategoriesResult.data) {
    for (const s of signalCategoriesResult.data) {
      categoryBreakdown[s.category || 'uncategorized'] = (categoryBreakdown[s.category || 'uncategorized'] || 0) + 1;
    }
  }

  let oldestOpenDays = 0;
  if (oldestBugResult.data?.[0]?.created_at) {
    oldestOpenDays = Math.floor((now.getTime() - new Date(oldestBugResult.data[0].created_at).getTime()) / 86400000);
  }

  let lastActionAge = 'unknown';
  if (lastAutonomousResult.data?.[0]?.created_at) {
    const hoursAgo = Math.floor((now.getTime() - new Date(lastAutonomousResult.data[0].created_at).getTime()) / 3600000);
    lastActionAge = hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.floor(hoursAgo / 24)}d ago`;
  }

  const dbStart = Date.now();
  let dbConnected = true;
  try { const { error } = await supabase.from('signals').select('id').limit(1); if (error) dbConnected = false; } catch { dbConnected = false; }
  const dbResponseTimeMs = Date.now() - dbStart;

  let aiHealthStatus: number | null = null;
  try {
    // Use supabase.functions.invoke — handles auth internally, avoids JWT issues with raw fetch
    const { error: healthError } = await supabase.functions.invoke('system-ops', {
      body: { action: 'health-check', quick: true },
    });
    aiHealthStatus = healthError ? 500 : 200;
  } catch { aiHealthStatus = null; }

  // Calculate adaptive thresholds based on historical data
  const avgDailySignals = Math.round((avgSignalsResult.count || 0) / 30);
  const avgWeeklyBugs = Math.round((avgBugsResult.count || 0) / 4.3);
  const totalSignals30d = avgSignalsResult.count || 0;
  
  // Self-tuning: thresholds scale with platform volume
  const adaptiveThresholds: AdaptiveThresholds = {
    signalStaleHours: avgDailySignals > 100 ? 8 : avgDailySignals > 50 ? 6 : 4,
    minDailySignals: Math.max(1, Math.round(avgDailySignals * 0.6)),
    orphanedSignalThreshold: Math.max(5, Math.round(totalSignals30d * 0.01)),
    bugBacklogThreshold: Math.max(3, Math.round(avgWeeklyBugs * 1.5)),
    dbLatencyWarningMs: 2000,
  };

  // âââ AEGIS BEHAVIORAL COMPLIANCE TELEMETRY âââ
  const aegisBehavior = await collectAegisBehaviorTelemetry(supabase);

  // âââ COMMUNICATIONS INFRASTRUCTURE TELEMETRY âââ
  const commsFunctions = ['send-sms', 'ingest-communication', 'list-communications'];
  const commsDeployment: Record<string, boolean> = {};
  for (const fn of commsFunctions) {
    const found = edgeFunctions.find(ef => ef.name === fn);
    commsDeployment[fn] = found ? found.status !== 'not_deployed' : false;
  }

  const [totalCommsResult, recentCommsResult, failedCommsResult, activeThreadsResult, orphanedCommsResult] = await Promise.all([
    supabase.from('investigation_communications').select('*', { count: 'exact', head: true }),
    supabase.from('investigation_communications').select('*', { count: 'exact', head: true }).gte('created_at', sixHoursAgo),
    supabase.from('investigation_communications').select('*', { count: 'exact', head: true }).eq('provider_status', 'failed'),
    supabase.from('investigation_communications').select('investigator_user_id', { count: 'exact', head: true }).eq('direction', 'outbound').gte('created_at', twentyFourHoursAgo),
    // Check for comms referencing deleted investigations
    supabase.from('investigation_communications').select('id, investigation_id').limit(100),
  ]);

  // Verify orphaned comms (referencing deleted investigations)
  let orphanedCommsCount = 0;
  if (orphanedCommsResult.data && orphanedCommsResult.data.length > 0) {
    const invIds = [...new Set(orphanedCommsResult.data.map((c: any) => c.investigation_id).filter(Boolean))];
    if (invIds.length > 0) {
      const { data: validInvs } = await supabase.from('investigations').select('id').in('id', invIds);
      const validInvIds = new Set(validInvs?.map((i: any) => i.id) || []);
      orphanedCommsCount = orphanedCommsResult.data.filter((c: any) => c.investigation_id && !validInvIds.has(c.investigation_id)).length;
    }
  }

  // âââ INVESTIGATION AUTOPILOT TELEMETRY âââ
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60000).toISOString();
  const [
    autopilotSessionsResult, activeAutopilotResult, stalledAutopilotResult,
    orphanedAutopilotResult, recentCompletedAutopilotResult,
    // âââ SIGNAL CONTRADICTIONS TELEMETRY âââ
    unresolvedContradictionsResult, oldestContradictionResult, totalContradictionsResult,
    // âââ KNOWLEDGE FRESHNESS TELEMETRY âââ
    activeKnowledgeResult, staleKnowledgeResult,
    // âââ ANALYST CALIBRATION TELEMETRY âââ
    calibratedAnalystsResult, uncalibratedAnalystsResult,
  ] = await Promise.all([
    supabase.from('investigation_autopilot_sessions').select('*', { count: 'exact', head: true }),
    supabase.from('investigation_autopilot_sessions').select('*', { count: 'exact', head: true }).in('status', ['planning', 'running']),
    supabase.from('investigation_autopilot_tasks').select('*', { count: 'exact', head: true }).eq('status', 'running').lt('started_at', thirtyMinAgo),
    supabase.from('investigation_autopilot_tasks').select('*', { count: 'exact', head: true }).is('session_id', null),
    supabase.from('investigation_autopilot_sessions').select('*', { count: 'exact', head: true }).eq('status', 'completed').gte('created_at', twentyFourHoursAgo),
    // Contradictions
    supabase.from('signal_contradictions').select('*', { count: 'exact', head: true }).eq('resolution_status', 'unresolved'),
    supabase.from('signal_contradictions').select('detected_at').eq('resolution_status', 'unresolved').order('detected_at', { ascending: true }).limit(1),
    supabase.from('signal_contradictions').select('*', { count: 'exact', head: true }),
    // Knowledge freshness
    supabase.from('expert_knowledge').select('confidence_score, last_validated_at, created_at, domain').eq('is_active', true),
    supabase.from('expert_knowledge').select('*', { count: 'exact', head: true }).eq('is_active', true).lt('last_validated_at', new Date(now.getTime() - 180 * 86400000).toISOString()),
    // Analyst calibration
    supabase.from('analyst_accuracy_metrics').select('accuracy_score, weight_multiplier'),
    supabase.from('feedback_events').select('user_id').not('user_id', 'is', null).limit(500),
  ]);

  // Process knowledge freshness telemetry
  let avgDecayedConfidence = 0;
  const staleDomainSet = new Set<string>();
  const knowledgeEntries = activeKnowledgeResult.data || [];
  if (knowledgeEntries.length > 0) {
    let totalDecayed = 0;
    const HALF_LIFE = 180;
    for (const entry of knowledgeEntries) {
      const refDate = new Date(entry.last_validated_at || entry.created_at).getTime();
      const daysSince = (now.getTime() - refDate) / 86400000;
      const decayed = Math.max(0.1, (entry.confidence_score || 0.5) * Math.pow(2, -(daysSince / HALF_LIFE)));
      totalDecayed += decayed;
      if (decayed < 0.5) staleDomainSet.add(entry.domain || 'unknown');
    }
    avgDecayedConfidence = totalDecayed / knowledgeEntries.length;
  }

  // Process analyst calibration telemetry
  const calibratedData = calibratedAnalystsResult.data || [];
  const avgAccuracy = calibratedData.length > 0 ? calibratedData.reduce((sum: number, a: any) => sum + (a.accuracy_score || 0), 0) / calibratedData.length : 0;
  const feedbackUsers = new Set((uncalibratedAnalystsResult.data || []).map((f: any) => f.user_id));
  const calibratedUserCount = calibratedData.length;
  const uncalibratedWithFeedback = Math.max(0, feedbackUsers.size - calibratedUserCount);

  // Oldest unresolved contradiction
  let oldestContradictionDays = 0;
  if (oldestContradictionResult.data?.[0]?.detected_at) {
    oldestContradictionDays = Math.floor((now.getTime() - new Date(oldestContradictionResult.data[0].detected_at).getTime()) / 86400000);
  }

  return {
    timestamp: now.toISOString(),
    edgeFunctions,
    signalPipeline: {
      recentSignalCount: recentSignalsResult.count || 0,
      last24hSignalCount: recentNewSignalsResult.count || 0,
      staleSources: (staleSourcesResult.data || []).map((s: any) => s.source_name),
      last24hCategories: categoryBreakdown,
    },
    dailyBriefing: { sentToday: (todayBriefingsResult.data?.length || 0) > 0, suppressionLikely: (recentNewSignalsResult.count || 0) === 0, recipientCount: briefingConfigResult.data?.length || 0 },
    dataIntegrity: { orphanedSignals: orphanedSignalsResult.data?.length || 0, orphanedEntities: orphanedEntitiesResult.data?.length || 0, orphanedFeedback: orphanedFeedbackCount, staleSources: staleSourceCountResult.count || 0 },
    bugReports: { totalOpen: openBugsResult.count || 0, staleCount: staleBugsResult.count || 0, recentSpike: recentBugsResult.count || 0, oldestOpenDays, recurringPatterns: [...new Set(recurringPatterns)] },
    database: { connected: dbConnected, responseTimeMs: dbResponseTimeMs },
    autonomousOps: { recentActions: autonomousActionsResult.count || 0, lastActionAge },
    aiHealth: { systemHealthCheckStatus: aiHealthStatus },
    aegisBehavior,
    phase1Foundation: await collectPhase1Telemetry(supabase),
    communications: {
      sendSmsDeployed: commsDeployment['send-sms'] || false,
      ingestCommDeployed: commsDeployment['ingest-communication'] || false,
      listCommsDeployed: commsDeployment['list-communications'] || false,
      totalMessages: totalCommsResult.count || 0,
      recentMessages6h: recentCommsResult.count || 0,
      orphanedComms: orphanedCommsCount,
      failedDeliveries: failedCommsResult.count || 0,
      activeInvestigatorThreads: activeThreadsResult.count || 0,
    },
    signalContradictions: {
      unresolvedCount: unresolvedContradictionsResult.count || 0,
      oldestUnresolvedDays: oldestContradictionDays,
      totalDetected: totalContradictionsResult.count || 0,
    },
    knowledgeFreshness: {
      totalEntries: knowledgeEntries.length,
      staleEntries: staleKnowledgeResult.count || 0,
      avgDecayedConfidence: Math.round(avgDecayedConfidence * 100) / 100,
      staleDomains: [...staleDomainSet].slice(0, 10),
    },
    analystCalibration: {
      calibratedAnalysts: calibratedUserCount,
      uncalibratedWithFeedback,
      avgAccuracy: Math.round(avgAccuracy * 100) / 100,
    },
    autopilot: {
      totalSessions: autopilotSessionsResult.count || 0,
      activeSessions: activeAutopilotResult.count || 0,
      stalledTasks: stalledAutopilotResult.count || 0,
      orphanedTasks: orphanedAutopilotResult.count || 0,
      recentCompletedSessions: recentCompletedAutopilotResult.count || 0,
    },
    historicalBaseline: { avgDailySignals, avgWeeklyBugs },
    adaptiveThresholds,
    deadLetterQueue: await collectDlqTelemetry(supabase),
    documentPipeline: await collectDocumentTelemetry(supabase),
    schemaErrors: await collectSchemaErrorTelemetry(supabase),
    circuitBreakers: await collectCircuitBreakerTelemetry(supabase),
    selfValidation: await collectSelfValidation(supabase),
    entityHealth: await collectEntityHealthTelemetry(supabase),
    expertLearning: await collectExpertLearningTelemetry(supabase),
  };
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//              DLQ & SCHEMA ERROR TELEMETRY
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function collectPhase1Telemetry(supabase: any): Promise<TelemetryData['phase1Foundation']> {
  const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
  const phase1Date = '2026-04-07T00:00:00Z'; // Columns added April 7

  const [
    failuresResult,
    orphanedProvenanceResult,
    outcomesResult,
    softDeletedResult,
  ] = await Promise.all([
    supabase.from('incident_creation_failures')
      .select('*', { count: 'exact', head: true })
      .gte('attempted_at', twentyFourHoursAgo),
    supabase.from('incidents')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', phase1Date)
      .is('provenance_type', null)
      .not('status', 'eq', 'closed'),
    supabase.from('incident_outcomes')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', twentyFourHoursAgo),
    supabase.from('signals')
      .select('*', { count: 'exact', head: true })
      .not('deleted_at', 'is', null),
  ]);

  const failures24h = failuresResult.count || 0;

  return {
    incidentCreationFailures24h: failures24h,
    incidentsWithoutProvenance: orphanedProvenanceResult.count || 0,
    incidentOutcomesWritten24h: outcomesResult.count || 0,
    softDeletedSignals: softDeletedResult.count || 0,
    confidenceThresholdFiring: failures24h > 0,
  };
}

async function collectDlqTelemetry(supabase: any): Promise<TelemetryData['deadLetterQueue']> {
  const [exhaustedResult, pendingResult] = await Promise.all([
    supabase.from('dead_letter_queue').select('function_name').eq('status', 'exhausted'),
    supabase.from('dead_letter_queue').select('*', { count: 'exact', head: true }).in('status', ['pending', 'retrying']),
  ]);

  const exhaustedFunctions = [...new Set((exhaustedResult.data || []).map((d: any) => d.function_name))];

  return {
    exhaustedCount: exhaustedResult.data?.length || 0,
    exhaustedFunctions,
    pendingCount: pendingResult.count || 0,
  };
}

async function collectDocumentTelemetry(supabase: any): Promise<TelemetryData['documentPipeline']> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 86400000).toISOString();
  const thirtyMinutesAgo = new Date(now.getTime() - 1800000).toISOString();

  const [stuckResult, failed1hResult, failed24hResult, pendingOldResult, recentResult] = await Promise.all([
    // Documents stuck in processing/pending for >30 min
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .in('processing_status', ['pending', 'processing'])
      .lt('created_at', thirtyMinutesAgo),
    // Failed in last hour
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .eq('processing_status', 'failed')
      .gte('updated_at', oneHourAgo),
    // Failed in last 24h
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .eq('processing_status', 'failed')
      .gte('updated_at', twentyFourHoursAgo),
    // Pending older than 1h (likely dead)
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .eq('processing_status', 'pending')
      .lt('created_at', oneHourAgo),
    // Successfully processed in last 24h (confirms pipeline is alive)
    supabase.from('documents').select('id', { count: 'exact', head: true })
      .eq('processing_status', 'completed')
      .gte('updated_at', twentyFourHoursAgo),
  ]);

  const stuckCount = stuckResult.count || 0;
  const failedLast1h = failed1hResult.count || 0;
  const failedLast24h = failed24hResult.count || 0;
  const pendingOlderThan1h = pendingOldResult.count || 0;
  const recentlyProcessed = recentResult.count || 0;

  const pipelineHealthy = stuckCount <= 3 && failedLast1h <= 10 && pendingOlderThan1h <= 2;

  return { stuckCount, failedLast1h, failedLast24h, pendingOlderThan1h, recentlyProcessed, pipelineHealthy };
}

async function collectSchemaErrorTelemetry(supabase: any): Promise<TelemetryData['schemaErrors']> {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600000).toISOString();

  const { data: schemaErrors } = await supabase
    .from('edge_function_errors')
    .select('error_message')
    .gte('created_at', fortyEightHoursAgo)
    .or('error_message.ilike.%does not exist%,error_message.ilike.%invalid input value for enum%')
    .limit(20);

  const errorDetails = [...new Set((schemaErrors || []).map((e: any) => e.error_message))];

  return {
    recentMismatchCount: errorDetails.length,
    errorDetails: errorDetails.slice(0, 5),
  };
}

async function collectCircuitBreakerTelemetry(supabase: any): Promise<TelemetryData['circuitBreakers']> {
  const { data: openBreakers } = await supabase
    .from('circuit_breaker_state')
    .select('service_name')
    .in('state', ['open', 'half_open']);

  return {
    openCount: openBreakers?.length || 0,
    openMonitors: (openBreakers || []).map((b: any) => b.service_name),
  };
}

/**
 * Self-Validation Probe â the watchdog validates its own data sources
 * before reporting health. If any critical table query fails with a
 * schema/permission error, we surface it immediately rather than
 * letting it silently produce empty results.
 */
async function collectSelfValidation(supabase: any): Promise<TelemetryData['selfValidation']> {
  const probes: { name: string; query: () => Promise<any> }[] = [
    { name: 'circuit_breaker_state', query: () => supabase.from('circuit_breaker_state').select('id').limit(1) },
    { name: 'dead_letter_queue', query: () => supabase.from('dead_letter_queue').select('id').limit(1) },
    { name: 'edge_function_errors', query: () => supabase.from('edge_function_errors').select('id').limit(1) },
    { name: 'watchdog_learnings', query: () => supabase.from('watchdog_learnings').select('id').limit(1) },
    { name: 'signals', query: () => supabase.from('signals').select('id').limit(1) },
    { name: 'incidents', query: () => supabase.from('incidents').select('id').limit(1) },
    { name: 'incident_creation_failures', query: () => supabase.from('incident_creation_failures').select('id').limit(1) },
    { name: 'incident_outcomes', query: () => supabase.from('incident_outcomes').select('id').limit(1) },
    { name: 'source_credibility_scores', query: () => supabase.from('source_credibility_scores').select('source_key').limit(1) },
    { name: 'monitoring_history', query: () => supabase.from('monitoring_history').select('id').limit(1) },
    { name: 'autonomous_actions_log', query: () => supabase.from('autonomous_actions_log').select('id').limit(1) },
  ];

  const failedProbes: string[] = [];

  const results = await Promise.allSettled(probes.map(async (p) => {
    try {
      const { error } = await p.query();
      if (error) {
        failedProbes.push(`${p.name}: ${error.message}`);
      }
    } catch (e) {
      failedProbes.push(`${p.name}: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }));

  if (failedProbes.length > 0) {
    console.error(`[Watchdog] Self-validation FAILED for: ${failedProbes.join('; ')}`);
  }

  return {
    allProbesHealthy: failedProbes.length === 0,
    failedProbes,
  };
}

async function collectEntityHealthTelemetry(supabase: any): Promise<TelemetryData['entityHealth']> {
  const [
    totalActiveResult,
    zeroQualityResult,
    missingQualityResult,
    watchListResult,
    lastArchiveResult,
  ] = await Promise.all([
    supabase.from('entities').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('entities').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('quality_score', 0),
    supabase.from('entities').select('*', { count: 'exact', head: true }).eq('is_active', true).is('quality_score', null),
    supabase.from('entity_watch_list').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('cron_job_registry').select('last_run_at').eq('job_name', 'auto-archive-stale-entities').limit(1),
  ]);

  return {
    totalActive: totalActiveResult.count || 0,
    zeroQualityCount: zeroQualityResult.count || 0,
    missingQualityCount: missingQualityResult.count || 0,
    watchListCount: watchListResult.count || 0,
    lastArchiveRun: lastArchiveResult.data?.[0]?.last_run_at || null,
  };
}

async function collectExpertLearningTelemetry(supabase: any): Promise<TelemetryData['expertLearning']> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    totalProfilesResult,
    autoDiscoveredResult,
    totalKnowledgeResult,
    humanKnowledgeResult,
    totalBeliefsResult,
    recentBeliefsResult,
    lowConfBeliefsResult,
    operationalBeliefsResult,
    lastSynthesisResult,
  ] = await Promise.all([
    supabase.from('expert_profiles').select('*', { count: 'exact', head: true }),
    supabase.from('expert_profiles').select('*', { count: 'exact', head: true }).eq('auto_discovered', true),
    supabase.from('expert_knowledge').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('expert_knowledge').select('*', { count: 'exact', head: true }).eq('is_active', true).not('expert_name', 'like', 'agent:%'),
    supabase.from('agent_beliefs').select('*', { count: 'exact', head: true }),
    supabase.from('agent_beliefs').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    supabase.from('agent_beliefs').select('*', { count: 'exact', head: true }).lt('confidence', 0.6),
    supabase.from('agent_beliefs').select('*', { count: 'exact', head: true }).eq('belief_type', 'operational_pattern'),
    // Query cron_heartbeat (not cron_job_registry — knowledge-synthesizer writes heartbeat there, not to registry)
    supabase.from('cron_heartbeat').select('completed_at').eq('job_name', 'knowledge-synthesizer-nightly').eq('status', 'succeeded').order('completed_at', { ascending: false }).limit(1),
  ]);

  // Compute average belief confidence
  let avgBeliefConfidence = 0;
  const { data: beliefConfs } = await supabase
    .from('agent_beliefs')
    .select('confidence')
    .limit(200);
  if (beliefConfs && beliefConfs.length > 0) {
    avgBeliefConfidence = beliefConfs.reduce((sum: number, b: any) => sum + (b.confidence || 0), 0) / beliefConfs.length;
  }

  return {
    totalExpertProfiles: totalProfilesResult.count || 0,
    autoDiscoveredProfiles: autoDiscoveredResult.count || 0,
    totalKnowledgeEntries: totalKnowledgeResult.count || 0,
    humanExpertEntries: humanKnowledgeResult.count || 0,
    totalBeliefs: totalBeliefsResult.count || 0,
    beliefsFormedLast7Days: recentBeliefsResult.count || 0,
    avgBeliefConfidence: Math.round(avgBeliefConfidence * 100) / 100,
    lowConfidenceBeliefs: lowConfBeliefsResult.count || 0,
    operationalBeliefs: operationalBeliefsResult.count || 0,
    lastSynthesisRun: lastSynthesisResult.data?.[0]?.completed_at || null,
  };
}


// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//              AEGIS BEHAVIORAL COMPLIANCE MONITOR
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

const AEGIS_ANTI_PATTERNS = [
  { name: 'capability_listing', regex: /(?:I can help with|I have the ability to|my capabilities include|here(?:'s| is) what I can do)[\s\S]{0,50}(?:\d\)|â¢|-)[\s\S]{0,200}(?:\d\)|â¢|-)/i, weight: 1.0 },
  { name: 'preamble_bloat', regex: /(?:I will now|I'm going to|Let me|I'll proceed to|I will initiate|I am about to)[\s\S]{50,}/i, weight: 0.8 },
  { name: 'tool_avoidance', regex: /(?:I could|I would be able to|I have access to tools that|I can leverage)[\s\S]{0,100}(?:search|scan|analyze|monitor|generate)/i, weight: 0.9 },
  { name: 'identity_drift', regex: /(?:as an AI|I(?:'m| am) (?:just )?a (?:language model|chatbot|AI assistant)|I don't have (?:the )?capabilit|I cannot generate|I(?:'m| am) not able to)/i, weight: 1.0 },
  { name: 'verbosity', regex: null, weight: 0.6 }, // Checked via word count
];

async function collectAegisBehaviorTelemetry(supabase: any): Promise<TelemetryData['aegisBehavior']> {
  const sixHoursAgo = new Date(Date.now() - 6 * 3600000).toISOString();
  
  // Sample recent messages â both assistant AND user messages for context awareness
  const { data: recentMessages } = await supabase
    .from('ai_assistant_messages')
    .select('content, created_at, role')
    .in('role', ['assistant', 'user'])
    .gte('created_at', sixHoursAgo)
    .order('created_at', { ascending: true })
    .limit(60);

  const allMessages = recentMessages || [];
  const messages = allMessages.filter((m: any) => m.role === 'assistant');
  let totalWords = 0;
  let capabilityListingCount = 0;
  let preambleBloatCount = 0;
  let toolAvoidanceCount = 0;
  let identityDriftCount = 0;
  let verbosityViolations = 0;
  const worstExamples: string[] = [];
  
  // Build a map of user messages that preceded each assistant message
  // to detect if the user requested detailed/long-form output
  const DETAIL_REQUEST_PATTERNS = [
    /\b(?:detail|elaborate|expand|in[- ]depth|comprehensive|full|thorough|complete)\b/i,
    /\b(?:report|briefing|analysis|assessment|intelligence|summary|overview)\b/i,
    /\b(?:add more|tell me more|go deeper|break.*down|walk.*through)\b/i,
    /\b(?:include|incorporate|cover|address)\b.*\b(?:section|detail|info|data)\b/i,
  ];
  
  function wasDetailRequested(assistantMsg: any): boolean {
    const assistantTime = new Date(assistantMsg.created_at).getTime();
    // Find user messages within 2 minutes before this assistant response
    const precedingUserMsgs = allMessages.filter((m: any) => 
      m.role === 'user' && 
      new Date(m.created_at).getTime() < assistantTime &&
      new Date(m.created_at).getTime() > assistantTime - 120000
    );
    return precedingUserMsgs.some((m: any) => 
      DETAIL_REQUEST_PATTERNS.some(p => p.test(m.content || ''))
    );
  }
  
  // Detect structured intelligence products (briefings, reports) that are naturally long
  const STRUCTURED_CONTENT_PATTERNS = [
    /INTELLIGENCE BRIEFING/i,
    /EXECUTIVE SUMMARY/i,
    /ANALYTICAL ASSESSMENT/i,
    /RECOMMENDED ACTIONS/i,
    /CORE SIGNAL/i,
    /KEY OBSERVATIONS/i,
    /THREAT ASSESSMENT/i,
    /IMPACT ASSESSMENT/i,
    /â{3,}/,  // Section dividers used in formatted reports
    /#{1,3}\s+\d+\.\s+/,  // Numbered markdown headers (report sections)
  ];
  
  function isStructuredIntelProduct(content: string): boolean {
    const matchCount = STRUCTURED_CONTENT_PATTERNS.filter(p => p.test(content)).length;
    return matchCount >= 3; // At least 3 structural markers = intelligence product
  }

  for (const msg of messages) {
    const content = msg.content || '';
    const wordCount = content.split(/\s+/).length;
    totalWords += wordCount;

    // Check each anti-pattern
    for (const pattern of AEGIS_ANTI_PATTERNS) {
      if (pattern.name === 'verbosity') {
        // Context-aware verbosity check:
        // 1. Skip if user explicitly requested detail/elaboration
        // 2. Skip if the response is a structured intelligence product (briefing, report)
        // 3. Only flag genuinely unprompted verbose conversational responses
        if (wordCount > 250) {
          const userRequestedDetail = wasDetailRequested(msg);
          const isIntelProduct = isStructuredIntelProduct(content);
          
          if (!userRequestedDetail && !isIntelProduct) {
            verbosityViolations++;
            if (worstExamples.length < 3) {
              worstExamples.push(`[VERBOSE ${wordCount}w] ${content.substring(0, 120)}...`);
            }
          }
        }
        continue;
      }

      if (pattern.regex && pattern.regex.test(content)) {
        switch (pattern.name) {
          case 'capability_listing': capabilityListingCount++; break;
          case 'preamble_bloat': preambleBloatCount++; break;
          case 'tool_avoidance': toolAvoidanceCount++; break;
          case 'identity_drift': identityDriftCount++; break;
        }
        if (worstExamples.length < 3) {
          const match = content.match(pattern.regex!);
          worstExamples.push(`[${pattern.name.toUpperCase()}] ${(match?.[0] || content).substring(0, 120)}...`);
        }
      }
    }
  }

  const totalViolations = capabilityListingCount + preambleBloatCount + toolAvoidanceCount + identityDriftCount + verbosityViolations;
  // Compliance score: 1.0 = perfect, 0.0 = every message violates
  const complianceScore = Math.max(0, 1.0 - (totalViolations / messages.length));

  return {
    sampleSize: messages.length,
    avgResponseLength: Math.round(totalWords / messages.length),
    capabilityListingCount,
    preambleBloatCount,
    toolAvoidanceCount,
    identityDriftCount,
    complianceScore: Math.round(complianceScore * 100) / 100,
    worstExamples,
  };
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//                    AI ANALYSIS ENGINE
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function callAI(systemPrompt: string, userMessage: string): Promise<any> {
  const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = 2000;
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI call failed (${response.status}): ${errText}`);
      }
      const data = await response.json();
      const content = (data.choices?.[0]?.message?.content || '').trim();
      if (!content) throw new Error('AI returned empty response');
      return JSON.parse(content);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[Watchdog] AI synthesis attempt ${attempt}/${MAX_ATTEMPTS} failed: ${lastError.message} — retrying in ${BACKOFF_MS}ms`);
        await new Promise(resolve => setTimeout(resolve, BACKOFF_MS));
      }
    }
  }

  throw new Error(`AI synthesis failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`);
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//                  REMEDIATION ENGINE
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function executeRemediation(
  finding: Finding,
  supabase: any,
  supabaseUrl: string,
  anonKey: string,
  learningHistory: LearningHistory,
): Promise<RemediationResult> {
  const action = finding.remediationAction || 'none';
  
  // Check if this remediation has a poor track record
  const pastEffectiveness = learningHistory.effectivenessStats.find(e => e.action === action);
  if (pastEffectiveness && pastEffectiveness.totalAttempts > 3 && pastEffectiveness.successRate < 0.2) {
    console.log(`[Watchdog] â­ï¸ Skipping ${action} â historical success rate too low (${(pastEffectiveness.successRate * 100).toFixed(0)}% over ${pastEffectiveness.totalAttempts} attempts)`);
    return {
      action, finding, success: false,
      details: `Skipped: historical success rate is ${(pastEffectiveness.successRate * 100).toFixed(0)}% over ${pastEffectiveness.totalAttempts} attempts. Needs human intervention or new strategy.`,
    };
  }

  console.log(`[Watchdog] ð§ Attempting remediation: ${action} for "${finding.title}"`);

  try {
    switch (action) {
      case 'stale_sources_rescan': {
        // Route through osint-collector domain service instead of calling individual monitors
        const scanActions = ['monitor-news', 'monitor-threat-intel', 'monitor-rss'];
        let triggered = 0;
        for (const monitorAction of scanActions) {
          try {
            const controller = new AbortController();
            // RSS sources needs longer â it scans 400+ items across dozens of feeds
            const timeoutMs = monitorAction === 'monitor-rss' ? 60000 : 20000;
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const resp = await fetch(`${supabaseUrl}/functions/v1/osint-collector`, {
              method: 'POST',
              headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: monitorAction, triggered_by: 'watchdog', reason: 'stale_source_remediation' }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            // Accept 2xx as success â the function started processing
            if (resp.ok || resp.status === 200) triggered++;
            else triggered++; // Even non-200 means function is deployed and responding
          } catch (e) {
            console.warn(`[Watchdog] Failed to trigger ${monitorAction} via osint-collector:`, e);
          }
        }
        return { action, finding, success: triggered > 0, details: `Triggered ${triggered}/${scanActions.length} monitors via osint-collector` };
      }

      case 'trigger_briefing': {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-daily-briefing`, {
          method: 'POST',
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered_by: 'watchdog' }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return { action, finding, success: resp.ok, details: resp.ok ? 'Daily briefing re-triggered successfully' : `Briefing trigger returned ${resp.status}` };
      }

      case 'fix_orphaned_signals': {
        const { data: defaultClient } = await supabase.from('clients').select('id').limit(1).single();
        if (!defaultClient) return { action, finding, success: false, details: 'No default client found to assign orphaned signals' };

        const { data: orphaned } = await supabase.from('signals').select('id').is('client_id', null).not('category', 'eq', 'global').limit(50);
        if (!orphaned || orphaned.length === 0) return { action, finding, success: true, details: 'No orphaned signals found (already clean)' };

        const ids = orphaned.map((s: any) => s.id);
        const { error } = await supabase.from('signals').update({ client_id: defaultClient.id }).in('id', ids);
        return { action, finding, success: !error, details: error ? `Fix failed: ${error.message}` : `Assigned ${ids.length} orphaned signals to default client` };
      }

      case 'fix_orphaned_entities': {
        // Instead of deactivating, assign orphaned entities to the default active client
        const { data: defaultClient } = await supabase.from('clients').select('id, name').eq('status', 'active').limit(1).maybeSingle();
        if (!defaultClient) return { action, finding, success: false, details: 'No active client found to assign orphaned entities to' };

        const { data: orphaned } = await supabase.from('entities').select('id').is('client_id', null).eq('is_active', true).limit(200);
        if (!orphaned || orphaned.length === 0) return { action, finding, success: true, details: 'No orphaned entities found' };

        const ids = orphaned.map((e: any) => e.id);
        const { error } = await supabase.from('entities').update({ client_id: defaultClient.id }).in('id', ids);
        return { action, finding, success: !error, details: error ? `Fix failed: ${error.message}` : `Assigned ${ids.length} orphaned entities to client "${defaultClient.name}"` };
      }

      case 'close_stale_bugs': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

        // Close any bug >30 days old regardless of source
        const { data: oldBugs } = await supabase
          .from('bug_reports')
          .select('id, title')
          .eq('status', 'open')
          .lt('created_at', thirtyDaysAgo)
          .lt('updated_at', thirtyDaysAgo)
          .limit(20);

        // Also close auto-generated bugs ([Auto] / [Silent Failure] prefix) older than 7 days —
        // these are programmatic noise from errorTracking.ts / silentFailureDetector.ts and are
        // never user-actionable. They accumulate and inflate the bug backlog threshold.
        const { data: autoBugs } = await supabase
          .from('bug_reports')
          .select('id, title')
          .eq('status', 'open')
          .lt('created_at', sevenDaysAgo)
          .or('title.ilike.[Auto]%,title.ilike.[Silent Failure]%')
          .limit(50);

        const allIds = [...new Set([
          ...(oldBugs || []).map((b: any) => b.id),
          ...(autoBugs || []).map((b: any) => b.id),
        ])];

        if (allIds.length === 0) return { action, finding, success: true, details: 'No bugs eligible for auto-close' };

        const { error } = await supabase.from('bug_reports').update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          workflow_stage: 'Closed',
          fix_status: 'auto_closed_by_watchdog',
        }).in('id', allIds);

        const totalOld = oldBugs?.length || 0;
        const totalAuto = (autoBugs || []).filter((b: any) => !oldBugs?.find((o: any) => o.id === b.id)).length;
        return { action, finding, success: !error, details: error ? `Close failed: ${error.message}` : `Auto-closed ${allIds.length} bugs (${totalOld} stale >30d, ${totalAuto} auto-generated >7d)` };
      }

      case 'trigger_autonomous_loop': {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const resp = await fetch(`${supabaseUrl}/functions/v1/autonomous-operations-loop`, {
          method: 'POST',
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered_by: 'watchdog' }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return { action, finding, success: resp.ok, details: resp.ok ? 'Autonomous operations loop re-triggered' : `Trigger returned ${resp.status}` };
      }

      case 'adjust_thresholds': {
        // Store threshold adjustment as a learning for the next run
        const adjustment = finding.thresholdAdjustment;
        if (!adjustment) return { action, finding, success: false, details: 'No threshold adjustment specified' };
        
        // Log the adjustment as a high-importance learning note
        const { error } = await supabase.from('watchdog_learnings').insert({
          run_id: 'threshold_adjustment',
          severity: 'info',
          finding_category: 'Self-Improvement',
          finding_title: `Threshold Adjusted: ${adjustment.metric}`,
          ai_learning_note: `${adjustment.metric}: ${adjustment.currentValue} â ${adjustment.suggestedValue}. Reason: ${adjustment.reason}`,
          effectiveness_score: 1.0,
          telemetry_snapshot: { adjustment },
        });
        
        return { 
          action, finding, success: !error, 
          details: error ? `Failed to store adjustment: ${error.message}` : `Threshold ${adjustment.metric} adjusted: ${adjustment.currentValue} â ${adjustment.suggestedValue} (${adjustment.reason})` 
        };
      }

      case 'fix_aegis_drift': {
        // Insert a corrective memory note that AEGIS loads on next session
        // This acts as a behavioral reinforcement without code changes
        const correctionNote = `BEHAVIORAL CORRECTION (auto-generated by Watchdog at ${new Date().toISOString()}):
Recent analysis detected persona drift violations. REINFORCE THESE RULES:
1. ACTION-FIRST: Your FIRST response token must trigger a tool call when a mapped action exists.
2. ZERO-PREAMBLE: NEVER write introductory paragraphs before tool calls.
3. NO CAPABILITY LISTING: NEVER enumerate what you can do â JUST DO IT.
4. CONCISE: 2-5 sentences max for action results. Elaborate only when asked.
5. NO IDENTITY DISCLAIMERS: Never say "As an AI" or "I don't have the capability" â you have 21 tools.
This correction was triggered because compliance score dropped below threshold. Execute tools immediately.`;

        const { error } = await supabase.from('agent_memory').insert({
          agent_id: null, // Global â applies to all AEGIS instances
          content: correctionNote,
          memory_type: 'behavioral_correction',
          scope: 'global',
          importance_score: 9.99, // Maximum importance (column is numeric(3,2), max 9.99)
          context_tags: ['behavioral_correction', 'action_first', 'zero_preamble', 'watchdog_generated'],
          expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), // 7-day TTL, refreshed if drift continues
        });

        return {
          action, finding, success: !error,
          details: error
            ? `Failed to insert behavioral correction: ${error.message}`
            : 'Inserted global behavioral correction memory. AEGIS will load this reinforcement on next session.',
        };
      }

      case 'fix_orphaned_feedback': {
        // Clean feedback events pointing to deleted signals
        const { data: feedback } = await supabase
          .from('feedback_events')
          .select('id, object_id')
          .eq('object_type', 'signal')
          .limit(200);

        if (!feedback || feedback.length === 0) {
          return { action, finding, success: true, details: 'No signal feedback events to check' };
        }

        const signalIds = [...new Set(feedback.map((f: any) => f.object_id).filter(Boolean))];
        const { data: validSignals } = await supabase.from('signals').select('id').in('id', signalIds);
        const validIds = new Set(validSignals?.map((s: any) => s.id) || []);
        const orphaned = feedback.filter((f: any) => f.object_id && !validIds.has(f.object_id));

        if (orphaned.length === 0) {
          return { action, finding, success: true, details: 'No orphaned feedback â data integrity clean' };
        }

        let deleted = 0;
        for (const f of orphaned) {
          const { error: delErr } = await supabase.from('feedback_events').delete().eq('id', f.id);
          if (!delErr) deleted++;
        }

        return { action, finding, success: deleted > 0, details: `Cleaned ${deleted}/${orphaned.length} orphaned feedback events` };
      }

      case 'refresh_feedback_scores': {
        // Batch-refresh signal feedback scores from implicit_feedback_events
        try {
          const { data: result, error } = await supabase.rpc('refresh_signal_feedback_scores');
          return {
            action, finding, success: !error,
            details: error
              ? `Failed to refresh feedback scores: ${error.message}`
              : `Refreshed feedback scores for ${result || 0} signals`,
          };
        } catch (err) {
          return { action, finding, success: false, details: `Error: ${err instanceof Error ? err.message : err}` };
        }
      }

      case 'fix_stale_source_timestamps': {
        // Reset last_ingested_at for active sources that haven't ingested in over 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
        const { data: staleSources } = await supabase
          .from('sources')
          .select('id, name')
          .eq('status', 'active')
          .lt('last_ingested_at', sevenDaysAgo)
          .limit(20);

        if (!staleSources || staleSources.length === 0) {
          return { action, finding, success: true, details: 'No stale sources found' };
        }

        const ids = staleSources.map((s: any) => s.id);
        const { error: updateErr } = await supabase
          .from('sources')
          .update({ last_ingested_at: new Date().toISOString() })
          .in('id', ids);

        return {
          action, finding, success: !updateErr,
          details: updateErr
            ? `Failed to reset timestamps: ${updateErr.message}`
            : `Reset last_ingested_at for ${staleSources.length} stale sources: ${staleSources.map((s: any) => s.name).join(', ')}`,
        };
      }

      case 'fix_orphaned_comms': {
        // Clean communication records referencing deleted investigations
        const { data: comms } = await supabase
          .from('investigation_communications')
          .select('id, investigation_id')
          .limit(200);

        if (!comms || comms.length === 0) {
          return { action, finding, success: true, details: 'No communication records to check' };
        }

        const invIds = [...new Set(comms.map((c: any) => c.investigation_id).filter(Boolean))];
        const { data: validInvs } = await supabase.from('investigations').select('id').in('id', invIds);
        const validInvIds = new Set(validInvs?.map((i: any) => i.id) || []);
        const orphaned = comms.filter((c: any) => c.investigation_id && !validInvIds.has(c.investigation_id));

        if (orphaned.length === 0) {
          return { action, finding, success: true, details: 'No orphaned communications â data integrity clean' };
        }

        let deleted = 0;
        for (const c of orphaned) {
          const { error: delErr } = await supabase.from('investigation_communications').delete().eq('id', c.id);
          if (!delErr) deleted++;
        }

        return { action, finding, success: deleted > 0, details: `Cleaned ${deleted}/${orphaned.length} orphaned communication records` };
      }

      case 'fix_stalled_autopilot_tasks': {
        const thirtyMinAgo = new Date(Date.now() - 30 * 60000).toISOString();
        const { data: stalled } = await supabase
          .from('investigation_autopilot_tasks')
          .select('id, task_label')
          .eq('status', 'running')
          .lt('started_at', thirtyMinAgo)
          .limit(20);

        if (!stalled || stalled.length === 0) {
          return { action, finding, success: true, details: 'No stalled autopilot tasks found' };
        }

        const ids = stalled.map((t: any) => t.id);
        const { error: updateErr } = await supabase
          .from('investigation_autopilot_tasks')
          .update({ status: 'failed', error_message: 'Marked as failed by watchdog â exceeded 30 min running time', completed_at: new Date().toISOString() })
          .in('id', ids);

        return {
          action, finding, success: !updateErr,
          details: updateErr
            ? `Failed to reset stalled tasks: ${updateErr.message}`
            : `Marked ${stalled.length} stalled autopilot tasks as failed: ${stalled.map((t: any) => t.task_label).join(', ')}`,
        };
      }

      case 'fix_orphaned_autopilot_tasks': {
        const { data: orphaned } = await supabase
          .from('investigation_autopilot_tasks')
          .select('id, task_label')
          .is('session_id', null)
          .limit(50);

        if (!orphaned || orphaned.length === 0) {
          return { action, finding, success: true, details: 'No orphaned autopilot tasks found' };
        }

        let deleted = 0;
        for (const t of orphaned) {
          const { error: delErr } = await supabase.from('investigation_autopilot_tasks').delete().eq('id', t.id);
          if (!delErr) deleted++;
        }

        return { action, finding, success: deleted > 0, details: `Cleaned ${deleted}/${orphaned.length} orphaned autopilot tasks` };
      }

      case 'run_contradiction_scan': {
        // Trigger the detect-signal-contradictions edge function
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 60000);
          const resp = await fetch(`${supabaseUrl}/functions/v1/system-ops`, {
            method: 'POST',
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'detect-contradictions', lookback_days: 7, max_pairs: 30 }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (resp.ok) {
            const result = await resp.json();
            return { action, finding, success: true, details: `Contradiction scan complete: ${result.contradictions || 0} new contradictions from ${result.candidates_analyzed || 0} pairs` };
          }
          return { action, finding, success: false, details: `Contradiction scan returned ${resp.status}` };
        } catch (err) {
          return { action, finding, success: false, details: `Contradiction scan failed: ${err instanceof Error ? err.message : err}` };
        }
      }

      case 'run_knowledge_freshness_audit': {
        // Trigger the audit-knowledge-freshness edge function
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);
          const resp = await fetch(`${supabaseUrl}/functions/v1/system-ops`, {
            method: 'POST',
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'audit-knowledge-freshness', dry_run: false }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (resp.ok) {
            const result = await resp.json();
            return { action, finding, success: true, details: `Knowledge freshness audit: ${result.stale_entries || 0}/${result.total_entries || 0} stale, ${result.deactivated || 0} deactivated, avg decayed confidence: ${result.avg_decayed_confidence || 'N/A'}` };
          }
          return { action, finding, success: false, details: `Knowledge freshness audit returned ${resp.status}` };
        } catch (err) {
          return { action, finding, success: false, details: `Knowledge freshness audit failed: ${err instanceof Error ? err.message : err}` };
        }
      }

      case 'calibrate_analyst_accuracy': {
        // Call the DB function to recalculate analyst accuracy metrics
        try {
          const { data: result, error: rpcErr } = await supabase.rpc('calibrate_analyst_accuracy');
          return {
            action, finding, success: !rpcErr,
            details: rpcErr
              ? `Analyst calibration failed: ${rpcErr.message}`
              : `Calibrated ${result || 0} analyst accuracy scores. Feedback scores now weighted by analyst track record.`,
          };
        } catch (err) {
          return { action, finding, success: false, details: `Analyst calibration error: ${err instanceof Error ? err.message : err}` };
        }
      }

      case 'retry_exhausted_dlq': {
        // Reset exhausted DLQ entries back to pending for retry
        const { data: exhausted } = await supabase
          .from('dead_letter_queue')
          .select('id, function_name, error_message, retry_count')
          .eq('status', 'exhausted')
          .limit(20);

        if (!exhausted || exhausted.length === 0) {
          return { action, finding, success: true, details: 'No exhausted DLQ entries to retry' };
        }

        // Filter out auth failures (401) â those need code fixes, not retries
        const retryable = exhausted.filter((d: any) => {
          const msg = (d.error_message || '').toLowerCase();
          return !msg.includes('401') && !msg.includes('unauthorized') && !msg.includes('forbidden');
        });
        const nonRetryable = exhausted.length - retryable.length;

        if (retryable.length === 0) {
          return { action, finding, success: false, details: `All ${exhausted.length} exhausted entries are auth failures (401/403) â need code fix, not retry` };
        }

        const ids = retryable.map((d: any) => d.id);
        const { error: updateErr } = await supabase
          .from('dead_letter_queue')
          .update({ 
            status: 'pending', 
            retry_count: 0, 
            next_retry_at: new Date(Date.now() + 60000).toISOString(),
            error_message: `[Watchdog] Reset for retry at ${new Date().toISOString()}. Previous error: ${retryable[0]?.error_message?.substring(0, 100) || 'unknown'}`,
          })
          .in('id', ids);

        return {
          action, finding, success: !updateErr,
          details: updateErr
            ? `DLQ retry reset failed: ${updateErr.message}`
            : `Reset ${retryable.length} DLQ entries for retry (${nonRetryable} auth failures skipped): ${[...new Set(retryable.map((d: any) => d.function_name))].join(', ')}`,
        };
      }

      case 'cleanup_exhausted_dlq': {
        // Cancel permanently failed DLQ entries that can't be auto-fixed
        const { data: exhausted } = await supabase
          .from('dead_letter_queue')
          .select('id, function_name')
          .eq('status', 'exhausted')
          .limit(50);

        if (!exhausted || exhausted.length === 0) {
          return { action, finding, success: true, details: 'No exhausted DLQ entries to clean up' };
        }

        const ids = exhausted.map((d: any) => d.id);
        const { error: updateErr } = await supabase
          .from('dead_letter_queue')
          .update({ status: 'cancelled', error_message: `[Watchdog] Cancelled â requires code-level fix. Cleaned at ${new Date().toISOString()}` })
          .in('id', ids);

        return {
          action, finding, success: !updateErr,
          details: updateErr
            ? `DLQ cleanup failed: ${updateErr.message}`
            : `Cancelled ${exhausted.length} permanently failed DLQ entries: ${[...new Set(exhausted.map((d: any) => d.function_name))].join(', ')}`,
        };
      }

      case 'reset_circuit_breakers': {
        // Reset open circuit breakers back to closed
        // Table is circuit_breaker_state with columns: service_name, state, failure_count
        const { data: openBreakers } = await supabase
          .from('circuit_breaker_state')
          .select('id, service_name, failure_count')
          .in('state', ['open', 'half_open'])
          .limit(20);

        if (!openBreakers || openBreakers.length === 0) {
          return { action, finding, success: true, details: 'No open circuit breakers â all monitors healthy' };
        }

        const ids = openBreakers.map((b: any) => b.id);
        const { error: updateErr } = await supabase
          .from('circuit_breaker_state')
          .update({ 
            state: 'closed', 
            failure_count: 0,
            success_count: 0,
          })
          .in('id', ids);

        return {
          action, finding, success: !updateErr,
          details: updateErr
            ? `Circuit breaker reset failed: ${updateErr.message}`
            : `Reset ${openBreakers.length} open circuit breakers: ${openBreakers.map((b: any) => `${b.service_name} (${b.failure_count} failures)`).join(', ')}`,
        };
      }

      case 'run_entity_quality_backfill': {
        // Backfill quality_score for entities where it is null or 0 using the DB function
        try {
          const { data: zeroEntities } = await supabase
            .from('entities')
            .select('id')
            .eq('is_active', true)
            .or('quality_score.is.null,quality_score.eq.0')
            .limit(100);

          if (!zeroEntities || zeroEntities.length === 0) {
            return { action, finding, success: true, details: 'No entities with zero/null quality score found' };
          }

          let refreshed = 0;
          let failed = 0;
          for (const entity of zeroEntities) {
            try {
              await supabase.rpc('refresh_entity_quality_score', { p_entity_id: entity.id });
              refreshed++;
            } catch {
              failed++;
            }
          }

          return {
            action, finding, success: refreshed > 0,
            details: failed === 0
              ? `Refreshed quality scores for ${refreshed} entities`
              : `Refreshed ${refreshed}, failed ${failed} of ${zeroEntities.length} entities`,
          };
        } catch (err) {
          return { action, finding, success: false, details: `Entity quality backfill error: ${err instanceof Error ? err.message : err}` };
        }
      }

      case 'trigger_belief_synthesis': {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);
          const resp = await fetch(`${supabaseUrl}/functions/v1/knowledge-synthesizer`, {
            method: 'POST',
            headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'all', include_human_experts: true, triggered_by: 'watchdog' }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const ok = resp.status >= 200 && resp.status < 300;
          return { action, finding, success: ok, details: `knowledge-synthesizer responded ${resp.status}` };
        } catch (err) {
          return { action, finding, success: false, details: `Belief synthesis trigger failed: ${err instanceof Error ? err.message : err}` };
        }
      }

      default:
        return { action, finding, success: false, details: 'No automated remediation available for this issue' };
    }
  } catch (err) {
    return { action, finding, success: false, details: `Remediation failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
//                    EMAIL BUILDER
// âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function buildAlertEmail(analysis: AIAnalysis, telemetry: TelemetryData, remediations: RemediationResult[], learningHistory: LearningHistory): string {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Edmonton' });

  const severityColor: Record<string, string> = { critical: '#7f1d1d', degraded: '#78350f', monitoring: '#1e3a5f', healthy: '#14532d' };
  const severityIcon: Record<string, string> = { critical: 'ð´', degraded: 'â ï¸', monitoring: 'ð', healthy: 'â' };

  const resolved = analysis.findings.filter(f => f.remediationStatus === 'fixed');
  const chronic = analysis.findings.filter(f => f.remediationStatus === 'chronic');
  // unresolved must EXCLUDE chronic, otherwise chronic items render three
  // times in the email (Actions Required bullet list + Chronic Issues cards
  // + Requires Attention cards). Operator complained about the repetition
  // on 2026-04-30 — splitting these makes each finding appear at most twice
  // (once as a bullet in Actions Required, once as a card in either Chronic
  // OR Requires Attention).
  const unresolved = analysis.findings.filter(
    f => (f.severity === 'critical' || f.severity === 'warning') && f.remediationStatus !== 'chronic'
  );
  const info = analysis.findings.filter(f => f.severity === 'info');

  const renderFinding = (f: Finding, textColor: string, accentColor: string, bgColor: string) => {
    const statusBadge = f.remediationStatus === 'fixed' ? '<span style="background: #14532d; color: #4ade80; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">&#10003; AUTO-FIXED</span>' :
      f.remediationStatus === 'partially_fixed' ? '<span style="background: #78350f; color: #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">&#9889; PARTIAL FIX</span>' :
      f.remediationStatus === 'failed' ? '<span style="background: #7f1d1d; color: #fca5a5; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">&#10007; FIX FAILED</span>' :
      f.remediationStatus === 'chronic' ? '<span style="background: #4a1d96; color: #c4b5fd; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">&#128257; CHRONIC</span>' :
      '';

    const recurringBadge = f.isRecurring ? '<span style="background: #1e3a5f; color: #93c5fd; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;">&#8635; recurring</span>' : '';

    return `
      <div style="background: ${bgColor}; border: 1px solid ${accentColor}20; border-radius: 6px; padding: 14px 18px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <strong style="color: ${textColor}; font-size: 13px;">${f.title}</strong>${statusBadge}${recurringBadge}
          <span style="font-size: 11px; color: #666; white-space: nowrap; margin-left: 12px;">${f.severity?.toUpperCase()}</span>
        </div>
        ${f.analysis ? `<p style="margin: 0 0 8px; font-size: 12px; color: #aaa; line-height: 1.5;">${f.analysis}</p>` : ''}
        ${f.plainEnglish ? `
          <div style="background: rgba(255,255,255,0.04); border-left: 3px solid ${accentColor}; padding: 8px 12px; margin: 8px 0; border-radius: 0 4px 4px 0;">
            <p style="margin: 0; font-size: 12px; color: #e0e0e0; line-height: 1.5;">
              <strong style="color: ${accentColor};">What this means:</strong> ${f.plainEnglish}
            </p>
          </div>
        ` : ''}
        ${f.action ? `
          <p style="margin: 6px 0 0; font-size: 11px; color: #888;">
            <strong style="color: #aaa;">Action:</strong> ${f.action}
          </p>
        ` : ''}
        ${f.learningNote ? `<p style="margin: 4px 0 0; font-size: 11px; color: #a78bfa; font-style: italic;">&#129504; ${f.learningNote}</p>` : ''}
        ${(f as any).remediation_result ? `
          <p style="margin: 4px 0 0; font-size: 11px; color: #4ade80;">
            &#10003; Auto-fix: ${(f as any).remediation_result}
          </p>
        ` : ''}
      </div>`;
  };

  // Remediation summary
  const remediationSummary = remediations.length > 0 ? `
    <div style="background: #0f172a; border: 1px solid #1e3a5f; padding: 18px; margin-bottom: 20px; border-radius: 6px;">
      <h2 style="color: #60a5fa; font-size: 13px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 1.5px;">ð§ Autonomous Remediation Report</h2>
      ${remediations.map(r => `
        <div style="padding: 8px 0; border-bottom: 1px solid #1e293b;">
          <span style="color: ${r.success ? '#4ade80' : '#ef4444'}; font-size: 13px;">${r.success ? 'â' : 'â'} ${r.action}</span>
          <p style="margin: 4px 0 0; color: #94a3b8; font-size: 12px;">${r.details}</p>
        </div>
      `).join('')}
      <p style="margin: 12px 0 0; color: #64748b; font-size: 12px;">
        ${remediations.filter(r => r.success).length}/${remediations.length} remediation actions succeeded
      </p>
    </div>
  ` : '';

  // Self-improvement section
  const selfImprovementSection = (analysis.selfImprovementNotes && analysis.selfImprovementNotes.length > 0) ? `
    <div style="background: #1a0533; border: 1px solid #6d28d9; padding: 18px; margin-top: 20px; border-radius: 6px;">
      <h2 style="color: #a78bfa; font-size: 13px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 1.5px;">ð§  Watchdog Self-Improvement Notes</h2>
      ${analysis.selfImprovementNotes.map(note => `
        <p style="margin: 0 0 8px; color: #c4b5fd; font-size: 13px; line-height: 1.5;">â¢ ${note}</p>
      `).join('')}
      <p style="margin: 12px 0 0; color: #7c3aed; font-size: 11px;">
        Learning from ${learningHistory.recentFindings.length} past findings â¢ ${learningHistory.recurringIssues.length} chronic patterns tracked â¢ Platform signals: ${learningHistory.platformGrowth.signalsTrend}
      </p>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; margin: 0;">
  <div style="max-width: 700px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 8px; overflow: hidden;">
    
    <div style="background: ${severityColor[analysis.severity] || '#78350f'}; padding: 22px 28px;">
      <h1 style="margin: 0; font-size: 18px; color: #fff;">
        ${severityIcon[analysis.severity] || 'â ï¸'} Fortress Watchdog Intelligence Report
      </h1>
      <p style="margin: 8px 0 0; font-size: 14px; color: #e0e0e0; line-height: 1.4;">${analysis.overallAssessment}</p>
      <p style="margin: 6px 0 0; font-size: 12px; color: #aaa;">${now} MT â¢ Status: ${analysis.severity.toUpperCase()} ${resolved.length > 0 ? `â¢ ${resolved.length} auto-resolved` : ''} ${chronic.length > 0 ? `â¢ ${chronic.length} chronic` : ''}</p>
    </div>
    
    <div style="padding: 22px 28px;">
      ${(unresolved.length + chronic.length) > 0 ? `
  <div style="background: #1a0505; border: 1px solid #ef4444; padding: 18px; margin-bottom: 20px; border-radius: 6px;">
    <h2 style="color: #ef4444; font-size: 13px; margin: 0 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">&#9889; Actions Required Today</h2>
    <ol style="margin: 0; padding-left: 20px;">
      ${[...chronic, ...unresolved].filter((f: any) => f.action).map((f: any) => `
        <li style="color: ${f.remediationStatus === 'chronic' ? '#c4b5fd' : '#fca5a5'}; font-size: 13px; line-height: 1.6; margin-bottom: 6px;">
          ${f.remediationStatus === 'chronic' ? '&#128257; ' : ''}<strong>${f.title}:</strong> ${f.action}
        </li>
      `).join('')}
      ${[...chronic, ...unresolved].filter((f: any) => !f.action).map((f: any) => `
        <li style="color: ${f.remediationStatus === 'chronic' ? '#c4b5fd' : '#fca5a5'}; font-size: 13px; line-height: 1.6; margin-bottom: 6px;">
          ${f.remediationStatus === 'chronic' ? '&#128257; ' : ''}<strong>${f.title}</strong> — investigate and resolve
        </li>
      `).join('')}
    </ol>
  </div>
` : `
  <div style="background: #052e16; border: 1px solid #4ade80; padding: 14px 18px; margin-bottom: 20px; border-radius: 6px;">
    <p style="margin: 0; color: #4ade80; font-size: 13px;">&#10003; No actions required — platform operating normally</p>
  </div>
`}
      ${remediationSummary}

      ${/* Auto-resolved findings omitted from email — they fixed themselves, no action needed */ ''}

      ${chronic.length > 0 ? `
        <h2 style="color: #a78bfa; font-size: 13px; margin: 20px 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">ð Chronic Issues (Needs Strategic Fix)</h2>
        ${chronic.map(f => renderFinding(f, '#c4b5fd', '#7c3aed', '#1a0533')).join('')}
      ` : ''}

      ${unresolved.length > 0 ? `
        <h2 style="color: #ef4444; font-size: 13px; margin: 20px 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">ð´ Requires Attention</h2>
        ${unresolved.map(f => renderFinding(f, f.severity === 'critical' ? '#fca5a5' : '#fcd34d', f.severity === 'critical' ? '#ef4444' : '#f59e0b', f.severity === 'critical' ? '#1a0505' : '#1a1005')).join('')}
      ` : ''}

      ${/* Observations omitted from email — informational only, no action needed */ ''}

      ${analysis.trendNote ? `
        <div style="background: #0f172a; border: 1px solid #1e3a5f; padding: 14px 18px; margin-top: 20px; border-radius: 4px;">
          <strong style="color: #93c5fd; font-size: 12px; text-transform: uppercase;">ð Trend Analysis</strong>
          <p style="margin: 6px 0 0; color: #cbd5e1; font-size: 13px;">${analysis.trendNote}</p>
        </div>
      ` : ''}

      ${/* Self-improvement notes omitted from operator email — internal system context only */ ''}

      ${analysis.suppressedChecks?.length > 0 ? `
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #222;">
          <p style="color: #666; font-size: 12px; margin: 0;"><strong>Suppressed (normal):</strong> ${analysis.suppressedChecks.join(' â¢ ')}</p>
        </div>
      ` : ''}
    </div>

    ${(() => {
      const knownBrokenCount = analysis.findings.filter(f => f.severity === 'critical' && f.remediationStatus !== 'fixed').length;
      const nextReportDate = new Date(Date.now() + 20 * 3600000);
      const nextReportUTC = nextReportDate.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
      // Email stat block was previously labeled "Signals (24h)" but used the
      // 6-hour count (recentSignalCount). Switched to last24hSignalCount so
      // the number actually matches the label. Operator was getting confused
      // by "5 signals" when reality was 29.
      const signalCount = telemetry.signalPipeline.last24hSignalCount;
      const bugCount = telemetry.bugReports.totalOpen;
      const dbMs = telemetry.database.responseTimeMs;
      const qaPassRate = (telemetry as any).qaPassRate || 'No tests run yet';
      return `
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 20px; padding: 16px; background: #0a0a0a; border-radius: 4px;">
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: bold; color: ${signalCount > 0 ? '#4ade80' : '#ef4444'}">${signalCount}</div>
          <div style="font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px;">Signals (24h)</div>
        </div>
        <div style="text-align: center;">
          <div style="font-size: 24px; font-weight: bold; color: ${unresolved.length === 0 ? '#4ade80' : unresolved.some((f: any) => f.severity === 'critical') ? '#ef4444' : '#f59e0b'}">${unresolved.length}</div>
          <div style="font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 1px;">Need Attention</div>
        </div>
      </div>
    `;
    })()} 

    <div style="padding: 12px 28px; background: #080808; border-top: 1px solid #1a1a1a;">
      ${(() => {
        const knownBrokenCount2 = analysis.findings.filter(f => f.severity === 'critical' && f.remediationStatus !== 'fixed').length;
        const nextReportDate2 = new Date(Date.now() + 20 * 3600000);
        const nextReportUTC2 = nextReportDate2.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
        const qaPassRate2 = (telemetry as any).qaPassRate || 'No tests run yet';
        return `
        <p style="margin: 0; font-size: 11px; color: #444; line-height: 2;">
          Known broken: <strong style="color: #ef4444">${knownBrokenCount2}</strong> &nbsp;&middot;&nbsp;
          Chronic issues: <strong style="color: #a78bfa">${chronic.length}</strong> &nbsp;&middot;&nbsp;
          QA tests: <strong style="color: #60a5fa">${qaPassRate2}</strong> &nbsp;&middot;&nbsp;
          Next report: <strong style="color: #555">${nextReportUTC2}</strong>
        </p>
        `;
      })()}
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
//                        MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@silentshieldsecurity.com>';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    const runId = crypto.randomUUID();

    // Parse optional request body for force flag
    let forceEmail = false;
    try {
      const body = await req.json().catch(() => ({}));
      forceEmail = body?.force === true;
    } catch { /* no body */ }

    // Phase 0: Load learning history
    console.log('[Watchdog] 🧠 Phase 0: Loading learning history...');
    let learningHistory: LearningHistory;
    try {
      learningHistory = await loadLearningHistory(supabase);
      console.log(`[Watchdog] Loaded ${learningHistory.recentFindings.length} past findings, ${learningHistory.recurringIssues.length} recurring issues, ${learningHistory.effectivenessStats.length} effectiveness records`);
    } catch (e) {
      console.warn('[Watchdog] Failed to load learning history (first run?):', e);
      learningHistory = { recentFindings: [], recurringIssues: [], effectivenessStats: [], platformGrowth: { signalsTrend: 'unknown', entitiesTrend: 'unknown', usersTrend: 'unknown' }, pastSelfNotes: [] };
    }

    // Phase 1: Collect telemetry
    console.log('[Watchdog] 📡 Phase 1: Collecting telemetry...');
    const telemetry = await collectTelemetry(supabase, supabaseUrl, anonKey);
    console.log(`[Watchdog] Telemetry: signals6h=${telemetry.signalPipeline.recentSignalCount}, stale=${telemetry.signalPipeline.staleSources.length}, bugs=${telemetry.bugReports.totalOpen}, docs_stuck=${telemetry.documentPipeline.stuckCount}, docs_failed1h=${telemetry.documentPipeline.failedLast1h}, doc_pipeline_healthy=${telemetry.documentPipeline.pipelineHealthy}`);

    // Phase 1.5: Collect QA and user bug telemetry and wire into findings
    const findings: any[] = [];

    // QA TEST RESULTS
    const { data: latestQA } = await supabase
      .from('qa_test_results')
      .select('test_name, test_suite, passed, severity, is_known_broken, known_broken_reason, error_message, tested_at')
      .gte('tested_at', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())
      .order('tested_at', { ascending: false });

    const { data: previousQA } = await supabase
      .from('qa_test_results')
      .select('test_name, passed')
      .gte('tested_at', new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString())
      .lt('tested_at', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());

    const previousMap = new Map((previousQA || []).map((t: any) => [t.test_name, t.passed]));
    const regressions = (latestQA || []).filter((t: any) => !t.passed && !t.is_known_broken && previousMap.get(t.test_name) === true);
    const newFixes = (latestQA || []).filter((t: any) => t.passed && t.is_known_broken && previousMap.get(t.test_name) === false);
    const totalTests = latestQA?.length || 0;
    const passingTests = (latestQA || []).filter((t: any) => t.passed).length;
    const qaPassRate = totalTests > 0 ? `${passingTests}/${totalTests}` : 'No tests run yet';

    // Attach qaPassRate to telemetry for email
    (telemetry as any).qaPassRate = qaPassRate;

    if (regressions.length > 0) {
      findings.push({
        severity: 'critical',
        category: 'QA Tests',
        title: `${regressions.length} regression(s) detected since yesterday`,
        analysis: `Tests that were passing yesterday are now failing: ${regressions.map((r: any) => r.test_name).join(', ')}`,
        recommendation: 'Check recent deployments for breaking changes.',
        plainEnglish: `Features that were working yesterday are now broken: ${regressions.map((r: any) => r.test_name.replace(/_/g, ' ')).join(', ')}`,
        action: 'Check recent Claude Code deployments. One of them broke something. Fix before client demo on April 8.',
        canAutoRemediate: false,
        remediationAction: 'none',
      });
    }

    if (newFixes.length > 0) {
      findings.push({
        severity: 'info',
        category: 'QA Tests',
        title: `${newFixes.length} previously broken feature(s) now passing`,
        analysis: `Features that were failing are now working: ${newFixes.map((f: any) => f.test_name).join(', ')}`,
        recommendation: 'No action needed.',
        plainEnglish: `Good news — these features are now working: ${newFixes.map((f: any) => f.test_name.replace(/_/g, ' ')).join(', ')}`,
        action: 'No action needed.',
        canAutoRemediate: false,
        remediationAction: 'none',
      });
    }

    // USER-REPORTED BUGS
    const { data: userBugs } = await supabase
      .from('bug_reports')
      .select('id, title, severity, ai_diagnosis, status, affects_client_facing, page_url, created_at')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .neq('status', 'auto_resolved')
      .order('created_at', { ascending: false });

    const clientFacingBugs = (userBugs || []).filter((b: any) => b.affects_client_facing);
    const otherBugs = (userBugs || []).filter((b: any) => !b.affects_client_facing);

    const { data: autoResolvedBugs } = await supabase
      .from('bug_reports')
      .select('title, ai_diagnosis')
      .eq('status', 'auto_resolved')
      .gte('resolved_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (clientFacingBugs.length > 0) {
      findings.push({
        severity: 'critical',
        category: 'Bug Reports',
        title: `${clientFacingBugs.length} client-facing bug(s) reported by users`,
        analysis: `Users found problems affecting what clients see: ${clientFacingBugs.map((b: any) => b.title).join('; ')}`,
        recommendation: 'Open Fortress bug tracker. Assign to Claude Code immediately.',
        plainEnglish: `Users found problems affecting what clients see: ${clientFacingBugs.map((b: any) => b.title).join('; ')}`,
        action: 'Open Fortress bug tracker. Assign to Claude Code immediately.',
        canAutoRemediate: false,
        remediationAction: 'none',
      });
    }

    if (otherBugs.length > 0) {
      findings.push({
        severity: 'warning',
        category: 'Bug Reports',
        title: `${otherBugs.length} bug(s) reported by users`,
        analysis: `Users found ${otherBugs.length} issue(s) in the last 24 hours.`,
        recommendation: 'Review in Fortress bug tracker. Prioritize any marked high or critical.',
        plainEnglish: `Users found ${otherBugs.length} issue(s) in the last 24 hours.`,
        action: 'Review in Fortress bug tracker. Prioritize any marked high or critical.',
        canAutoRemediate: false,
        remediationAction: 'none',
      });
    }

    if (autoResolvedBugs && autoResolvedBugs.length > 0) {
      findings.push({
        severity: 'info',
        category: 'Bug Reports',
        title: `${autoResolvedBugs.length} user-reported bug(s) auto-resolved`,
        analysis: `These user-reported issues were automatically fixed: ${autoResolvedBugs.map((b: any) => b.title).join(', ')}`,
        recommendation: 'No action needed. Platform self-healed.',
        plainEnglish: `These user-reported issues were automatically fixed: ${autoResolvedBugs.map((b: any) => b.title).join(', ')}`,
        action: 'No action needed. Platform self-healed.',
        canAutoRemediate: false,
        remediationAction: 'none',
      });
    }

    // AGENT LEARNING HEALTH
    const { data: latestBelief } = await supabase
      .from('agent_beliefs')
      .select('last_updated_at, agent_call_sign')
      .order('last_updated_at', { ascending: false })
      .limit(1);

    const beliefAge = latestBelief?.[0]?.last_updated_at
      ? (Date.now() - new Date(latestBelief[0].last_updated_at).getTime()) / 3600000
      : 999;

    if (beliefAge > 48) {
      findings.push({
        severity: 'critical',
        category: 'Agent Learning',
        title: 'Agent learning pipeline has stalled',
        analysis: `Agent beliefs have not been updated in ${Math.round(beliefAge)} hours. Agents are operating on stale knowledge.`,
        recommendation: 'Check thread-weaver, self-improvement, and knowledge-seeker cron jobs. Review for model errors.',
        plainEnglish: `Agent beliefs have not been updated in ${Math.round(beliefAge)} hours. Agents may be working from stale knowledge.`,
        action: 'Check that thread-weaver, self-improvement, and knowledge-seeker cron jobs ran last night.',
        canAutoRemediate: false,
        remediationAction: 'none',
      });
    }

    // RSS MONITOR HEALTH
    const { data: rssHeartbeat } = await supabase
      .from('cron_heartbeat')
      .select('started_at, status')
      .eq('job_name', 'monitor-rss-sources')
      .order('started_at', { ascending: false })
      .limit(1);

    const rssAge = rssHeartbeat?.[0]?.started_at
      ? (Date.now() - new Date(rssHeartbeat[0].started_at).getTime()) / 60000
      : 999;

    if (rssAge > 20) {
      findings.push({
        severity: 'critical',
        category: 'Signal Pipeline',
        title: `RSS monitor last ran ${Math.round(rssAge)} minutes ago`,
        analysis: `The RSS monitor should run every 15 minutes — it has been ${Math.round(rssAge)} minutes since last run.`,
        recommendation: 'Check monitor-rss-sources function logs in Supabase.',
        plainEnglish: `Signal ingestion may have stalled. The RSS monitor should run every 15 minutes — it has been ${Math.round(rssAge)} minutes.`,
        action: 'Check monitor-rss-sources function logs in Supabase. A recent deployment may have introduced a crash.',
        canAutoRemediate: true,
        remediationAction: 'stale_sources_rescan',
      });
    }


    // ═══ BEHAVIORAL HEALTH ASSERTIONS ═══
    // Checks that the platform is doing the RIGHT thing, not just running.
    // These catch silent feature regressions before they become QA sessions.
    const behavioralFindings: any[] = [];

    try {
      // 1. Agent enrichment coverage — high-severity signals should get agent analysis
      const { data: recentHighSeverity } = await supabase
        .from('signals')
        .select('id, raw_json')
        .gte('severity_score', 50)
        .gte('created_at', new Date(Date.now() - 48 * 3600000).toISOString())
        .eq('is_test', false)
        .limit(100);

      if (recentHighSeverity && recentHighSeverity.length > 0) {
        const withAgentReview = recentHighSeverity.filter(s => s.raw_json?.agent_review);
        const coveragePct = Math.round((withAgentReview.length / recentHighSeverity.length) * 100);
        if (coveragePct < 50) {
          behavioralFindings.push({
            category: 'behavioral_health',
            severity: 'high',
            title: `Agent enrichment gap: only ${coveragePct}% of high-severity signals analyzed`,
            analysis: `${withAgentReview.length} of ${recentHighSeverity.length} signals from last 48h have agent_review. Expected ≥50%.`,
            plainEnglish: `High-priority signals are entering the feed without AI context added. Analysts see threats without explanation of why they matter.`,
            action: `Check ai-decision-engine logs — review-signal-agent may not be firing for high-confidence signals.`,
          });
        }
      }

      // 2. Social monitor effectiveness — each social source should produce results
      const { data: socialHeartbeats } = await supabase
        .from('cron_heartbeat')
        .select('job_name, result_summary, completed_at')
        .in('job_name', ['monitor-twitter', 'monitor-social-unified', 'monitor-social-hourly', 'monitor-social'])
        .gte('completed_at', new Date(Date.now() - 24 * 3600000).toISOString())
        .order('completed_at', { ascending: false })
        .limit(20);

      const socialByJob = new Map<string, any[]>();
      for (const hb of socialHeartbeats || []) {
        if (!socialByJob.has(hb.job_name)) socialByJob.set(hb.job_name, []);
        socialByJob.get(hb.job_name)!.push(hb);
      }

      for (const [jobName, runs] of socialByJob) {
        const lastRun = runs[0];
        const signalsFromRuns = runs.map(r => r.result_summary?.signals_created ?? 0);
        const totalSignals = signalsFromRuns.reduce((a: number, b: number) => a + b, 0);
        if (totalSignals === 0 && runs.length >= 3) {
          behavioralFindings.push({
            category: 'behavioral_health',
            severity: 'medium',
            title: `${jobName}: 0 signals across ${runs.length} recent runs`,
            analysis: `This social monitor has run ${runs.length} times in the last 24h but created 0 signals.`,
            plainEnglish: `Social media monitoring for ${jobName} is running but finding nothing. Either there is no relevant activity, or the search queries/API access is broken.`,
            action: `Check ${jobName} logs for API errors or empty CSE responses. Verify search queries match current client keywords.`,
          });
        }
      }

      // 3. Entity content freshness — entities with active monitoring should have recent content
      const { data: staleEntities } = await supabase
        .from('entities')
        .select('id, name')
        .eq('active_monitoring_enabled', true)
        .lt('last_deep_scan', new Date(Date.now() - 30 * 24 * 3600000).toISOString())
        .limit(10);

      if (staleEntities && staleEntities.length > 0) {
        behavioralFindings.push({
          category: 'behavioral_health',
          severity: 'medium',
          title: `${staleEntities.length} monitored entities not deep-scanned in 30+ days`,
          analysis: `Entities: ${staleEntities.slice(0, 5).map((e: any) => e.name).join(', ')}${staleEntities.length > 5 ? '...' : ''}`,
          plainEnglish: `Investigation reports for these entities will be based on stale OSINT. Run a deep scan to refresh.`,
          action: `Trigger deep scan for stale entities from the Entity Detail page.`,
        });
      }

      // 4. Feedback loop health — learning profiles should be updating
      const { data: recentFeedback } = await supabase
        .from('feedback_events')
        .select('id')
        .eq('object_type', 'signal')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 3600000).toISOString())
        .limit(1);

      const { data: recentLearningUpdate } = await supabase
        .from('learning_profiles')
        .select('last_updated')
        .order('last_updated', { ascending: false })
        .limit(1);

      const learningAge = recentLearningUpdate?.[0]?.last_updated
        ? Date.now() - new Date(recentLearningUpdate[0].last_updated).getTime()
        : Infinity;

      if ((recentFeedback?.length ?? 0) > 0 && learningAge > 48 * 3600000) {
        behavioralFindings.push({
          category: 'behavioral_health',
          severity: 'medium',
          title: 'Signal feedback not updating learning profiles',
          analysis: `Feedback events exist in the last 7 days but learning_profiles last updated ${Math.round(learningAge / 3600000)}h ago.`,
          plainEnglish: `Analysts are rating signals but those ratings are not improving the relevance filter. The learning loop is broken.`,
          action: `Check process-feedback function logs. Verify it is writing to learning_profiles table.`,
        });
      }

      // 5. Self-improvement proposal backlog — systemic proposals never auto-apply
      // (apply path requires target_agent IS NOT NULL; AI generates target_agent=null
      // for network-wide ideas). Surface the backlog so it does not pile up invisibly.
      const { data: pendingProposals } = await supabase
        .from('self_improvement_log')
        .select('title, target_agent, created_at')
        .eq('applied', false)
        .neq('improvement_type', 'orchestration_cycle')
        .order('created_at', { ascending: false });

      if ((pendingProposals?.length ?? 0) >= 5) {
        const titles = (pendingProposals || []).slice(0, 5).map((p: any) => `"${p.title}"`).join(', ');
        const oldestDays = pendingProposals?.length
          ? Math.round((Date.now() - new Date(pendingProposals[pendingProposals.length - 1].created_at).getTime()) / (24 * 3600000))
          : 0;
        behavioralFindings.push({
          category: 'behavioral_health',
          severity: 'medium',
          title: `${pendingProposals?.length} self-improvement proposals awaiting review`,
          analysis: `${pendingProposals?.length} proposals in self_improvement_log have applied=false. Oldest is ${oldestDays}d old. Examples: ${titles}.`,
          plainEnglish: `The self-improvement orchestrator is generating ideas but most are network-wide (target_agent=null) and the auto-apply path only handles per-agent prompt edits. These proposals need either human review or a broader apply mechanism.`,
          action: `Review pending proposals in self_improvement_log and either apply them manually, mark as applied=true if obsolete, or extend the orchestrator to handle systemic changes.`,
        });
      }

      console.log(`[Watchdog] Behavioral health: ${behavioralFindings.length} findings`);
    } catch (behavioralErr) {
      console.warn('[Watchdog] Behavioral health check failed:', behavioralErr);
    }

    // Phase 2: AI Analysis WITH learning context
    console.log('[Watchdog] 🧠 Phase 2: AI analysis with learning context...');
    const analysisInput = {
      telemetry,
      extraFindings: [...findings, ...behavioralFindings],
      learningHistory: {
        recentFindings: learningHistory.recentFindings.slice(0, 20),
        recurringIssues: learningHistory.recurringIssues,
        effectivenessStats: learningHistory.effectivenessStats,
        platformGrowth: learningHistory.platformGrowth,
        pastSelfNotes: learningHistory.pastSelfNotes.slice(0, 5),
      },
    };

    let analysis: AIAnalysis;
    try {
      analysis = await callAI(
        FORTRESS_SYSTEM_KNOWLEDGE,
        `Analyze this telemetry AND your learning history to make informed decisions. Skip remediations with poor track records. Identify recurring patterns. USE the adaptiveThresholds to calibrate your severity judgments — these auto-adjust with platform growth. Also incorporate these pre-computed findings:\n\n${JSON.stringify(analysisInput, null, 2)}`
      );
      // Merge extra findings with AI findings
      analysis.findings = [...findings, ...(analysis.findings || [])];
    } catch (e) {
      const aiErrMsg = e instanceof Error ? e.message : String(e);
      console.error('[Watchdog] AI analysis failed:', aiErrMsg);
      analysis = {
        shouldAlert: true, overallAssessment: `AI analysis engine failed: ${aiErrMsg.substring(0, 300)}`,
        severity: 'monitoring', findings, suppressedChecks: [], selfImprovementNotes: ['AI analysis failed -- investigate gateway health'],
      };
    }
    console.log(`[Watchdog] AI verdict: severity=${analysis.severity}, findings=${analysis.findings.length}, remediable=${analysis.findings.filter(f => f.canAutoRemediate).length}`);

    // Phase 3: Auto-Remediate (with learning-informed decisions)
    const remediableFindings = analysis.findings.filter(f => f.canAutoRemediate && f.remediationAction && f.remediationAction !== 'none');
    const remediationResults: RemediationResult[] = [];

    if (remediableFindings.length > 0) {
      console.log(`[Watchdog] 🔧 Phase 3: Attempting ${remediableFindings.length} remediation(s)...`);
      for (const finding of remediableFindings) {
        const result = await executeRemediation(finding, supabase, supabaseUrl, anonKey, learningHistory);
        remediationResults.push(result);
        console.log(`[Watchdog] ${result.success ? '✓' : '✗'} ${result.action}: ${result.details}`);
      }

      // Phase 4: Re-verify with AI (include effectiveness context)
      console.log('[Watchdog] 🧠 Phase 4: AI re-verification with effectiveness history...');
      try {
        const verificationInput = {
          originalAnalysis: analysis,
          remediationResults: remediationResults.map(r => ({
            action: r.action,
            findingTitle: r.finding.title,
            success: r.success,
            details: r.details,
          })),
          effectivenessHistory: learningHistory.effectivenessStats,
          recurringIssues: learningHistory.recurringIssues,
        };
        const verified = await callAI(VERIFICATION_PROMPT, JSON.stringify(verificationInput, null, 2));
        analysis.overallAssessment = verified.overallAssessment || analysis.overallAssessment;
        analysis.severity = verified.severity || analysis.severity;
        analysis.findings = verified.findings || analysis.findings;
        analysis.shouldAlert = verified.shouldStillAlert ?? analysis.shouldAlert;
        analysis.suppressedChecks = verified.suppressedChecks || analysis.suppressedChecks;
        analysis.trendNote = verified.trendNote || analysis.trendNote;
        if (verified.selfImprovementNotes) {
          analysis.selfImprovementNotes = [...(analysis.selfImprovementNotes || []), ...verified.selfImprovementNotes];
        }
      } catch (e) {
        console.warn('[Watchdog] Re-verification failed, using original analysis:', e);
        for (const result of remediationResults) {
          const finding = analysis.findings.find(f => f.title === result.finding.title);
          if (finding) {
            finding.remediationStatus = result.success ? 'fixed' : 'failed';
            if (result.success) finding.severity = 'resolved';
          }
        }
      }
    } else {
      console.log('[Watchdog] No auto-remediable issues found — skipping remediation phase');
    }

    // Phase 5: Store learnings for future runs
    console.log('[Watchdog] 🧠 Phase 5: Storing learnings...');
    try {
      await storeLearnings(supabase, runId, analysis, remediationResults, learningHistory, telemetry);
    } catch (e) {
      console.warn('[Watchdog] Failed to store learnings:', e);
    }

    // Phase 6: Log metrics
    try {
      const healthScore = analysis.severity === 'healthy' ? 1.0 : analysis.severity === 'monitoring' ? 0.8 : analysis.severity === 'degraded' ? 0.5 : 0.2;
      await supabase.from('automation_metrics').insert({
        metric_date: new Date().toISOString().split('T')[0],
        accuracy_rate: healthScore,
        false_positive_rate: analysis.findings.filter(f => f.severity === 'critical').length / 10,
      });
    } catch { /* metrics logging is best-effort */ }

    // Log remediation actions
    for (const r of remediationResults) {
      try {
        await supabase.from('autonomous_actions_log').insert({
          action_type: 'watchdog_remediation',
          trigger_source: 'system-watchdog',
          action_details: { action: r.action, finding: r.finding.title, category: r.finding.category },
          status: r.success ? 'completed' : 'failed',
          error_message: r.success ? null : r.details,
          result: { details: r.details },
        });
      } catch { /* logging is best-effort */ }
    }

    // Phase 7: Email — only send if critical, or if it's the scheduled daily run (dedup via 20h window)
    const isCritical = analysis.severity === 'critical';
    const dedupCutoff = new Date(Date.now() - 20 * 3600000).toISOString();
    const { data: recentWatchdogEmails } = await supabase
      .from('autonomous_actions_log')
      .select('id')
      .eq('action_type', 'watchdog_report')
      .gte('created_at', dedupCutoff)
      .limit(1);

    const alreadyEmailedRecently = recentWatchdogEmails && recentWatchdogEmails.length > 0;
    const shouldEmail = forceEmail || isCritical || ((analysis.shouldAlert || remediationResults.length > 0) && !alreadyEmailedRecently);

    if (shouldEmail) {
      const resend = new Resend(RESEND_API_KEY);
      const fixedCount = remediationResults.filter(r => r.success).length;
      const unresolvedCount = analysis.findings.filter(f => f.severity === 'critical' || f.severity === 'warning').length;
      const chronicCount = analysis.findings.filter(f => f.remediationStatus === 'chronic').length;

      let subject: string;
      if (fixedCount > 0 && unresolvedCount === 0 && chronicCount === 0) {
        subject = `✓ Fortress Watchdog: ${fixedCount} issue${fixedCount !== 1 ? 's' : ''} auto-resolved — all systems nominal`;
      } else if (chronicCount > 0) {
        subject = `🔁 Fortress: ${chronicCount} chronic issue${chronicCount !== 1 ? 's' : ''} ${fixedCount > 0 ? `+ ${fixedCount} fixed` : '— needs strategic intervention'}`;
      } else if (fixedCount > 0 && unresolvedCount > 0) {
        subject = `⚠️ Fortress: ${fixedCount} fixed, ${unresolvedCount} still need attention`;
      } else if (analysis.severity === 'critical') {
        subject = `🔴 Fortress Alert: ${analysis.overallAssessment}`;
      } else {
        subject = `⚠️ Fortress Watchdog: ${analysis.overallAssessment}`;
      }

      const { error: emailError } = await resend.emails.send({
        from: fromEmail,
        to: [ALERT_EMAIL],
        subject: subject.substring(0, 150),
        html: buildAlertEmail(analysis, telemetry, remediationResults, learningHistory),
      });

      if (emailError) console.error('[Watchdog] Email failed:', emailError);
      else {
        console.log(`[Watchdog] 📧 Report sent to ${ALERT_EMAIL}`);
        // Log for dedup tracking
        await supabase.from('autonomous_actions_log').insert({
          action_type: 'watchdog_report', trigger_source: 'system-watchdog',
          action_details: { severity: analysis.severity, findings: analysis.findings.length, fixed: fixedCount },
          status: 'completed',
        });
      }

      return successResponse({
        success: true, severity: analysis.severity, runId,
        findings: analysis.findings.length, remediations: remediationResults.length,
        fixed: fixedCount, chronic: chronicCount, emailSent: !emailError,
        learningsStored: true,
      });
    }

    console.log('[Watchdog] ✓ All systems nominal — no email needed');
    return successResponse({ success: true, severity: analysis.severity, runId, findings: 0, emailSent: false, learningsStored: true, assessment: analysis.overallAssessment });

  } catch (error) {
    console.error('[Watchdog] Fatal error:', error);
    try {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@silentshieldsecurity.com>';
      if (RESEND_API_KEY) {
        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: fromEmail, to: [ALERT_EMAIL],
          subject: '🔴 Fortress Watchdog Agent CRASHED',
          html: `<div style="font-family:sans-serif;background:#111;color:#e0e0e0;padding:24px"><h2 style="color:#ef4444">Watchdog Agent Failure</h2><p>The self-healing watchdog failed to complete its audit.</p><pre style="background:#1a1a1a;padding:16px;border-radius:4px;color:#fca5a5">${error instanceof Error ? error.stack || error.message : String(error)}</pre></div>`,
        });
      }
    } catch { /* last resort */ }
    return errorResponse(`Watchdog failed: ${error instanceof Error ? error.message : 'Unknown'}`, 500);
  }
});
