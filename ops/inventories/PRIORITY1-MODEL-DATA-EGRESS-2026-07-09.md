# Priority 1 — Model-Data-Egress Inventory (2026-07-09)

Read-only inventory (no code changes) of every edge function that sends data to an EXTERNAL model API. Input for the future **model-routing work order**. Method: 7 parallel Explore subagents over 143 grep-identified functions, then a targeted `model:`/call-site grep to close partial reads. Code references are `file:line` in `supabase/functions/<fn>/index.ts` unless noted.

**How model calls appear:** most route through `_shared/ai-gateway.ts` (`callAiGateway`/`callAiGatewayJson`) where the `model` string picks the provider — `gpt-*`/`openai/*`→OpenAI, `gemini-*`/`google/*`→Gemini, `sonar*`→Perplexity (fallback gpt-4o-mini). **`MODEL_NORMALIZATION` silently rewrites most `gemini-3*`, `gemini-2.5-pro`, `gemini-2.0-flash` → `gpt-4o-mini` (OpenAI)**; `gemini-2.5-flash` stays Gemini. A minority call provider hosts directly.

## Task classes
- **bulk-classification** — high-volume scoring/extraction (signals gate, embeddings, image tagging).
- **synthesis** — reports/narratives/analysis reaching principals/operators.
- **conversational** — AEGIS / user-facing chat + voice.
- **adversarial-judgment** — WRAITH, injection detection, red-team dissent.

## Inventory

| function | model (effective) | data class | code ref | task class |
|---|---|---|---|---|
| academy-build-training | gpt-4o | user chat; expert knowledge; agent beliefs | 175 | conversational |
| academy-score | gpt-4o-mini | user chat; scenario rationale | 88 | bulk-classification |
| access-industry-standards | gpt-4o-mini | industry query; KB docs | 266 | synthesis |
| aegis-monitor | gemini-3-flash→gpt-4o-mini | user chat; team convo history | 54 | conversational |
| aegis-stt | whisper-1 | audio/voice | 40 | conversational |
| aegis-tts | tts-1-hd | agent/system text output | 104 | conversational |
| agent-activity-scanner | gpt-4o-mini | aggregate stats; signal/incident metrics | 174 | synthesis |
| agent-chat | gpt-4o-mini (+stream) | user chat; signals; incidents; entities; docs; client+operational context | 504-506 | conversational |
| agent-knowledge-seeker | sonar-pro (Perplexity) | domain specialty; research queries | 221 | synthesis |
| agent-mesh-dispatcher | NONE | — | grep FP: internal semantic routing (_shared/semantic-rag) | — |
| agent-router | NONE | — | grep FP: internal semantic routing / keyword fallback | — |
| agent-self-learning | gpt-4o-mini; sonar-pro | domain specialty; research queries; learning context | 106-123 | synthesis |
| aggregate-global-learnings | gpt-4o-mini | aggregate cross-tenant anonymized signal/incident patterns | 183 | synthesis |
| ai-decision-engine | openai/gpt-5.2 | signals; client data; recent signals; incident history; source credibility | 335 | bulk-classification |
| analyze-audit-photo | gpt-4o-mini | image; audit feature/EXIF context | 125 | bulk-classification |
| analyze-image-content | gpt-4o-mini | image; client context | 34 | bulk-classification |
| analyze-stage-coverage | gpt-4o-mini | aggregate stats; photo/feature metadata | 142 | synthesis |
| analyze-threat-escalation | gpt-4o-mini | signals; incidents; threat patterns | 65 | synthesis |
| assess-entity | gpt-4o-mini | entity data; relationships; POI reports; threat context | 139 | bulk-classification |
| audit-compliance-status | gpt-4o-mini (gw) | client; incidents; signals; escalation rules; entities | 169 | synthesis |
| auto-enrich-entities | gpt-4o-mini (gw) | entity data; mentions; docs; threat indicators | 112 | bulk-classification |
| auto-summarize-incident | gpt-4o-mini (gw) | incident; linked signals+entities; priority/severity | 106 | synthesis |
| autonomous-operations-loop | gpt-4o-mini | incident content; metrics/threat assessment | 184-198 | synthesis |
| autonomous-source-discovery | gpt-4o-mini | client keywords; industry; OSINT source candidates | 157-162 | synthesis |
| autonomous-threat-scan | gpt-4o-mini | signals(48h); incidents; entity clusters | 116-127 | synthesis |
| briefing-chat-response | gpt-4o-mini | user chat; verified P1/P2 incidents; entities; notes; evidence | 71-91,484 | conversational |
| briefing-query | gpt-4o-mini | mission context; signals; entities; agent reports; user Q | 241-302,493 | synthesis |
| correlate-signals | gpt-4o-mini | signal text; category; severity; location | 96-136 | bulk-classification |
| cross-reference-entities | gpt-4o-mini | document/file names + column context | 7-45 | bulk-classification |
| cyber-sentinel | gpt-4o-mini | threat events; confidence/severity; source details | 580-594 | synthesis |
| dashboard-ai-assistant | gpt-4o-mini (+stream) | user query; tenant scope; signal feed; incident context; tool outputs; entity graph | 65-81,484 | conversational |
| detect-duplicates | gpt-4o-mini (direct) | signal text (incoming + ≤60 candidates) | 286-314 | bulk-classification |
| digital-twin-simulator | gpt-4o-mini | entity; client; 50 signals; incidents; vulns; adversaries; playbooks | 184-194 | synthesis |
| enrich-entity | gpt-4o-mini | entity name + context | 65-75 | bulk-classification |
| entity-deep-scan | gpt-4o-mini (+Google CSE/HIBP/Perplexity) | entity name; disambig context; search+breach results | 155-174 | synthesis |
| evaluate-countermeasure-impact | gpt-4o-mini | countermeasure plan; threat scenario | 62-71 | synthesis |
| extract-conversation-memory | gpt-4o-mini | conversation text (≤8000 chars) | 87-92 | bulk-classification |
| extract-predicted-events | gpt-4o-mini | signal title+text (≤1500) | 78-85 | bulk-classification |
| extract-signal-insights | gpt-4o-mini | signal text (≤4000); entity/date/location extraction | 110-234 | bulk-classification |
| flight-auto-scan | sonar (Perplexity) | flight number/time; live status search | 70-86 | synthesis |
| flight-lookup | sonar (Perplexity) | flight query; live status search | 42-58 | conversational |
| fortress-document-converter | gemini-2.5-flash; gemini-2.5-flash-image-preview | document image/PDF/DOCX text (vision OCR) | 248-620 | synthesis |
| gemini-voice-conversation | gpt-4o-mini | convo history; audio transcription | 55-66 | conversational |
| generate-academy-course | gpt-4o | agent beliefs; expert knowledge; topic/difficulty | 89-105 | synthesis |
| generate-agent-avatar | gemini-2.5-flash-image-preview→gpt-4o-mini | user input (name/persona/specialty) | 37 | synthesis |
| generate-briefing-audio | tts-1-hd (direct) | briefing text (incident content) | 91 | synthesis |
| generate-consortium-briefing | gpt-4o-mini (gw) | shared incidents; signals | 178 | synthesis |
| generate-daily-briefing | gpt-4o-mini (gw) | incidents; agent beliefs; entity narratives; debate syntheses (client-scoped) | 267 | synthesis |
| generate-embeddings | text-embedding-3-small (direct) | uploaded doc text; signal text (chunked) | 47 | bulk-classification |
| generate-executive-report | gpt-4o-mini ×5 (gw) | signals; incidents; debate syntheses; agent beliefs; client profile(keywords/assets) | 586-995 | synthesis |
| generate-incident-briefing | gpt-4o-mini (direct) | incident; signals; entities; SLA/impact | 293 | synthesis |
| generate-monitoring-proposals | gpt-4o-mini (direct) | agent learnings; recent signals; client keywords | 162 | bulk-classification |
| generate-playbook | gpt-4o-mini (direct) | past incidents/investigations; debate records; feedback; signals | 130 | synthesis |
| generate-poi-report | gpt-4o-mini ×2 (gw) | OSINT/entity content; **PII (names,emails,phones); HIBP breach data**; relationships; signal history | 787,703 | synthesis |
| generate-posture-content | gpt-4o-mini (gw) | posture metrics; doctrine library | 67 | synthesis |
| generate-report | gpt-4o-mini (gw) | signals; incidents; investigations; debate syntheses; client profile | 358 | synthesis |
| generate-security-briefing | gpt-4o-mini (gw) + sonar (direct) | signals; incidents; travel context; **city/country/dates** | 133,58 | synthesis |
| generate-security-bulletin | gpt-4o-mini (gw) | entity profile; incident; signals; analyst notes; location/severity | 68 | synthesis |
| generate-sra-report | gpt-4o-mini (direct) | site features; risk ratings; audit context | 416 | synthesis |
| generate-vehicle-image | gemini-2.5-flash-image-preview→gpt-4o-mini | vehicle description prompt | 18 | synthesis |
| geospatial-event-clustering | gpt-4o-mini ×2 (gw) | signal clusters; locations; entities; temporal windows | 210,338 | synthesis |
| guide-decision-tree | gpt-4o-mini (gw) | incident; related signals; playbooks; escalation rules | 124 | conversational |
| identify-critical-failure-points | gpt-4o-mini (gw) | **client profile (assets/supply chain/headcount)**; incidents; disruption signals | 136 | synthesis |
| identify-precursor-indicators | gpt-4o-mini (gw) | signals by source; entity mentions+scores; client profile | 74 | synthesis |
| incident-agent-orchestrator | dynamic per-agent (gw) | incident detail; signals; clients; agent specialization | (callAiGateway, model per agent) | synthesis |
| incident-watch | sonar (Perplexity) + Google CSE | active P1/P2 incident signals → update search | 160-162 | bulk-classification |
| ingest-expert-media | gpt-4o-mini (gw); sonar-pro | expert media transcripts/articles; client domain/profile | 864-873,583 | synthesis |
| ingest-signal | gpt-4o-mini ×2 | raw signal text; website HTML; user chat; incident context; tenant feedback | 700-736,922-979 | bulk-classification |
| ingest-world-knowledge | gpt-4o (direct) | authoritative frameworks (MITRE/NIST/CISA/ISO); system telemetry | 360-374 | synthesis |
| investigation-ai-assist | gpt-4o-mini (gw) | investigation synopsis/content; templates; archival docs; entities | 188-195 | conversational |
| investigation-autopilot | gpt-4o-mini ×3 (direct) | investigation content; entities; signals; incidents; prior task summaries | 316-816 | synthesis |
| knowledge-synthesizer | gpt-4o-mini ×2 (gw) | expert knowledge; signals/incidents/entities; agent beliefs+citations | 607-793 | synthesis |
| learn-from-investigations | gpt-4o-mini (gw) | completed investigation synopses; patterns; acceptance rates | 92-101 | synthesis |
| map-policy-to-controls | gpt-4o-mini (gw) | policy doc content; client config; escalation rules; sources | 102-111 | synthesis |
| model-geopolitical-risk | gpt-4o-mini (gw) | geopolitical event; **client business units/ops**; geopolitical signals | 85-94 | synthesis |
| monitor-emergency-google | gpt-4o-mini (direct) | Google News title+snippet; exclusion patterns | 62-100 | bulk-classification |
| monitor-regulatory-changes | gpt-4o-mini (gw) | jurisdiction+sector; regulatory monitoring data | 64-73 | synthesis |
| monitor-social | sonar-pro (direct); gpt-4o-mini (gw fallback) | Reddit posts/comments; client keywords+entity names; industry | 569-590,221 | bulk-classification |
| monitor-social-unified | openai/gpt-4o-mini (gw) + Google CSE/Meta | Twitter/IG/FB public posts; entity names; client keywords | 1193 | bulk-classification |
| monitor-travel-risks | gpt-4o-mini (gw); sonar (direct) | **itinerary (dates/flights/destination)**; travel signals; live status | 143-166,184-242 | synthesis |
| multi-agent-debate | openai/gpt-5.2 (agents + JUDGE) | incident context; agent memory + knowledge graph; hypotheses/counter-args | 141-150 | adversarial-judgment |
| multi-model-consensus | gpt-4o-mini ×2 (gw) | signal text; category/severity; context | 150-162 | bulk-classification |
| openai-realtime-token | gpt-4o (realtime, direct) | AEGIS persona + tool defs + convo/session context (mints ephemeral token; model runs client-side) | 349-383 | conversational |
| optimize-defense-strategies | gpt-4o-mini (gw) | client profile; signals; incidents; entities; threat type | 101-110 | synthesis |
| osint-entity-scan | gpt-4o-mini (gw) + Google CSE | entity names/attributes; web results; social handles | 184 | bulk-classification |
| osint-web-search | gpt-4o-mini (gw) | entity name/keywords; fetched article text; entity attributes | 170 | bulk-classification |
| parse-entities-document | gpt-4o-mini (gw) | **uploaded document text (potential PII)** | 48-119 | bulk-classification |
| parse-itinerary | gpt-4o-mini (gw, vision) | **travel itinerary image (booking refs/flights/dates)** | 68-100 | bulk-classification |
| parse-travel-itinerary | gpt-4o-mini | **uploaded PDF travel itinerary** | 63 | synthesis |
| parse-travel-security-report | gpt-4o-mini (gw) | uploaded security report image | 77 | synthesis |
| prediction-tracker | text-embedding-3-small | signal text (title/desc/severity/location) | 88,138,179 | synthesis |
| predictive-alert-tuning | gpt-4o-mini (direct) | signal titles+normalized_text (noise patterns) | 115 | bulk-classification |
| predictive-forecast | gpt-4o-mini (gw) | signal/incident records (category/severity/location/entity_tags) | 216 | synthesis |
| predictive-incident-scorer | NONE | — | grep FP: GEMINI_API_KEY referenced, no call (deterministic scoring) | — |
| proactive-intelligence-push | gpt-4o-mini (gw) | internal metrics (surges/unattended incidents/risk scores) | 211 | conversational |
| process-bug-report | gpt-4o-mini (direct) | user bug report (title/desc/severity/url) | 57 | conversational |
| process-client-onboarding | gpt-4o-mini (gw) | **client profile (name/org/industry/locations/assets/headcount)** | 105 | synthesis |
| process-geospatial-map | gpt-4o-mini (gw) | **uploaded geospatial asset map image** | 56 | synthesis |
| process-intelligence-document | gpt-4o-mini (gw) + text-embedding-3-small | ingested document text (≤80k) | 498 | synthesis |
| process-security-report | gpt-4o-mini (gw) + gpt-4o (OCR) | archival doc text (≤100k) or PDF/Word for OCR | 484,354 | synthesis |
| process-stored-document | gpt-4o-mini (direct, vision OCR) | archival document (file extraction) | 351-358 | synthesis |
| propagate-knowledge-edges | NONE | — | grep FP: internal embedding routing (routeToAgents), not model inference | — |
| propose-security-investments | gpt-4o-mini (gw) | **client profile**; incident/signal trends; assets | 123 | synthesis |
| query-expert-knowledge | gpt-4o-mini (gw) + sonar-pro (direct) | expert_knowledge text; live web search context | 105-117,167 | synthesis |
| query-legal-database | gpt-4o-mini (gw) | legal query (jurisdiction/topic); archival docs | 100 | conversational |
| recommend-compliance-remediation | gpt-4o-mini (gw) | client profile; compliance gap; risk score | 102 | synthesis |
| recommend-policy-adjustments | gpt-4o-mini (gw) | client profile; incident outcomes; high-sev signals | 69 | synthesis |
| recommend-tactical-countermeasures | gpt-4o-mini (gw) | signal details; client context; incident history | 96 | synthesis |
| red-team-analyst | openai/gpt-5.2 (gw) | high-confidence agent conclusion + evidence (signal/incident/client ids) | 83 | adversarial-judgment |
| red-team-review | openai/gpt-5.2 (gw) | signal + primary AI-decision analysis (reasoning_log) | 92 | adversarial-judgment |
| resolve-agent-predictions | openai/gpt-5.2 | agent prediction text + evidence signals/incidents | 171-172 | synthesis |
| respond-as-agent | openai/gpt-4o (vision + tool loop) | user chat; image URLs; agent persona; transcript; entity/client context | 246-369 | conversational |
| retrieve-regulatory-document | gpt-4o-mini | jurisdiction/doc name; regulatory refs; KB docs | 252-262 | synthesis |
| review-client-policy | gpt-4o-mini | **client profile+onboarding**; policy docs; monitoring config; assets; threat profile | 183-193 | synthesis |
| review-signal-agent | gpt-4o-mini | signal text; entity tags; scores; related signals; incidents; investigation summary | 242-250 | adversarial-judgment |
| run-task-force | gpt-4o-mini ×3 | mission objective; RoE; agent personas; all agent outputs | 578-675 | synthesis |
| run-what-if-scenario | gpt-4o-mini (direct) | **VIP principal profile + PII**; adversaries; properties; threat profile; destination intel | 253-266 | synthesis |
| scan-entity-photos | gpt-4o-mini (gw) | entity name/role; reference+candidate images; feedback history | 346-351 | bulk-classification |
| scheduled-report-delivery | NONE | — | grep FP: invokes generate-executive-report/generate-report; no own model call | — |
| self-improvement-orchestrator | openai/gpt-5.2 | agent calibration scores; dormant list; prediction failures; perf metrics | 220-229 | synthesis |
| semantic-embed-knowledge | text-embedding-3-small (direct) | expert knowledge title+content (≤2000); agent specialties | 57-67 | bulk-classification |
| semantic-search | text-embedding-3-small (direct) + gpt-4o-mini | user query; global_docs chunks | 26-30,82-89 | conversational |
| send-daily-briefing | gpt-4o-mini (gw) | recent signals(≤50); open incidents; autonomous actions; escalation sequences | 235 | synthesis |
| simulate-attack-path | gpt-4o-mini (gw) | threat actor/entity; client/asset details; vuln; threat signals | 98 | synthesis |
| simulate-protest-escalation | gpt-4o-mini (gw) | signal text; severity/category; client location/industry; historical patterns | 117 | synthesis |
| suggest-investigation-references | gpt-4o-mini | current investigation file+synopsis; all other investigations | 71-80 | bulk-classification |
| support-chat | gpt-4o-mini | conversation transcript (≤10 msgs) | 39-60 | conversational |
| synthesize-entity-narratives | gpt-4o-mini (gw) | entity name/type/attributes; recent signal IDs; client context | 168 | synthesis |
| system-ops | NONE | — | grep FP: router/delegator to other functions | — |
| system-watchdog | callAiGateway (analysis) | platform telemetry; historical learnings; heartbeats | (callAiGateway; analysis phase) | synthesis |
| tech-radar-scanner | sonar (Perplexity, gw) + Gemini relevance | tech-security queries; org context (industry/assets/locations) | 67-70 | synthesis |
| thread-weaver | openai/gpt-5.2 (gw) | agent memories (content/entities/tags/embeddings); clustering | 130 | synthesis |
| threat-cluster-detector | gpt-4o-mini | threat cluster summaries; severity; entity tags; normalized signal text | 294 | synthesis |
| threat-radar-analysis | gpt-4o-mini | threat landscapes; signal summaries; entity data; critical assets; client context | 380 | synthesis |
| track-mitigation-effectiveness | gpt-4o-mini | playbook metrics; success/FP rates; response times; outcomes | 106 | synthesis |
| trajectory-positioner | openai/gpt-5.2 | signal title/desc/threat-type; trajectory phases/indicators | 225 | bulk-classification |
| traveller-aegis-chat | openai/gpt-4o-mini | **traveller trip data/destinations/itineraries/check-in**; web risk results | 269 | conversational |
| traveller-aegis-tts | tts-1-hd | deterministic text templates (no LLM inference) | 65 | conversational |
| traveller-parse-itinerary-text | openai/gpt-4o-mini | **traveller pasted itinerary text**; user chat | 150 | bulk-classification |
| vip-osint-discovery | gpt-4o-mini (direct) + sonar ×2 | OSINT web results; **PII (names/emails/phones)**; sanctions/PEP screening; image | 471,356,403 | synthesis |
| vision-analysis | gpt-4o-mini | image; scene/threat description | 49 | bulk-classification |
| wildfire-portal-chat | openai/gpt-4o (vision + chat) | image; operator message; fire telemetry; user chat | 170,235 | conversational |
| wraith-security-advisor | gpt-4o-mini ×4; **claude-opus-4-6**; **claude-haiku-4-5** ×2 | URL/email for phishing; CISA KEV feed; SSL/headers; **edge-function source code (opus)**; signal text + AEGIS user input (injection detection, haiku) | 140,160,313,572,679,806,885 | adversarial-judgment |
| system-ops / agent-router / agent-mesh-dispatcher / propagate-knowledge-edges / predictive-incident-scorer / scheduled-report-delivery | NONE (grep false positives) | — | see rows above | — |

## Summary (for the routing WO)

**Providers in use:** OpenAI (dominant — `gpt-4o-mini` is the workhorse; `gpt-4o` for vision/heavy synthesis; `text-embedding-3-small`; `whisper-1` STT; `tts-1-hd` TTS; `gpt-4o realtime`), **OpenAI `gpt-5.2`** (judgment tier), Google **Gemini 2.5-flash** (document OCR / image), **Perplexity `sonar`/`sonar-pro`** (live web/OSINT/travel/tech-radar), **Anthropic Claude** (`claude-opus-4-6`, `claude-haiku-4-5`) — **only** in `wraith-security-advisor`.

**Routing landmine:** `MODEL_NORMALIZATION` silently rewrites most `gemini-*` requests → OpenAI `gpt-4o-mini`. Functions requesting Gemini avatars/vehicle images/aegis-monitor actually hit OpenAI. The routing WO must decide this deliberately, not inherit it.

**gpt-5.2 (judgment) tier:** ai-decision-engine, red-team-analyst, red-team-review, resolve-agent-predictions, trajectory-positioner, self-improvement-orchestrator, thread-weaver, multi-agent-debate.

**Client-sensitive / PII egress (highest routing-policy priority):** travel/itinerary (`parse-itinerary`, `parse-travel-itinerary`, `monitor-travel-risks`, `traveller-*`), VIP/POI PII + breach data (`generate-poi-report`, `vip-osint-discovery`, `run-what-if-scenario`), client profile/assets (`process-client-onboarding`, `identify-critical-failure-points`, `model-geopolitical-risk`, `review-client-policy`, `propose-security-investments`), uploaded documents (`process-*`, `parse-entities-document`, `process-geospatial-map`), and edge-function **source code** to Anthropic (`wraith-security-advisor` opus).

**False positives (no external model call):** agent-router, agent-mesh-dispatcher, propagate-knowledge-edges (internal semantic/embedding routing), predictive-incident-scorer (key referenced, deterministic scoring), scheduled-report-delivery, system-ops (routers/delegators).

## Caveats (completeness discipline)
- Agent-derived + spot-verified; line numbers are approximate for multi-call functions (ranges given).
- `incident-agent-orchestrator` selects its model dynamically per agent (from `ai_agents`); `system-watchdog` model is set at its analysis call. Both confirmed to route via `callAiGateway`.
- Embedding calls (`text-embedding-3-small/large`) are retrieval, not inference — included because they still send content to an external provider (relevant to data-egress policy).
- This is the input artifact; a follow-up pass can pin exact per-call line numbers and per-model token/volume if the routing WO needs cost modeling.
