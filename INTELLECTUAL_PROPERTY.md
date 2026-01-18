# Fortress AI Technical Trade Secrets & Intellectual Property Register

**Document Classification:** TRADE SECRET  
**Version:** 2.0  
**Last Updated:** 2026-01-18  
**Document Owner:** Ember Leaf Security Inc.  
**Maintained By:** Development Team

---

## 1. Document Purpose

**Classification:** PUBLIC

This document serves as the authoritative record of Fortress AI's technical trade secrets, proprietary design logic, system architecture, and intellectual property. It is intended to establish ownership, prevent misappropriation, and provide a defensible record of what makes Fortress AI unique.

This is a living document that must be updated whenever the system meaningfully evolves.

---

## 2. System Definition

**Classification:** CONFIDENTIAL

### 2.1 What Fortress AI Is

Fortress AI is a decision-support intelligence system that ingests multi-source signals, performs entity correlation, structures risk, and produces human-actionable outputs that compress the **Signal → Decision → Action** loop for security teams.

### 2.2 Problem Statement

Security teams are overwhelmed by:
- High-volume, low-context alerts from disparate sources
- Manual correlation across siloed data systems
- Time pressure to make consequential decisions with incomplete information
- Inability to track threat evolution across time and entities

Fortress solves this by transforming raw signals into structured, correlated intelligence with clear decision pathways.

### 2.3 What Fortress AI Is NOT

| Fortress Is NOT | Why It Is Different |
|-----------------|---------------------|
| A chatbot | Fortress does not merely answer questions — it structures risk, correlates entities, and produces actionable intelligence outputs |
| A dashboard | Dashboards display data; Fortress *reasons* about data, surfaces what matters, and provides decision context |
| A SIEM | SIEMs aggregate logs and generate alerts; Fortress correlates across sources, tracks entities over time, and structures threat narratives |
| A basic OSINT tool | OSINT tools scrape data; Fortress extracts entities, correlates patterns, assesses momentum, and maps consequences |

### 2.4 Core Value Proposition

Fortress compresses the cognitive load of security decision-making by:
1. **Ingesting** signals from multiple sources (OSINT, internal data, environmental data)
2. **Correlating** those signals to entities, locations, and patterns
3. **Structuring** risk using confidence, momentum, proximity, and consequence
4. **Outputting** decision-ready intelligence (Risk Snapshots, Incident Cards, Entity Profiles)
5. **Keeping humans in the loop** for high-consequence decisions

---

## 3. System Architecture Map

**Classification:** TRADE SECRET

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           HUMAN-IN-THE-LOOP LAYER                           │
│         Analyst validation │ Incident approval │ Decision authority         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OUTPUT LAYER                                    │
│   Risk Snapshots │ Incident Cards │ Entity Cards │ Executive Briefings      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
┌─────────────────────────────────────────────────────────────────────────────┐
│                            REASONING LAYER                                   │
│   Signal Confidence │ Threat Momentum │ Proximity to Trigger │ Consequence  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CORRELATION ENGINE                                  │
│   Entity Extraction │ Cross-Source Linkage │ Temporal Pattern Tracking      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
┌─────────────────────────────────────────────────────────────────────────────┐
│                         OSINT & SIGNAL LAYER                                 │
│   Source Prioritization │ Noise Filtering │ Signal Normalization            │
└─────────────────────────────────────────────────────────────────────────────┘
                                      ▲
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DATA INGESTION LAYER                                 │
│   External Sources (OSINT, Environmental) │ Internal Client Data            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Layer Details

#### 3.2.1 Data Ingestion Layer

**Purpose:** Receive and normalize data from all configured sources.

| Mechanism | Description |
|-----------|-------------|
| Scheduled Edge Functions | Automated polling of external sources (news, social, threat intel) |
| Document Upload | Manual ingestion of security reports, intelligence documents |
| API Integration | Real-time feeds from configured external systems |
| Manual Signal Entry | Analyst-submitted intelligence |

**Technical Implementation:** 50+ Deno edge functions coordinated by `auto-orchestrator`.

#### 3.2.2 OSINT & Signal Layer

**Purpose:** Transform raw data into normalized, prioritized signals.

| Function | Implementation |
|----------|----------------|
| Source Prioritization | Weighted scoring based on source reliability and historical accuracy |
| Noise Filtering | Duplicate detection, relevance scoring, confidence thresholds |
| Signal Normalization | Standardized schema (title, description, severity, source, category) |
| Severity Classification | P1-P4 based on threat characteristics and client context |

**Key Edge Functions:** `ingest-signal`, `detect-near-duplicate-signals`, `cleanup-duplicate-signals`

#### 3.2.3 Correlation Engine

**Purpose:** Connect signals to entities and identify patterns.

| Capability | Description |
|------------|-------------|
| Entity Extraction | Named entity recognition (people, organizations, locations, infrastructure) |
| Cross-Source Linkage | Connecting mentions of the same entity across different signals |
| Temporal Pattern Tracking | Identifying escalation patterns, repeat mentions, threat evolution |
| Relationship Mapping | Building entity relationship graphs (works_for, located_in, affiliated_with) |

**Key Edge Functions:** `correlate-signals`, `correlate-entities`, `auto-enrich-entities`

#### 3.2.4 Reasoning Layer

**Purpose:** Structure risk and assess threat significance.

| Risk Dimension | Description |
|----------------|-------------|
| Signal Confidence | How reliable is the source? How verifiable is the claim? |
| Threat Momentum | Is this threat escalating, stable, or declining? |
| Proximity to Trigger | How close is this threat to materializing? |
| Consequence Mapping | What is the potential impact if this threat materializes? |

**Key Edge Functions:** `ai-decision-engine`, `threat-radar-analysis`, `calculate-anticipation-index`

#### 3.2.5 Output Layer

**Purpose:** Present structured intelligence in decision-ready formats.

| Output Type | Purpose | Audience |
|-------------|---------|----------|
| Risk Snapshots | Point-in-time risk summary for a client | Executives, Security Managers |
| Incident Cards | Structured incident details with timeline and entities | Analysts, Responders |
| Entity Cards | Comprehensive entity profile with risk assessment | Investigators |
| Threat Signals | Prioritized alert with context and recommendations | SOC Analysts |
| Executive Briefings | High-level summary with strategic implications | C-Suite |

#### 3.2.6 Human-in-the-Loop Layer

**Purpose:** Ensure human judgment governs consequential decisions.

| Decision Type | Human Role |
|---------------|------------|
| Incident Creation | AI recommends; analyst approves or rejects |
| Entity Risk Escalation | AI flags; analyst validates |
| Alert Dispatch | AI drafts; analyst authorizes |
| Client Communication | AI assists; human delivers |

---

## 4. Data Sources (Technical IP)

**Classification:** CONFIDENTIAL

### 4.1 External Data Sources

#### 4.1.1 Open-Source Intelligence (OSINT)

| Source Type | What It Is | Why It Matters | How Fortress Uses It |
|-------------|-----------|----------------|---------------------|
| News Feeds | Real-time news from multiple providers | Early warning of incidents, contextual awareness | `monitor-news`, `monitor-news-google` extract relevant stories, normalize to signals |
| Social Media | Twitter/X, Facebook, Instagram, LinkedIn | Activist activity, public sentiment, emerging threats | Platform-specific monitors extract mentions, assess credibility |
| Threat Intelligence Feeds | Commercial and open threat intel | Known threat actors, TTPs, IOCs | `monitor-threat-intel` correlates to client assets |
| Dark Web Monitoring | Tor sites, paste sites, forums | Credential leaks, threat chatter, attack planning | `monitor-darkweb`, `monitor-pastebin` surface relevant mentions |
| Court & Legal Records | Public court filings, regulatory actions | Legal risks, litigation exposure | `monitor-court-registry` tracks relevant cases |
| Government Sources | CSIS, regulatory agencies | Official threat assessments, compliance changes | `monitor-csis`, `monitor-regulatory-changes` |

#### 4.1.2 Environmental & Safety Data

| Source Type | What It Is | Why It Matters | How Fortress Uses It |
|-------------|-----------|----------------|---------------------|
| Wildfire Data | Active fire locations, spread predictions | Physical asset threats, evacuation planning | `monitor-wildfires`, `monitor-wildfire-comprehensive` |
| Weather Risk | Severe weather alerts, forecasts | Operational impact, safety risks | `monitor-weather` with geographic filtering |
| Earthquake Data | Seismic activity, magnitude, location | Infrastructure threats, response planning | `monitor-earthquakes` for relevant regions |
| Travel Risk | Country risk levels, incident data | Personnel safety, travel advisory | `monitor-travel-risks` with itinerary context |

#### 4.1.3 Regional Intelligence

| Source Type | What It Is | Why It Matters | How Fortress Uses It |
|-------------|-----------|----------------|---------------------|
| Canadian Sources | Canada-specific news, government, industry | Localized threat context | `monitor-canadian-sources` |
| APAC Regional | Asia-Pacific regional intelligence | Geopolitical risk, supply chain | `monitor-regional-apac` |

### 4.2 Internal Client Data Sources

| Data Type | What It Is | How Fortress Integrates It |
|-----------|-----------|---------------------------|
| Incident Logs | Historical security incidents | Cross-referenced with signals for pattern detection |
| Security Reports | 3Si reports, guard reports, assessments | Parsed via `process-intelligence-document`, entities extracted |
| Asset Records | High-value assets, locations, personnel | Used for proximity analysis and impact assessment |
| Entity Watchlists | Persons/orgs of interest | Monitored via OSINT for activity |
| Patrol Data | Guard patrol logs, observations | Ingested as internal signals for correlation |
| Near-Miss Reports | Incidents that almost occurred | Analyzed for precursor patterns |
| Travel Itineraries | Personnel travel schedules | Cross-referenced with location-based threats |

---

## 5. Core Technical Capabilities

**Classification:** TRADE SECRET

### 5.1 Entity Extraction & Tracking

**Strategic Importance:** Entities are the connective tissue of intelligence. Without entity tracking, signals remain isolated events rather than parts of an evolving threat picture.

| Capability | Description |
|------------|-------------|
| Entity Identification | AI-powered extraction of people, organizations, locations, infrastructure from unstructured text |
| Persistent Tracking | Entities maintain identity across time; new mentions link to existing profiles |
| Cross-Dataset Linkage | Same entity recognized across news, social media, documents, incidents |
| Alias Resolution | Multiple names/identifiers resolved to single entity |
| Relationship Inference | Automated detection of relationships (employment, affiliation, location) |

**Implementation:** `correlate-entities`, `auto-enrich-entities`, `osint-entity-scan`

### 5.2 Signal Correlation

**Strategic Importance:** Isolated alerts create noise; correlated signals create intelligence.

| Capability | Description |
|------------|-------------|
| Pattern Detection | Identifying clusters of related signals across time and source |
| Temporal Correlation | Recognizing escalation patterns (increasing frequency, severity) |
| Geographic Correlation | Clustering signals by location proximity |
| Entity-Based Correlation | Grouping signals that reference the same entities |
| Terrain of Risk | Building a holistic threat picture rather than a list of alerts |

**Implementation:** `correlate-signals`, `signal_correlation_groups` table, `detect-near-duplicate-signals`

### 5.3 Risk Structuring Logic (Key Differentiator)

**Strategic Importance:** This is the core intellectual property that distinguishes Fortress from alert-generators.

| Risk Dimension | Definition | How Fortress Measures It |
|----------------|------------|-------------------------|
| **Signal Confidence** | How reliable and verifiable is this information? | Source reliability score, corroboration count, recency |
| **Threat Momentum** | Is this threat escalating, stable, or declining? | Signal frequency trend, severity progression, geographic spread |
| **Proximity to Trigger** | How close is this threat to materializing? | Precursor indicators, temporal patterns, stated timelines |
| **Consequence Mapping** | What is the potential impact? | Asset proximity, client criticality, historical precedent |

**Implementation:** `ai-decision-engine`, `calculate-anticipation-index`, `threat-radar-analysis`

### 5.4 Structured Outputs Catalog

| Output | Purpose | Structure | Audience |
|--------|---------|-----------|----------|
| **Risk Snapshot** | Point-in-time client risk summary | Summary, active threats, entity activity, recommendations | Executives, Security Managers |
| **Incident Card** | Comprehensive incident record | Title, timeline, entities, signals, AI analysis, actions | Analysts, Responders |
| **Entity Card** | Comprehensive entity profile | Name, type, aliases, risk level, relationships, activity timeline | Investigators |
| **Threat Signal** | Prioritized alert with context | Title, severity, source, description, entity mentions, recommendations | SOC Analysts |
| **Executive Briefing** | Strategic summary for leadership | Overview, key threats, trends, recommendations, metrics | C-Suite |
| **Anticipation Index** | Predictive threat score | Composite score, contributing factors, trend direction | Strategic Planning |

---

## 6. Proprietary Prompts & Agents Registry

**Classification:** TRADE SECRET

> **Note:** Full prompt text is NOT stored in this document. This registry tracks existence, purpose, and access only.

### 6.1 Core Prompts

| Name | Purpose | Storage Location | Access | Sensitivity |
|------|---------|------------------|--------|-------------|
| Aegis Master Prompt | Primary dashboard AI assistant system prompt | `dashboard-ai-assistant/index.ts` | super_admin only | TRADE SECRET |
| Agent Chat Prompt | Specialized agent interaction with tools | `agent-chat/index.ts` | super_admin only | TRADE SECRET |
| Briefing Chat Prompt | Incident-scoped briefing responses | `briefing-chat-response/index.ts` | super_admin only | TRADE SECRET |
| AI Decision Engine Prompt | Autonomous signal analysis and incident creation | `ai-decision-engine/index.ts` | super_admin only | TRADE SECRET |
| Investigation AI Assist Prompt | Investigation writing assistance | `investigation-ai-assist/index.ts` | super_admin only | TRADE SECRET |

### 6.2 Specialized Agents

| Agent Name | Call Sign | Purpose | Specialty | Sensitivity |
|------------|-----------|---------|-----------|-------------|
| AEGIS | AEGIS-1 | Primary user-facing AI assistant | General intelligence, system queries | TRADE SECRET |
| (Additional agents as configured) | Various | Specialized investigation roles | Domain-specific analysis | TRADE SECRET |

### 6.3 Proprietary Logic Modules

| Module | Purpose | Location | Sensitivity |
|--------|---------|----------|-------------|
| Anti-Hallucination Framework | Prevents AI fabrication of intelligence | `_shared/anti-hallucination.ts` | TRADE SECRET |
| Reliability First Protocol | Enforces source citation requirements | `_shared/reliability-first.ts` | TRADE SECRET |
| Tenant Isolation Logic | Multi-tenant data separation | `_shared/tenant-isolation.ts` | TRADE SECRET |
| Simple Acknowledgment Detection | Context-aware conversational responses | All AI chat functions | PROPRIETARY |

---

## 7. Design Principles of the AI

**Classification:** CONFIDENTIAL

Fortress AI agents are designed according to these technical principles:

### 7.1 Information Integrity

| Principle | Implementation |
|-----------|----------------|
| Prioritize Verifiable Information | Agents query databases before making claims; tool results take precedence over inference |
| Distinguish Fact from Inference | Responses explicitly mark unverified claims; confidence levels stated |
| Reduce Hallucination Risk | Anti-hallucination prompts, forbidden phrase detection, source citation requirements |
| Use Structured Intelligence Standards | Outputs follow consistent schemas; claims are categorized by confidence |
| Cite Sources When Possible | Database sources, document references, and tool results are cited |

### 7.2 Response Quality

| Principle | Implementation |
|-----------|----------------|
| Context-Appropriate Responses | Simple acknowledgments receive brief replies; complex queries receive comprehensive analysis |
| Tool Execution Over Description | Agents call tools rather than describing what they would do |
| Scope Enforcement | Briefing agents stay within incident/investigation scope |
| Client Isolation | Agents never reference data from other tenants |

---

## 8. Human-in-the-Loop Principles

**Classification:** CONFIDENTIAL

Fortress is intentionally designed so that:

| Principle | Implementation |
|-----------|----------------|
| AI accelerates judgment — it does not replace it | AI surfaces, structures, and recommends; humans decide and act |
| Humans validate high-consequence decisions | Incident creation, alert dispatch, client communication require human approval |
| The system is a decision amplifier | AI handles volume and correlation; humans handle judgment and accountability |
| Transparency over automation | AI reasoning is visible; analysts can see why recommendations were made |
| Override capability | Humans can override AI recommendations at any point |

### 8.1 Decision Authority Matrix

| Decision Type | AI Authority | Human Authority |
|---------------|--------------|-----------------|
| Signal Ingestion | Full | Review optional |
| Signal Prioritization | Full | Override available |
| Entity Extraction | Full | Correction available |
| Incident Recommendation | Recommend only | Approval required |
| Incident Creation | Auto-create for P1/P2 | Must acknowledge |
| Alert Dispatch | Draft only | Approval required |
| Client Communication | Assist only | Human delivers |

---

## 9. Technical Differentiation Statement

**Classification:** CONFIDENTIAL

### What Fortress Is

Fortress AI is a **decision system that compresses Signal → Decision → Action through structured intelligence and correlation.**

### What Fortress Is NOT

| Category | Why Fortress Is Different |
|----------|--------------------------|
| Not merely a dashboard | Dashboards display; Fortress reasons, correlates, and recommends |
| Not merely a chatbot | Chatbots answer; Fortress structures risk and produces intelligence outputs |
| Not merely a SIEM | SIEMs aggregate logs; Fortress correlates entities across OSINT, documents, and internal data |
| Not merely an OSINT scraper | Scrapers collect; Fortress extracts entities, tracks patterns, and maps consequences |

### Core Differentiators

1. **Entity-Centric Intelligence:** Everything connects to entities tracked over time
2. **Multi-Source Correlation:** Signals from disparate sources are linked, not siloed
3. **Structured Risk Assessment:** Confidence, momentum, proximity, and consequence — not just severity labels
4. **Decision-Ready Outputs:** Risk Snapshots, Incident Cards, Entity Profiles — not just alerts
5. **Human-in-the-Loop Design:** AI accelerates; humans decide

---

## 10. Version Control & Change Log

**Classification:** PUBLIC

### Current Version

| Field | Value |
|-------|-------|
| Version | 2.0 |
| Last Updated | 2026-01-18 |
| Updated By | Development Team |

### Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.0 | 2026-01-18 | Development Team | Complete restructure per IP Register mandate; added all 11 sections |
| 1.0 | 2026-01-18 | Development Team | Initial creation |

### Update Triggers

This document must be updated when:
- New data sources are integrated
- New AI agents or prompts are created
- New output types are added
- Core algorithms are modified
- Architecture changes significantly
- New proprietary capabilities are developed

---

## 11. Sensitivity Classification Key

**Classification:** PUBLIC

| Label | Definition | Examples |
|-------|------------|----------|
| **PUBLIC** | May be shared externally | Document purpose, version info |
| **CONFIDENTIAL** | Internal use only; not for external distribution | System definition, design principles, data source categories |
| **TRADE SECRET** | Maximum protection; access restricted to authorized personnel | Architecture details, correlation algorithms, prompts, risk structuring logic |

### Default Classifications

| Section | Default Classification |
|---------|----------------------|
| Document Purpose | PUBLIC |
| System Definition | CONFIDENTIAL |
| System Architecture | TRADE SECRET |
| Data Sources | CONFIDENTIAL |
| Core Capabilities | TRADE SECRET |
| Prompts & Agents | TRADE SECRET |
| Design Principles | CONFIDENTIAL |
| Human-in-the-Loop | CONFIDENTIAL |
| Differentiation Statement | CONFIDENTIAL |
| Version Control | PUBLIC |
| Sensitivity Key | PUBLIC |

---

*This document contains confidential trade secrets and proprietary information of Ember Leaf Security Inc. Unauthorized disclosure, copying, or distribution is strictly prohibited and may result in legal action.*
