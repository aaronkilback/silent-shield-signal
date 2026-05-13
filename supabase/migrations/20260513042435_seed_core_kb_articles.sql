-- ============================================================
-- Seed core knowledge-base articles (2026-05-12)
--
-- The support-chat bot pulls up to 30 published KB articles into
-- its system prompt. Seeding 12 high-leverage articles tagged
-- 'core' so the bot can reference real documentation when users
-- ask operational/how-to questions, and so the /knowledge-base
-- page has decent content beyond the original 7-article seed
-- from Nov 2025.
--
-- Idempotent: each INSERT is guarded by NOT EXISTS on title so
-- re-running won't duplicate.
-- ============================================================

DO $$
DECLARE
  cat_getting_started UUID;
  cat_signals UUID;
  cat_entities UUID;
  cat_automation UUID;
  cat_osint UUID;
  cat_reports UUID;
  cat_troubleshooting UUID;
BEGIN
  SELECT id INTO cat_getting_started FROM knowledge_base_categories WHERE name = 'Getting Started';
  SELECT id INTO cat_signals          FROM knowledge_base_categories WHERE name = 'Signals & Incidents';
  SELECT id INTO cat_entities         FROM knowledge_base_categories WHERE name = 'Entities & Relationships';
  SELECT id INTO cat_automation       FROM knowledge_base_categories WHERE name = 'Automation & AI';
  SELECT id INTO cat_osint            FROM knowledge_base_categories WHERE name = 'OSINT Sources';
  SELECT id INTO cat_reports          FROM knowledge_base_categories WHERE name = 'Reports & Analytics';
  SELECT id INTO cat_troubleshooting  FROM knowledge_base_categories WHERE name = 'Troubleshooting';

  -- 1. Signal lifecycle
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_signals,
    'Signal Lifecycle — Ingest to Resolution',
    E'# Signal Lifecycle\n\nEvery piece of intelligence the platform processes follows the same path.\n\n## 1. Source\nA monitor fetches from an OSINT source (RSS feed, Twitter API, NAAD CAP-XML, Google CSE, etc.). Sources have `status = active` and a `last_ingested_at` timestamp.\n\n## 2. Ingest\nThe monitor calls `ingest-signal`. This:\n- Deduplicates by content_hash, URL, and title-prefix-within-24h\n- Classifies category + severity via `classify-signal` (AI)\n- Scores relevance 0–1 via the AI Relevance Gate\n\n## 3. Gate decision\n- **Admitted** → `signals` table → visible in the live feed\n- **Rejected** → `filtered_signals` table → recorded with `filter_reason` for audit\n- **Stale** (event_date > 2y for general, > 3y for cyber) → historical bucket\n\n## 4. Triage\nThe analyst reviews the signal in the feed. Options:\n- Set status (new / triaged / investigating / resolved / archived)\n- Mark as false positive (feeds the learning loop)\n- Create incident (escalate)\n- Create entity (track a new person/org/location)\n\n## 5. Incident\nWhen severity + category + recency conditions trigger, signals cluster into incidents (P1/P2/P3) requiring analyst action.\n\n## 6. Resolution\nSignals carry through to briefs, executive reports, and the agent network for ongoing correlation.',
    'How a signal travels from OSINT source through the AI gate to triage, incident creation, and final reporting.',
    ARRAY['core','signals','lifecycle','triage','ingest'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Signal Lifecycle — Ingest to Resolution');

  -- 2. AEGIS vs Support Chat
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_getting_started,
    'AEGIS vs Support Chat — Which Assistant to Use',
    E'# Two Assistants, Two Jobs\n\nThe platform has two AI assistants. Use them for different things.\n\n## AEGIS — Analytical / Threat Questions\nLives in the main dashboard. Tenant-aware. Backed by the multi-agent debate stack, calibration scores, IOC lookups, and brief generation.\n\nAsk AEGIS:\n- "Is this threat assessment accurate?"\n- "Why is Wet''suwet''en activity elevated?"\n- "Summarize today''s threat landscape"\n- "What does TIER2-REVIEW think about this signal?"\n- "Run a multi-agent debate on this incident"\n\n## Support Chat — Platform / How-To / Bug Reports\nLives in the chat bubble in the bottom-right corner. Cross-tenant. Has read-only platform pulse: signal counts, filter rejection rates, cron heartbeats, source freshness.\n\nAsk Support Chat:\n- "Why is the Reddit cron failing?"\n- "How do I add a new source?"\n- "The signal feed looks empty — what''s broken?"\n- "Report this bug"\n- "How do I assign a client?"\n\n## Overlap zone\n"I''m not seeing many signals" — start with Support Chat. It will quote the platform pulse (recent signal counts, failed crons, stale sources). If the platform is healthy, take the question to AEGIS for analytical interpretation.',
    'AEGIS handles analytical/threat questions; Support Chat handles platform health, how-to, and bug reports. Start with Support Chat for "is something broken" questions.',
    ARRAY['core','aegis','support','assistants','getting-started'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'AEGIS vs Support Chat — Which Assistant to Use');

  -- 3. Multi-tenant client model
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_getting_started,
    'Client Model and Multi-Tenancy',
    E'# Clients — the Tenant Boundary\n\nEvery monitored entity in the platform belongs to a client. Clients are the unit of scoping for signals, incidents, reports, and entities.\n\n## Required fields\n- `name` — human-readable identifier (e.g. "Petronas Canada")\n- `status` — `active` enables monitoring; `inactive`/`paused` excludes from new ingests\n- `industry` — used by tier-2 fuzzy match in document processing\n- `tenant_id` — the workspace owner (Silent Shield Security, CRT once onboarded, etc.)\n\n## Monitoring configuration\n- `monitoring_keywords` — array of strings to track (e.g. "LNG Canada", "Coastal GasLink", "Wet''suwet''en")\n- `high_value_assets` — named assets to protect (e.g. "LNG Canada export terminal")\n- `locations` — geographic operations footprint (e.g. "Fort St. John", "Kitimat")\n- `competitor_names` — adversarial / peer organisations to monitor\n- `priority_keywords` — boost severity when matched\n- `negative_keywords` — exclude when matched\n\n## How monitors use this\nEvery monitor function (`monitor-news-google`, `monitor-twitter`, `monitor-rss-sources`, etc.) queries the clients table dynamically. No client name is hardcoded anywhere. To add a new client to monitoring, insert the row with the fields above and set `status = active`.',
    'Clients are the unit of tenancy. Configure monitoring_keywords, high_value_assets, locations, and competitor_names — monitors pick up changes on the next cron run.',
    ARRAY['core','clients','tenant','multi-tenant','configuration'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Client Model and Multi-Tenancy');

  -- 4. Triage workflow
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_signals,
    'Triage Workflow — Severity, False Positive, Archive, Escalate',
    E'# Signal Triage\n\nWhen a signal lands in the feed, the analyst has four actions.\n\n## 1. Set severity / status\nSeverity is set by `classify-signal` at ingest. Override via the signal detail dialog:\n- **critical / high** — immediate attention\n- **medium** — review within shift\n- **low / info** — context only\n\nStatus tracks where the signal is in your workflow: `new` → `triaged` → `investigating` → `resolved` (or `archived` for historical reference).\n\n## 2. Mark as false positive\nUse when the AI gate let through something irrelevant. The signal gets `status = false_positive` and disappears from the live feed. This feeds `learning_profiles` — over time the gate learns to reject similar content.\n\n## 3. Archive\nMoves the signal to historical without flagging it as wrong. Good for "real, but no longer actionable" content.\n\n## 4. Escalate\n- **Create Incident** — bundle this signal (and correlated peers) into an incident with priority P1/P2/P3 + assigned analyst\n- **Create Entity** — promote a named person/org/location from the signal into the entity registry for ongoing monitoring\n\n## Bulk operations\nThe Signals page supports multi-select for batch archive + batch dismiss. Bulk dismissals are recorded as analyst rejections for the learning loop.',
    'Four triage actions: set severity/status, mark false positive (feeds learning), archive (historical), or escalate to incident/entity. Bulk multi-select is supported.',
    ARRAY['core','triage','workflow','false-positive','incident'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Triage Workflow — Severity, False Positive, Archive, Escalate');

  -- 5. Adding sources
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_osint,
    'Adding and Editing OSINT Sources',
    E'# OSINT Sources\n\nSources are the inputs that feed monitors. The platform supports RSS, API feeds, social media, government alerts, court registries, and cyber advisories.\n\n## Adding a source (Admin → Sources)\nRequired fields:\n- `name` — descriptive identifier\n- `type` — `rss`, `api_feed`, `social`, `web_scrape`\n- `monitor_type` — names the monitor function that will pull it (e.g. `monitor-rss`, `monitor-twitter`)\n- `config` — JSON with URL, credentials, query params\n- `status` — `active` enables it; `paused` keeps the row but skips it\n\n## Active monitors\nEvery 15 min: `monitor-rss-sources`, `monitor-naad-alerts`, `monitor-wildfires`, `monitor-threat-intel`, `proactive-intelligence-push`.\nEvery 30 min: `monitor-twitter`.\nEvery hour: `monitor-news-google`, `monitor-community-outreach`.\nEvery 2 hours: `monitor-instagram`.\nEvery 4 hours: `monitor-court-registry`.\nEvery 6 hours: `monitor-csis`, `monitor-darkweb`, `monitor-github`, `monitor-pastebin`.\nEvery 12 hours: `monitor-cisa-kev`.\n\n## Editing\nUpdate `config` to point at a new URL or add a query parameter. The next cron run picks up the change. Use `last_ingested_at` to confirm the source is producing.\n\n## Troubleshooting silent sources\nA "silent" source (active but no signals) usually means: (a) feed changed URL/auth, (b) AI gate rejecting content as low-relevance, or (c) tier-2 fuzzy match failing to assign a client. Check `filtered_signals.filter_reason` for the source first.',
    'Sources have a type, monitor_type, config blob, and status. Adding a source means inserting that row — the next cron run will pick it up. Silent sources usually mean URL drift or gate rejection.',
    ARRAY['core','sources','osint','rss','monitors'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Adding and Editing OSINT Sources');

  -- 6. Filing bug reports
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_getting_started,
    'Filing a Bug Report from the Support Chat',
    E'# Bug Reports via Support Chat\n\nThe chat bubble in the bottom-right is the ticket system.\n\n## How to file one\n1. Open the Support Chat (bottom-right corner).\n2. Describe the issue. The bot will detect bug-report intent and ask clarifying questions: what isn''t working, what you were trying to do, what happened instead.\n3. Provide title + severity + description.\n4. When the bot has enough info it emits the marker `[BUG_READY]` which surfaces a green **Submit Bug Report** button at the bottom of the chat.\n5. Click the button. The ticket is filed to `bug_reports` with your conversation log attached.\n\n## What happens next\n- The operator (Aaron) is notified.\n- The bug gets `workflow_stage = reported` and `status = open`.\n- When fixed, you''ll be notified back in the same chat (planned: real-time push).\n\n## Severity guide\n- **critical** — platform unusable, security exposure, data loss risk\n- **high** — major feature broken, no workaround\n- **medium** — feature partially working, workaround exists\n- **low** — cosmetic, UX nit, future enhancement\n\n## When to escalate to a human\nAsk the bot "I need a human" or "I want to speak with someone." It will file a bug report tagged as needing human follow-up.',
    'The Support Chat IS the ticket system. Describe the issue; the bot will gather details and reveal a green Submit button. Use severity tags critical/high/medium/low.',
    ARRAY['core','bug-report','support','tickets','escalation'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Filing a Bug Report from the Support Chat');

  -- 7. AI relevance gate
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_automation,
    'AI Relevance Gate — Why Signals Get Rejected',
    E'# The AI Relevance Gate\n\nEvery candidate signal at `ingest-signal` time is scored 0–1 for relevance to the matched client. Below threshold → `filtered_signals` (rejected). Above → `signals` (admitted to live feed).\n\n## Threshold tuning (May 2026)\n- Base: 0.30\n- Floor: 0.25 (lowest the gate will go for highly credible sources)\n- Ceiling: 0.55 (highest for low-credibility sources)\n- Per-source adjustment based on `credibility_score` from learning_profiles\n\n## Why a signal gets rejected\nCommon `filter_reason` values:\n- `low_relevance` — content scored under threshold\n- `no_client_match` — neither direct keyword match nor tier-2 fuzzy match assigned a client\n- `geographic_mismatch` — content references the wrong country/region\n- `stale_event_date` — event > 2y old (or > 3y for cyber CVEs)\n- `duplicate` — title/URL/content-hash matched a recent existing signal\n\n## Adjusting behaviour\n- Add `priority_keywords` to the client config to boost severity on matches\n- Add `negative_keywords` to the client config to auto-exclude noise\n- Mark false positives in the feed — the learning loop tightens the gate for similar content over time\n\n## Operator override\nThere is no manual unblock. If too many real signals are being rejected, lower the per-source credibility adjustment, broaden monitoring_keywords, or contact the operator to retune the threshold floor.',
    'Signals scored under 0.25–0.55 (per-source-adjusted) land in filtered_signals with a filter_reason. Common reasons: low_relevance, no_client_match, geographic_mismatch, stale_event_date, duplicate.',
    ARRAY['core','ai-gate','relevance','filter','rejection'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'AI Relevance Gate — Why Signals Get Rejected');

  -- 8. Agent action queue
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_automation,
    'Agent Action Queue — Auto vs Propose',
    E'# Agent Action Queue\n\nSpecialist agents (TIER2-REVIEW, AEGIS-CMD, sector experts) review signals and propose follow-up actions. There are two permission tiers.\n\n## Auto-tier\nLow-risk reversible actions. Execute immediately, no queue.\n- File a follow-up note on a signal\n- Schedule a rescan / re-correlation\n- Tag a signal with additional context\n- Request a deep-scan on an entity\n\n## Propose-tier\nHigh-impact actions. Routed to `agent_action_queue` for operator review.\n- Severity changes (e.g. medium → critical)\n- Escalation to incident with assigned analyst\n- New entity creation\n- Client config changes (rare)\n\n## Auto-resolution rules (added May 2026)\nOperator review can be a bottleneck. Two rules trim the queue automatically:\n1. **Consensus auto-execute** — if 2+ agents propose the same action with high confidence, apply without waiting.\n2. **Stale default-approve** — proposals older than 24h in the safe direction (severity ↑, incident creation) default-approve.\n\n## Reviewing the queue\nAdmin → Agent Action Queue shows pending items with the proposing agent, signal context, and the proposed change. Approve / reject / edit before applying.',
    'Auto-tier actions execute immediately; Propose-tier go to the operator review queue. 2+ agent consensus auto-executes; stale safe-direction proposals default-approve after 24h.',
    ARRAY['core','agents','action-queue','automation','consensus'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Agent Action Queue — Auto vs Propose');

  -- 9. Public emergency signals
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_osint,
    'Emergency Alerts — NAAD CAP, Wildfires, BC Wildfire Service',
    E'# Public Emergency Signals\n\nThe platform ingests three real-time public-safety feeds.\n\n## NAAD (National Alert Aggregation & Dissemination)\nCanadian Emergency CAP-XML alerts. Monitored every 15 min by `monitor-naad-alerts`. The Atom feed only has title+summary — the operational data (event type, severity, response_type, polygon coordinates, instructions) lives in the linked `.cap` XML file. The monitor fetches and parses both layers.\n\n## CWFIS Wildfires\nNatural Resources Canada Wildfire Information System. Monitored every 15 min by `monitor-wildfires`. Sources:\n- `hotspots_last24hrs` WFS — VIIRS/MODIS thermal detections, pre-enriched with FWI + FBP\n- `m3_polygons_current` WFS — active fire perimeters\n- `lightning_obs_24h` WFS — 24h cloud-to-ground strikes\n\nThe wildfire classifier is tiered (NOT binary):\n- < 0.5km from industrial facility → industrial_flaring\n- 0.5–4km → industrial_flaring if FRP > 120MW + HFI < 500 kW/m + off-season, otherwise ambiguous_near_facility\n- > 4km → wildfire (with off-season override: HFI < 2000 → industrial_flaring)\n\n## BC Wildfire Service\nProvincial fire incidents and air quality. NE BC crews dispatch from the Fort St. John Fire Zone (operational unit) — not the Prince George Fire Centre (jurisdictional). Don''t conflate the two in response-time language.\n\n## Signal types created\n`wildfire`, `industrial_flaring`, `ambiguous_near_facility`, `lightning_strike`, `naad_alert`. AEGIS Wildfire Watcher interprets seasonal context, lightning correlation, and tiered flare-vs-fire indicators.',
    'NAAD CAP-XML for Canadian emergency alerts, CWFIS for wildfire/lightning, BC Wildfire Service for provincial fire data. Tiered classifier separates real fires from industrial flares.',
    ARRAY['core','wildfire','naad','emergency','cap-xml'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Emergency Alerts — NAAD CAP, Wildfires, BC Wildfire Service');

  -- 10. Entity intelligence
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_entities,
    'Entity Intelligence — POI, Deep Scan, Active Monitoring',
    E'# Entities\n\nEntities are tracked persons, organisations, locations, or infrastructure. They drive targeted monitoring, deep-scan investigation, and POI reports.\n\n## Required fields\n- `client_id` — the tenant the entity belongs to\n- `type` — `person`, `organization`, `location`, `domain`, `ip`\n- `name` — canonical identifier\n- `aliases` — array of alternate names (very important for activists / threat actors with handles)\n- `attributes` — JSONB with contact_info, role, affiliation, photos\n- `threat_score` — 0–100 calculated from analyst feedback + agent assessments\n- `active_monitoring_enabled` — boolean; required for the entity to appear in monitor-twitter, monitor-news-google entity-name queries, and social monitoring queues\n\n## Investigate POI\nUser-triggered deep investigation. Calls `investigate-poi` which scans:\n- People-search sites (Spokeo, ZabaSearch, TruePeopleSearch)\n- Court records (PACER, provincial registries)\n- Social media profiles (LinkedIn, Twitter, Facebook, Instagram)\n- HIBP breach check (uses entity email if available)\n- News + dark-web mentions\n\nFindings store in `entity_content` and create signals for threat/activist/lawsuit keyword matches.\n\n## Deep Scan\n`entity-deep-scan` runs a phased academic + social + dark-web scan. Phase 2B (academic) uses site-specific queries that intentionally drop the disambiguation anchor — adding it to a site-restricted query causes 0 results.\n\n## Risk Assessment\nThe Assess button calls `assess-entity` and writes `ai_assessment` to the entity. The Risk Assessment tab shows summary, key findings, recommended actions.',
    'Entities need active_monitoring_enabled=true to appear in queries. Investigate POI runs deep scan across people-search, court records, social, HIBP, news. Aliases array is critical.',
    ARRAY['core','entities','poi','deep-scan','monitoring'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Entity Intelligence — POI, Deep Scan, Active Monitoring');

  -- 11. Briefs and reports
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_reports,
    'Executive Intelligence Briefs and Daily Reports',
    E'# Briefs and Reports\n\nThe platform generates three classes of analyst-ready output.\n\n## Executive Intelligence Brief (per client)\nGenerated daily via cron or on-demand from the Reports page. Sections:\n- **Executive Flash** — 1-paragraph current state\n- **Risk Assessment Matrix** — severity × likelihood grid\n- **Action Items** — each tied to a signal_number for traceability\n- **Issues of Specific Concern** — emerging threats\n- **Strategic Deductions** — analyst inference, widens when high-severity signals are sparse\n\nReports query `agent_debate_records` and inject synthesised conclusions with named-agent attribution.\n\n## Daily Briefing\nClient-facing roll-up. Combines top signals + entity activity + emerging issues + threat-landscape pulse from AEGIS.\n\n## POI Investigation Report\nGenerated by `generate-poi-report` from an `investigate-poi` run. Strict sourcing rule enforced in the AI prompt: every specific finding must cite `[Source N]` with URL. Live HIBP fallback runs if the original scan timed out. Includes Known Associates section drawn from `entity_relationships`.\n\n## Fortress Report (AEGIS tool)\nOn-demand analyst report. AEGIS pulls live signal/entity/incident state, runs a multi-agent debate if needed, and produces a formatted PDF/HTML output.\n\n## Where to find them\nDashboard → Reports tab → filter by client, date range, type. Generated briefs land in `osint-media` bucket (private, 7-day signed URLs).',
    'Three report classes: Executive Brief (per client, daily/on-demand), Daily Briefing (roll-up), POI Investigation Report (entity-specific, strict sourcing). Generated reports land in osint-media bucket.',
    ARRAY['core','briefs','reports','executive','poi'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Executive Intelligence Briefs and Daily Reports');

  -- 12. Troubleshooting recipes
  INSERT INTO knowledge_base_articles (category_id, title, content, summary, tags, is_published)
  SELECT cat_troubleshooting,
    'Common Troubleshooting Recipes',
    E'# Troubleshooting Recipes\n\nQuick diagnostic paths for the most common operator questions.\n\n## "I''m not seeing many signals"\n1. Support Chat will quote the platform pulse: signals last 24h, by client, by source.\n2. Check failed cron heartbeats — `cron_heartbeat` rows with `status = failed` in the last hour.\n3. Check stale active sources — `sources.last_ingested_at` older than 6h on `status = active` rows.\n4. Look at filter rejection top reasons. High `no_client_match` count → monitoring_keywords are too narrow.\n\n## "Why didn''t signal X show up?"\n1. Search `filtered_signals` for the URL or title. If present, read `filter_reason`.\n2. If not present, the source itself didn''t pick it up — check the monitor''s cron heartbeat for the same window.\n3. If event_date > 2y, it routed to historical (or > 3y for cyber).\n4. If duplicate, look for an existing signal with the same content_hash or title prefix in the last 24h.\n\n## "X source isn''t producing"\n1. Confirm `sources.status = active`.\n2. Check `last_ingested_at` — over 6h on an active source is stale.\n3. The most common cause is upstream feed change: URL moved, auth expired, rate-limited.\n4. AI gate may be rejecting all content — search `filtered_signals` for that source_id.\n\n## "Severity looks wrong on signal X"\n`classify-signal` sets the base severity. Adjust in the signal detail dialog, or wait for an agent to propose a change via the action queue.\n\n## "MFA isn''t sending the code"\nRequires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` secrets. If 500 errors return, those need configuring in Supabase project secrets.\n\n## "Compliance Gate keeps blocking my scan"\nNot a bug — by design. All vulnerability scans require: full checklist, jurisdiction + legal basis, data deletion date, client email OTP authorization. The skip button has been intentionally removed.',
    'Diagnostic paths for the six most common operator questions: no signals, missing signal X, silent source, wrong severity, MFA failing, compliance gate blocking. Start by quoting the platform pulse.',
    ARRAY['core','troubleshooting','no-signals','stale-source','severity'],
    true
  WHERE NOT EXISTS (SELECT 1 FROM knowledge_base_articles WHERE title = 'Common Troubleshooting Recipes');

END $$;
