# Fortress AI — Capabilities Brief for Critical Risk Team

Prepared for the CRT discovery conversation. Use this as a reference, not a handout — the framing changes once you hear their answers to the discovery questions below.

---

## Discovery questions to ask CRT first

The right scope depends entirely on the answers to these. Ask before pitching specifics.

1. **What are your analysts using today for OSINT and threat monitoring?**
   *Looking for:* Liferaft, Echosec, Babel Street, Dataminr, manual workflows, or nothing? This determines whether Fortress displaces a tool, augments one, or fills a gap.

2. **What does the commercial relationship look like — white-labeled license per client, per-event project fee, or platform tenant per CRT analyst?**
   *Looking for:* how they want to package and price. Determines whether the build is single-tenant (just CRT) or multi-tenant per end-client, and whether the platform UI shows "Fortress" or "CRT" branding.

3. **Whose data is it, and where does it need to live?**
   *Looking for:* data ownership (CRT's or their end-client's) and data residency. FIFA-tier Canadian clients almost certainly require Canadian data residency. Surface this early — it can kill the deal if discovered late, since current production runs in US-Oregon.

---

## What Fortress can deliver today (live in production)

### Continuous OSINT ingestion
Monitors running on cron schedules across:
- News (Google News, scoped per client)
- Social: X/Twitter, Facebook/Instagram via CSE, TikTok
- Dark web, paste sites, GitHub for credential and code leaks
- Court registries
- CSIS publications
- NAAD emergency alerts (Canadian public alerting)
- Community / local news
- RSS sources

Each source on its own cadence — typically 15 minutes to 6 hours.

### Per-client entity scoping
Multi-tenant by design. The platform routes only signals matching the client's people, locations, facilities, supply-chain partners, and monitoring keywords into their feed. Adding a client is a configuration change, not a code change.

### AI relevance gating with specialist agents
Every signal passes through a 27-agent routing layer that decides which specialists review it:
- **Veridian-Tango** — counterterrorism analyst (CSIS / RCMP INSET frameworks, CARVER methodology)
- **Echo-Watch** — social engineering, influence operations, online radicalization
- **AEGIS-CMD** — top-level synthesis and coordination across the agent stack
- Plus 24 other domain specialists

Filters noise; surfaces signal.

### Per-signal reasoning trail
Every flagged signal opens to show:
- The agent's verdict
- The tools it called
- The data it queried
- Any predictions it made

Analysts can audit *why* the system flagged something. This is the strongest differentiator for ex-intelligence buyers — most competing platforms can't show this.

### Falsifiable predictions with calibration scoring
Agents log time-bounded predictions ("X will happen by Y date"). A nightly resolver compares predictions to outcomes and computes Brier scores. Calibration scorecard publishable from week one of operation.

### ArcGIS integration — three modes
Pick what the client's environment supports:
- **Link-only:** one-click jump from any signal to the client's published ArcGIS Experience map
- **API:** live spatial queries against the client's pipeline / facility / easement layers
- **Agent spatial tools:** "is this signal within X km of any critical asset?" answered automatically as part of the reasoning trail

### Wildfire and natural-disaster overlay
NASA FIRMS satellite hotspot data, CWFIS Canadian wildfire feeds, lightning strike correlation, facility proximity scoring. Relevant for clients with physical assets in BC or Alberta.

### Analyst approval queue
For AI-proposed actions (re-scan an entity, file a follow-up task, escalate severity), the analyst reviews and approves before anything executes. Three permission tiers: auto, propose, read-only.

### Daily briefings and alert routing
Per-client tuned briefing emails with entity-scoped intelligence. Alert delivery into existing channels — email and SMS today; Slack, Teams, and PagerDuty are per-client onboarding configuration.

---

## Quick wins — 1 to 2 weeks each

These are not shipped today but are well-scoped builds, not research projects.

- **Executive-protection threat-language classifier.** Fine-tuned on labeled data for intent-to-harm, doxxing, and brigading detection. Plugs into the existing relevance gate.
- **Event-mode cron tightening.** Drop high-priority source cadence to 1–5 minutes during match windows; revert to standard cadence afterward.
- **External feed adapter.** Generic adapter pattern for ingesting any commercial feed CRT already subscribes to (SITE, RANE, Janes, Recorded Future, Flashpoint) into the same Fortress pipeline. Each new feed becomes 1–3 days of integration once the adapter exists.

---

## Partner integrations — frame as "we ingest if CRT brings the subscription"

These are not Fortress capabilities to resell. They are commercial feeds CRT or the end-client should subscribe to directly. Fortress integrates them and adds reasoning, entity scoping, and delivery on top.

| Capability | Realistic partner |
|---|---|
| Primary-source terrorism intel | SITE Intelligence Group, TRAC, RANE |
| Advanced cyber threat intel | Recorded Future, Mandiant, Flashpoint |
| Coordinated disinformation network analysis | Graphika, Yonder, Logically |
| ICS / OT threat intel | Dragos, Claroty |

The leverage move: CRT keeps their existing subscription. Fortress integrates that one feed (2–3 days). Now every alert from that feed auto-correlates against the FIFA entity list, gets the reasoning trail, and routes to the right ops channel. Analyst productivity improves measurably; CRT pays nothing extra on top of what they already subscribe to.

---

## What not to promise

- **Protest monitoring** — explicitly out of scope per CRT's existing intel group.
- **Sub-1-minute monitoring across all sources** — Fortress is per-source-cadence, mostly 15-minute floor. Event-mode tightens specific sources, not all.
- **Historical prediction track record** — the calibration infrastructure is real and live. The track record builds from day one of CRT's deployment.
- **Multi-region data residency without scoping** — production currently runs in US-Oregon. Canadian residency for FIFA-tier clients is a migration project, not a flag flip.
- **Coordinated disinformation campaign analysis** — Fortress can flag negative narratives and viral posts. Network-level campaign attribution is partner work.
- **Primary-source terrorism intelligence on Fortress sources alone** — requires a commercial feed integration.

---

## Honest one-liner for the pitch

> "Continuous OSINT aggregation, AI-assisted triage, per-signal reasoning trail, GIS overlay, and alert routing — covering all your non-protest threat verticals. We ingest any specialist feed you already subscribe to and add reasoning, entity scoping, and delivery on top. We're the intelligence layer; you're the ops team."

---

## Suggested demo flow for the first CRT meeting

1. Open a real Petronas signal in production.
2. Show the reasoning trail — point out the agent's verdict, the tools it called, the prediction it logged.
3. Click the "Petronas operational map" link to demonstrate ArcGIS integration.
4. Walk through the entity scoping — show how the same signal pipeline serves a different client (BCCH) with completely different entities and keywords, no code changes.
5. Show the analyst approval queue.
6. Then ask the three discovery questions before scoping anything.

The reasoning trail demo is the strongest 60 seconds you can show ex-intelligence operators. Lead with it.
