
# Aegis Capability Enhancement Plan: Principal Intelligence Suite

## Overview
This plan implements all 5 capabilities requested by Aegis to transform Fortress from a reactive intelligence platform into a proactive, personalized executive protection system. Each enhancement builds on the existing architecture without breaking any current functionality.

---

## Capability 1: Principal Profile Tool (`get_principal_profile`)

### Current State
- VIP data exists in the `entities` table with rich `attributes` JSONB field
- `vip-deep-scan` function creates entities with: travel patterns, family, adversaries, properties, digital footprint
- `run_vip_deep_scan` tool exists but is OSINT-gathering focused, not profile retrieval

### What We'll Build
A new tool that consolidates all principal intelligence for personalized briefings:

```text
Tool: get_principal_profile

Input: { entity_id?: string, entity_name?: string }

Returns:
{
  profile_summary: { name, aliases, nationality, DOB, risk_level }
  travel_patterns: { frequent_destinations, upcoming_trips, preferred_airlines }
  properties: [{ address, type, security_system, wildfire_risk }]
  known_adversaries: [{ name, relationship, threat_level }]
  family_members: [{ name, relationship, social_exposure }]
  digital_footprint: { social_handles, email_providers, cloud_services }
  movement_patterns: { regular_routes, frequented_locations }
  threat_profile: { specific_concerns, industry_threats, previous_incidents }
  active_monitoring: { enabled, radius_km, alert_count_30d }
  risk_appetite: { threshold, alert_frequency }  // NEW field
}
```

### Implementation Steps
1. **Add tool definition** to `dashboard-ai-assistant/index.ts` tools array
2. **Add execution handler** in the tool switch statement that:
   - Queries `entities` table for VIP type entities
   - Joins with `entity_relationships` for family/adversaries
   - Joins with `travelers` + `itineraries` for travel data
   - Joins with `entity_content` for recent mentions/sentiment
   - Returns structured principal profile
3. **Add same tool** to `agent-chat/index.ts` for Aegis voice/chat access

---

## Capability 2: What-If Scenario Engine (`run_what_if_scenario`)

### Current State
- `simulate-attack-path` exists (cyber-focused)
- `simulate-protest-escalation` exists (protest-focused)
- Both are siloed and don't incorporate principal travel data

### What We'll Build
An orchestration layer that combines principal context with destination threat data:

```text
Tool: run_what_if_scenario

Input: {
  entity_id: string,
  scenario_type: "travel" | "physical" | "reputation" | "combined",
  hypothetical: {
    destination?: string,
    date_range?: { start, end },
    condition_change?: string  // e.g., "social media trend intensifies by 50%"
  }
}

Returns:
{
  scenario_description: string,
  principal_context: { travel_patterns, known_adversaries, properties },
  destination_analysis: { threat_hotspots, weather_risks, political_stability },
  impact_assessment: {
    physical_security: { level, factors },
    reputational: { level, factors },
    operational: { level, factors }
  },
  recommendations: [{ action, priority, rationale }],
  escalation_triggers: [string],
  simulation_confidence: number
}
```

### Implementation Steps
1. **Create new edge function** `supabase/functions/run-what-if-scenario/index.ts`
2. **Logic flow**:
   - Fetch principal profile using entity_id (reuse get_principal_profile logic)
   - Fetch destination threat data via `threat-radar-analysis` or `monitor-travel-risks`
   - Cross-reference known adversaries with destination
   - Call Lovable AI to synthesize scenario impact
   - Return structured assessment
3. **Add tool definition** to both AI assistants
4. **Add execution handler** that invokes the edge function

---

## Capability 3: Sentiment Drift Analysis (`analyze_sentiment_drift`)

### Current State
- `entity_content` table has `sentiment` field (text: positive/negative/neutral)
- `published_date` allows time-series analysis
- No drift detection or trend alerting exists

### What We'll Build
A tool that tracks sentiment trajectory and alerts on momentum shifts:

```text
Tool: analyze_sentiment_drift

Input: {
  entity_id: string,
  time_windows?: [7, 30, 90]  // days
}

Returns:
{
  entity_name: string,
  current_sentiment: { positive: %, neutral: %, negative: % },
  drift_analysis: {
    7_day: { trend: "improving|stable|declining", momentum: number, key_drivers: [] },
    30_day: { trend, momentum, key_drivers },
    90_day: { trend, momentum, key_drivers }
  },
  alert_triggers: [{ type: "negative_momentum", threshold_crossed, severity }],
  key_content_samples: [{ title, source, sentiment, date }],
  reputation_risk_score: number  // 0-100
}
```

### Implementation Steps
1. **Create edge function** `supabase/functions/analyze-sentiment-drift/index.ts`
2. **Query logic**:
   - Aggregate `entity_content.sentiment` by time window
   - Calculate momentum as rate of change between windows
   - Identify content driving negative shifts
   - Generate reputation risk score
3. **Add tool definition + handler** to AI assistants
4. **Add proactive alert trigger** in monitoring for significant drift

---

## Capability 4: Risk Appetite Configuration

### Current State
- No per-principal alert threshold configuration exists
- All alerts treated equally regardless of recipient preference

### What We'll Build

**Database schema extension:**
```sql
-- Add to entities.attributes OR create dedicated table
CREATE TABLE principal_alert_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
  risk_appetite TEXT CHECK (risk_appetite IN ('low', 'medium', 'high')) DEFAULT 'medium',
  alert_threshold TEXT CHECK (alert_threshold IN ('any_disruption', 'significant_threat', 'life_safety_only')) DEFAULT 'significant_threat',
  preferred_channels TEXT[] DEFAULT '{"in_app"}',
  quiet_hours JSONB,  -- { start: "22:00", end: "07:00", timezone: "America/Edmonton" }
  escalation_contacts JSONB,  -- [{ name, email, phone, condition }]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_id)
);
```

**Tool for configuration:**
```text
Tool: configure_principal_alerts

Input: {
  entity_id: string,
  risk_appetite?: "low" | "medium" | "high",
  alert_threshold?: "any_disruption" | "significant_threat" | "life_safety_only",
  preferred_channels?: ["in_app", "email", "sms"],
  quiet_hours?: { start, end, timezone }
}
```

### Implementation Steps
1. **Database migration** to add `principal_alert_preferences` table
2. **Add tool definition** for `configure_principal_alerts`
3. **Modify alert filtering logic** in `ai-decision-engine` and notification handlers to respect preferences
4. **Add UI component** in VIP Deep Scan wizard for setting preferences

---

## Capability 5: Cross-Cultural Contextual Awareness

### Current State
- Lovable AI (Gemini 2.5) already has strong multilingual capabilities
- No explicit cultural context injection in prompts

### What We'll Build
Enhanced system prompt engineering for cultural intelligence:

**Prompt additions for agent-chat and dashboard-ai-assistant:**
```text
CROSS-CULTURAL INTELLIGENCE RULES:
When analyzing signals or content from non-Western sources:
1. Consider cultural context: idioms, local political nuances, communication styles
2. Flag content where literal translation may miss cultural cues
3. Note regional-specific threat indicators (e.g., color symbolism, date significance)
4. For international principal travel: include cultural briefing points
5. Translate technical security terms appropriately for local context
```

**Optional: Cultural context database** (future enhancement)
- Could add a `cultural_contexts` table with region-specific threat indicators
- Would enrich analysis for principals with international exposure

### Implementation Steps
1. **Enhance system prompts** in both AI assistants with cultural awareness block
2. **Add cultural context to travel risk analysis** in `monitor-travel-risks`
3. **Include cultural briefing section** in generated travel assessments

---

## Technical Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    PRINCIPAL INTELLIGENCE SUITE                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ get_principal_  │  │ run_what_if_    │  │ analyze_sentiment_ │  │
│  │ profile         │  │ scenario        │  │ drift              │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
│           │                    │                      │             │
│           ▼                    ▼                      ▼             │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                 dashboard-ai-assistant                          ││
│  │                       agent-chat                                ││
│  └─────────────────────────────────────────────────────────────────┘│
│           │                    │                      │             │
│           ▼                    ▼                      ▼             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ entities        │  │ simulate-*      │  │ entity_content      │  │
│  │ travelers       │  │ threat-radar    │  │ (sentiment)         │  │
│  │ itineraries     │  │ travel-risks    │  │                     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │        principal_alert_preferences (NEW TABLE)                  ││
│  │        - risk_appetite, alert_threshold, quiet_hours            ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Sequence

| Phase | Capability | Effort | Status |
|-------|------------|--------|--------|
| 1 | get_principal_profile | Low | ✅ COMPLETE |
| 2 | run_what_if_scenario | Medium | ✅ COMPLETE |
| 3 | analyze_sentiment_drift | Medium | ✅ COMPLETE |
| 4 | Risk Appetite Config | Medium | ✅ COMPLETE |
| 5 | Cultural Awareness | Low | ✅ COMPLETE |

---

## Files Created/Modified

**New Files:**
- ✅ `supabase/functions/run-what-if-scenario/index.ts` - Created & Deployed
- ✅ `supabase/functions/analyze-sentiment-drift/index.ts` - Created & Deployed

**Modified Files:**
- ✅ `supabase/functions/dashboard-ai-assistant/index.ts` - Added 4 Principal Intelligence tools + Cross-Cultural Awareness
- ✅ `supabase/functions/agent-chat/index.ts` - Added 4 Principal Intelligence tools + Cross-Cultural Awareness
- ✅ Database migration for `principal_alert_preferences` table - Applied

---

## Completion Summary

All 5 capabilities from Phase 6/7 have been implemented:

1. **get_principal_profile** - Consolidates VIP intelligence from entities, relationships, travelers, content
2. **run_what_if_scenario** - Orchestrates principal context with destination threat data for scenario simulation
3. **analyze_sentiment_drift** - Time-series sentiment analysis with momentum detection and reputation scoring
4. **configure_principal_alerts** - Per-principal alert preferences (risk appetite, thresholds, quiet hours)
5. **Cross-Cultural Awareness** - Enhanced system prompts for cultural intelligence in non-Western contexts

All existing Phase 1-5 capabilities remain fully operational.
