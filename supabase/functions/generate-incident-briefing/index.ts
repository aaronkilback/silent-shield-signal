import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
        signals(id, normalized_text, severity, category, created_at, source)
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

    // Construct briefing prompt based on format
    const briefingPrompt = format === "executive" 
      ? `Generate an EXECUTIVE BRIEFING for this security incident. Target audience: C-level executives and senior management who need high-level understanding and business impact focus.

INCIDENT OVERVIEW:
- Incident ID: ${incident.id.substring(0, 8)}
- Title: ${incident.title || 'Untitled Incident'}
- Priority: ${incident.priority}
- Status: ${incident.status}
- Client: ${incident.clients?.name || 'Unknown'}
- Industry: ${incident.clients?.industry || 'Unknown'}
- Opened: ${incident.opened_at}
- Age: ${ageMinutes < 60 ? `${ageMinutes} minutes` : `${Math.round(ageMinutes / 60)} hours`}

INCIDENT DETAILS:
- Type: ${incident.incident_type || 'Not specified'}
- Severity: ${incident.severity_level || 'Not assessed'}
- Summary: ${incident.summary || 'No summary available'}

SIGNALS & INTELLIGENCE:
${linkedSignals && linkedSignals.length > 0 ? linkedSignals.map((ls: any) => `- [${ls.signals.severity}] ${ls.signals.normalized_text.substring(0, 150)}...`).join('\n') : 'No linked signals'}

INVOLVED ENTITIES:
${incidentEntities && incidentEntities.length > 0 ? incidentEntities.map((ie: any) => `- ${ie.entities.name} (${ie.entities.type}, Risk: ${ie.entities.risk_level || 'Unknown'})`).join('\n') : 'No entities identified'}

IMPACT ASSESSMENT:
${impactAnalysis ? `
- Risk Score: ${impactAnalysis.risk_score}/100 (${impactAnalysis.risk_level})
- Financial Impact: $${impactAnalysis.impact_assessment?.financial_impact?.estimated_cost_range?.minimum}-${impactAnalysis.impact_assessment?.financial_impact?.estimated_cost_range?.maximum}
- Operational Impact: ${impactAnalysis.impact_assessment?.operational_impact?.estimated_downtime_hours}h downtime estimated
- People at Risk: ${impactAnalysis.impact_assessment?.people_impact?.employees_at_risk || 'Unknown'}
` : 'Impact analysis not available'}

RESPONSE STATUS:
- Time to Acknowledge: ${timeToAcknowledge ? `${timeToAcknowledge} minutes` : 'Not acknowledged'}
- Time to Resolve: ${timeToResolve ? `${timeToResolve} hours` : 'Not resolved'}
- Alerts Sent: ${alerts?.length || 0} (${alerts?.filter((a: any) => a.status === 'delivered').length || 0} delivered)

OUTCOME & LESSONS:
${incident.incident_outcomes && incident.incident_outcomes.length > 0 ? `
- Outcome: ${incident.incident_outcomes[0].outcome_type}
- Accurate Assessment: ${incident.incident_outcomes[0].was_accurate ? 'Yes' : 'No'}
- Lessons Learned: ${incident.incident_outcomes[0].lessons_learned || 'None documented'}
` : 'No outcome recorded'}

EXECUTIVE BRIEFING FORMAT:
1. **SITUATION** (2-3 sentences): What happened? Current status?
2. **BUSINESS IMPACT** (3-4 sentences): Financial, operational, reputational implications. Use specific numbers.
3. **ROOT CAUSE** (2 sentences): Why did this happen? What vulnerability was exploited?
4. **RESPONSE ACTIONS** (3-4 bullet points): What has been done? What's in progress?
5. **CURRENT STATUS** (2 sentences): Where are we now? Is it contained?
6. **RECOMMENDATIONS** (2-3 bullet points): What decisions are needed? Resource allocation? Policy changes?
7. **TIMELINE** (3-5 bullet points): Key milestones from detection to current state

Keep language clear, non-technical, business-focused. Use active voice. Highlight risks and decisions needed.`
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

Include specific technical details, TTPs, and actionable steps. Use security terminology.`;

    // Call AI for briefing generation
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${lovableApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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

    return new Response(
      JSON.stringify({
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[generate-incident-briefing] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
