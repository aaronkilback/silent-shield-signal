import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const lovableApiKey = Deno.env.get("OPENAI_API_KEY")!;
    
    if (!lovableApiKey) {
      throw new Error("GEMINI_API_KEY not configured");
    }
    
    const supabase = createServiceClient();

    const { incident_id, format = "executive" } = await req.json();

    console.log(`[generate-incident-briefing] Generating ${format} briefing for incident ${incident_id}`);

    // Fetch comprehensive incident data
    const { data: incident, error: incidentError } = await supabase
      .from("incidents")
      .select(`
        *,
        clients(name, industry, locations),
        signals(id, normalized_text, severity, category, created_at),
        incident_outcomes(outcome_type, false_positive, was_accurate, lessons_learned),
        improvements(description, shot_or_brick, status)
      `)
      .eq("id", incident_id)
      .single();

    if (incidentError || !incident) {
      throw new Error(`Incident not found: ${incident_id}`);
    }

    // Fetch linked entities
    const { data: incidentEntities, error: entitiesError } = await supabase
      .from("incident_entities")
      .select(`
        entities(id, name, type, risk_level, threat_score, description)
      `)
      .eq("incident_id", incident_id);

    if (entitiesError) {
      console.error("[generate-incident-briefing] Entities fetch error:", entitiesError);
    }

    // Fetch all linked signals (not just the primary)
    const { data: linkedSignals, error: signalsError } = await supabase
      .from("incident_signals")
      .select(`
        signals(id, normalized_text, severity, category, created_at, source, source_url, raw_json)
      `)
      .eq("incident_id", incident_id);

    if (signalsError) {
      console.error("[generate-incident-briefing] Signals fetch error:", signalsError);
    }

    // Fetch related alerts
    const { data: alerts, error: alertsError } = await supabase
      .from("alerts")
      .select("channel, recipient, status, sent_at")
      .eq("incident_id", incident_id);

    if (alertsError) {
      console.error("[generate-incident-briefing] Alerts fetch error:", alertsError);
    }

    // Perform impact analysis if not already done
    let impactAnalysis;
    try {
      const { data: impactData } = await supabase.functions.invoke("perform-impact-analysis", {
        body: { signal_id: incident.signal_id },
      });
      impactAnalysis = impactData;
    } catch (impactError) {
      console.error("[generate-incident-briefing] Impact analysis error:", impactError);
    }

    // Calculate SLA metrics
    const openedAt = new Date(incident.opened_at);
    const acknowledgedAt = incident.acknowledged_at ? new Date(incident.acknowledged_at) : null;
    const resolvedAt = incident.resolved_at ? new Date(incident.resolved_at) : null;
    const now = new Date();

    const timeToAcknowledge = acknowledgedAt 
      ? Math.round((acknowledgedAt.getTime() - openedAt.getTime()) / (1000 * 60))
      : null;
    const timeToResolve = resolvedAt 
      ? Math.round((resolvedAt.getTime() - openedAt.getTime()) / (1000 * 60 * 60))
      : null;
    const ageMinutes = Math.round((now.getTime() - openedAt.getTime()) / (1000 * 60));

    // Current date for context
    const currentDate = now.toISOString().split('T')[0];
    const incidentOpenedDate = openedAt.toISOString().split('T')[0];
    const ageDays = Math.round(ageMinutes / (60 * 24));
    const isStale = ageDays > 7;

    // Construct briefing prompt based on format - USING SILENT SHIELD EXECUTIVE FORMAT
    const briefingPrompt = format === "executive" 
      ? `Generate an EXECUTIVE BRIEFING using the Silent Shield 10-Section Format. 
Target audience: VP/Director and C-suite executives who need DECISIONS, not methodology.

CRITICAL DATE CONTEXT:
- Today's Date: ${currentDate}
- Incident Opened: ${incidentOpenedDate} (${ageDays > 0 ? `${ageDays} days ago` : 'today'})
${isStale ? `- ⚠️ STALE INCIDENT: This incident is ${ageDays} days old. Recommend closure review or escalation.` : ''}

INCIDENT DATA:
- ID: ${incident.id.substring(0, 8)}
- Title: ${incident.title || 'Untitled'}
- Priority: ${incident.priority} | Status: ${incident.status}
- Client: ${incident.clients?.name || 'Unknown'} (${incident.clients?.industry || 'Unknown'})
- Type: ${incident.incident_type || 'Not specified'}
- Severity: ${incident.severity_level || 'Not assessed'}
- Summary: ${incident.summary || 'No summary available'}

INTELLIGENCE (with source URLs):
${linkedSignals && linkedSignals.length > 0 ? linkedSignals.map((ls: any) => {
  const sig = ls.signals;
  const sourceUrl = sig.source_url || sig.raw_json?.url || sig.raw_json?.source_url || sig.raw_json?.link || null;
  return `- [${sig.severity}] ${sig.normalized_text.substring(0, 100)}...${sourceUrl ? `\n  Source: ${sourceUrl}` : ''}`;
}).join('\n') : 'No linked signals'}

ENTITIES:
${incidentEntities && incidentEntities.length > 0 ? incidentEntities.map((ie: any) => `- ${ie.entities.name} (${ie.entities.type}, Risk: ${ie.entities.risk_level || 'Unknown'})`).join('\n') : 'No entities identified'}

IMPACT:
${impactAnalysis ? `Risk Score: ${impactAnalysis.risk_score}/100 | Financial: $${impactAnalysis.impact_assessment?.financial_impact?.estimated_cost_range?.minimum}-${impactAnalysis.impact_assessment?.financial_impact?.estimated_cost_range?.maximum} | Downtime: ${impactAnalysis.impact_assessment?.operational_impact?.estimated_downtime_hours}h` : 'Impact analysis not available'}

RESPONSE:
- Time to Acknowledge: ${timeToAcknowledge ? `${timeToAcknowledge} min` : 'Not acknowledged'}
- Time to Resolve: ${timeToResolve ? `${timeToResolve} hours` : 'Not resolved'}
- Alerts Sent: ${alerts?.length || 0}

===== SILENT SHIELD EXECUTIVE BRIEFING FORMAT (MANDATORY) =====

WRITE EXACTLY 10 SECTIONS:

### 1. CORE SIGNAL (1-2 sentences)
What triggered this? Why does it matter to the business TODAY?

### 2. WHAT CHANGED
**Physical Environment:** [site activity, observable changes]
**Activist/Threat Landscape:** [social media, threat actor movements]  
**Regulatory/Legal:** [filings, policy changes]
(State "No material change" if nothing changed in a track)

### 3. THREAT CASCADE
[TRIGGER] → [OPERATIONAL IMPACT] → [BUSINESS CONSEQUENCE]
(One chain, highest impact only)

### 4. RISK ASSESSMENT
**Threat Momentum:** [Rising / Stable / Declining] — with ONE data point
**Signal Confidence:** [High / Medium / Low] — based on source quality
**Exposure Readiness:** [Prepared / Partial / Unprepared] — current mitigation posture

### 5. MOST LIKELY SCENARIO (48-72 hours)
Single most probable outcome with probability qualifier and decision point.

### 6. OPERATIONAL IMPACT (plain English, 4 bullets)
- Who is affected?
- What can't we do?
- How much does it cost?
- How long?

### 7. REQUIRED ACTION
**Immediate (0-24h):** [Specific action] at [location] by [role]
**Short-term (24-72h):** [Specific action] at [location] by [role]

### 8. EXECUTIVE DECISION OPTIONS
**Option A: [Name]** - Action / Cost / Risk
**Option B: [Name]** - Action / Cost / Risk
**Option C: [Name]** - Action / Cost / Risk
**Silent Shield Recommends: [Letter]** because [one sentence]

### 9. ESCALATION TRIGGERS
1. If [condition] → Escalate to [level] within [timeframe]
2. If [condition] → Escalate to [level] within [timeframe]
3. If [condition] → Escalate to [level] within [timeframe]

### 10. C-SUITE ONE-LINER
> "[Situation] creates [risk] that requires [action] by [timeline]."

===== BRIEFING RULES =====
- NO analyst jargon
- Short sentences
- No duplication
- If it doesn't change decisions, DELETE IT
- Write like a security commander, not a researcher`
      : `Generate an OPERATIONAL BRIEFING for this security incident. Target audience: Security analysts, incident responders, technical teams who need detailed tactical information.

INCIDENT OVERVIEW:
- Incident ID: ${incident.id}
- Title: ${incident.title || 'Untitled Incident'}
- Priority: ${incident.priority}
- Status: ${incident.status}
- Client: ${incident.clients?.name || 'Unknown'}
- Industry: ${incident.clients?.industry || 'Unknown'}
- Locations Affected: ${incident.clients?.locations?.join(', ') || 'Unknown'}
- Opened: ${incident.opened_at}
- Age: ${ageMinutes < 60 ? `${ageMinutes} minutes` : `${Math.round(ageMinutes / 60)} hours`}

INCIDENT CLASSIFICATION:
- Type: ${incident.incident_type || 'Not specified'}
- Severity: ${incident.severity_level || 'Not assessed'}
- Summary: ${incident.summary || 'No summary available'}

INTELLIGENCE SIGNALS (${linkedSignals?.length || 0} signals):
${linkedSignals && linkedSignals.length > 0 ? linkedSignals.map((ls: any) => `
- Signal ID: ${ls.signals.id.substring(0, 8)}
  Severity: ${ls.signals.severity}
  Category: ${ls.signals.category}
  Source: ${ls.signals.source || 'Unknown'}
  Content: ${ls.signals.normalized_text}
  Detected: ${ls.signals.created_at}
`).join('\n') : 'No linked signals'}

ENTITIES OF INTEREST (${incidentEntities?.length || 0} entities):
${incidentEntities && incidentEntities.length > 0 ? incidentEntities.map((ie: any) => `
- ${ie.entities.name}
  Type: ${ie.entities.type}
  Risk Level: ${ie.entities.risk_level || 'Unknown'}
  Threat Score: ${ie.entities.threat_score || 'N/A'}
  Description: ${ie.entities.description || 'None'}
`).join('\n') : 'No entities identified'}

THREAT ASSESSMENT:
${impactAnalysis ? `
- Risk Score: ${impactAnalysis.risk_score}/100
- Risk Level: ${impactAnalysis.risk_level}
- Attack Vector: ${impactAnalysis.attack_vector || 'Unknown'}
- Exploited Vulnerability: ${impactAnalysis.vulnerability_exploited || 'Unknown'}
- Cascading Effects: ${impactAnalysis.cascading_effects ? JSON.stringify(impactAnalysis.cascading_effects) : 'None identified'}
` : 'Impact analysis not available'}

RESPONSE METRICS:
- Time to Acknowledge: ${timeToAcknowledge ? `${timeToAcknowledge} minutes` : 'Not acknowledged'}
- Time to Contain: ${incident.contained_at ? Math.round((new Date(incident.contained_at).getTime() - openedAt.getTime()) / (1000 * 60 * 60)) + ' hours' : 'Not contained'}
- Time to Resolve: ${timeToResolve ? `${timeToResolve} hours` : 'Not resolved'}
- SLA Status: ${incident.sla_targets_json ? 'Tracked' : 'Not configured'}

OPERATIONAL BRIEFING FORMAT:
1. **INCIDENT SUMMARY** (3-4 sentences): Technical description of what occurred
2. **INDICATORS OF COMPROMISE (IOCs)**: List all technical indicators (IPs, domains, hashes, patterns)
3. **ATTACK CHAIN ANALYSIS**: Map out attack stages (initial access → privilege escalation → lateral movement → objective)
4. **AFFECTED SYSTEMS & DATA**: Specific systems, databases, or assets compromised
5. **CONTAINMENT ACTIONS**: Technical steps taken to contain (network isolation, credential rotation, etc.)
6. **INVESTIGATION STATUS**: What's known, what's unknown, ongoing analysis
7. **NEXT STEPS** (prioritized list): Immediate actions, 24h actions, 72h actions
8. **TECHNICAL RECOMMENDATIONS**: Security controls to implement, detection rules to add
9. **COORDINATION REQUIREMENTS**: Teams involved, external parties (law enforcement, vendors)

10. **VP/DIRECTOR MESSAGING** (MANDATORY - ready-to-use messaging for operational leaders):
    Format as a quotable block:
    > **FOR INTERNAL DISTRIBUTION — VP/DIRECTOR LEVEL**
    > 
    > [Situation summary in 1-2 sentences - operational focus]
    > 
    > **Operational Impact:** [Specific impacts to operations, timeline, affected sites/teams]
    > 
    > **Action Required:** [Specific next steps for this leadership tier]
    > 
    > **Escalation Trigger:** [Conditions that warrant CEO involvement]

11. **CEO MESSAGING** (MANDATORY - ready-to-use messaging for C-suite):
    Format as a quotable block:
    > **FOR C-SUITE — EXECUTIVE SUMMARY**
    > 
    > [Strategic situation in 1 sentence - business impact focus]
    > 
    > **Risk Exposure:** [Quantified risk — financial, reputational, regulatory in business terms]
    > 
    > **Recommendation:** [Single clear action or decision point]
    > 
    > **Timeline:** [When decision is needed]
    
    CEO Messaging Rules:
    - NO operational details (specific sites, contractors, timelines under 30 days)
    - NO technical security terminology
    - Frame in business terms: revenue impact, stakeholder relations, regulatory exposure
    - State the "so what" — why this matters at the board level

Include specific technical details, TTPs, and actionable steps. Use security terminology.`;

    // Call AI for briefing generation
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are an expert security analyst and communicator. Generate clear, actionable incident briefings tailored to the target audience. ${format === 'executive' ? 'Focus on business impact, decisions needed, and strategic implications.' : 'Focus on technical details, tactical actions, and operational coordination.'}`
          },
          {
            role: "user",
            content: briefingPrompt
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI API error: ${aiResponse.status} - ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const briefing = aiResult.choices[0].message.content;

    return successResponse({
      success: true,
      incident_id,
      format,
      briefing: {
        content: briefing,
        incident_summary: {
          title: incident.title,
          priority: incident.priority,
          status: incident.status,
          client: incident.clients?.name,
          age_minutes: ageMinutes,
        },
        metrics: {
          time_to_acknowledge_minutes: timeToAcknowledge,
          time_to_resolve_hours: timeToResolve,
          signals_count: linkedSignals?.length || 0,
          entities_count: incidentEntities?.length || 0,
          alerts_sent: alerts?.length || 0,
        },
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("[generate-incident-briefing] Error:", error);
    return errorResponse(error instanceof Error ? error.message : String(error), 500);
  }
});
