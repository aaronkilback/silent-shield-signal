import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Rule matching helpers (deterministic, no AI credits) ---
const escapeRegex = (input: string) => input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const priorityRank = (priority: string | null | undefined): number => {
  const p = (priority || '').toLowerCase();
  if (p === 'critical' || p === 'p1') return 4;
  if (p === 'high' || p === 'p2') return 3;
  if (p === 'medium' || p === 'p3') return 2;
  if (p === 'low' || p === 'p4') return 1;
  return 0;
};

const normalizePriorityToSeverity = (
  priority: string | null | undefined,
  fallback: string | null | undefined
): 'critical' | 'high' | 'medium' | 'low' => {
  const p = (priority || '').toLowerCase();
  if (p === 'critical') return 'critical';
  if (p === 'high') return 'high';
  if (p === 'medium') return 'medium';
  if (p === 'low') return 'low';
  if (p === 'p1') return 'critical';
  if (p === 'p2') return 'high';
  if (p === 'p3') return 'medium';
  if (p === 'p4') return 'low';

  const fb = (fallback || 'low').toLowerCase();
  if (fb === 'critical') return 'critical';
  if (fb === 'high') return 'high';
  if (fb === 'medium') return 'medium';
  return 'low';
};

const keywordMatches = (textLower: string, keyword: string): boolean => {
  const k = keyword.toLowerCase().trim();
  if (!k) return false;

  // If it's a phrase, keep it simple.
  if (k.includes(' ') || k.includes('-')) {
    return textLower.includes(k);
  }

  // Very small morphology support (e.g. "protest" -> "protesting", "blockade" -> "blocking")
  const stems: string[] = [k];
  if (k.endsWith('ade') && k.length > 5) {
    // "blockade" -> "block" (covers block/blocked/blocking/blockade)
    stems.push(k.slice(0, -3));
  }

  return stems.some((stem) => {
    const rx = new RegExp(`\\b${escapeRegex(stem)}(s|es|ed|ing|er|ers)?\\b`, 'i');
    return rx.test(textLower);
  });
};
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Health check endpoint for pipeline tests
    if (body.health_check || body.action === 'health_check') {
      return new Response(
        JSON.stringify({ 
          status: 'healthy', 
          function: 'ai-decision-engine',
          timestamp: new Date().toISOString() 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { signal_id, force_ai = false } = body;

    // Get signal details
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('*, clients(*)')
      .eq('id', signal_id)
      .single();

    if (signalError) throw signalError;

    // Fetch recent signals for the same client to enable pattern detection (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: recentSignals } = await supabase
      .from('signals')
      .select('id, normalized_text, category, severity, entity_tags, confidence, created_at')
      .eq('client_id', signal.client_id)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .neq('id', signal_id)
      .order('created_at', { ascending: false })
      .limit(20);

    console.log(`Found ${recentSignals?.length || 0} recent signals for pattern analysis`);

    // 1) ALWAYS load + apply approved rules first (rules must take precedence over AI inference)
    console.log('Loading approved signal categorization rules...');
    const { data: ruleConfigs } = await supabase
      .from('intelligence_config')
      .select('key, value')
      .like('key', 'signal_categorization_rules_proposal_%');

    const approvedRules: any[] = [];
    if (ruleConfigs && ruleConfigs.length > 0) {
      for (const config of ruleConfigs) {
        const configValue = config.value as any;
        if (configValue.status === 'approved' && configValue.proposals) {
          approvedRules.push(...configValue.proposals);
        }
      }
    }

    console.log(`Found ${approvedRules.length} approved rules`);

    const matchedRules: string[] = [];
    let ruleCategory: string | null = null;
    let rulePriority: string | null = null;
    const ruleTags: string[] = [];
    let routedToTeam: string | null = null;

    const signalTextLower = (signal.normalized_text || '').toLowerCase();

    for (const rule of approvedRules) {
      const conditions = rule.conditions || {};
      const actions = rule.actions || {};

      let matches = true;

      // Keywords are REQUIRED if present
      if (conditions.keywords && Array.isArray(conditions.keywords)) {
        const hasKeyword = conditions.keywords.some((kw: string) => keywordMatches(signalTextLower, kw));
        if (!hasKeyword) matches = false;
      }

      // Client industry (only enforce when client has an industry value)
      if (conditions.client_industry && signal.clients?.industry) {
        if (signal.clients.industry.toLowerCase() !== String(conditions.client_industry).toLowerCase()) {
          matches = false;
        }
      }

      // Source type (only enforce when we can resolve it)
      if (conditions.source_type && signal.source_id) {
        // TODO: add source lookup if/when we store source_type on the signal row.
      }

      if (matches) {
        console.log(`Rule matched: ${rule.rule_name}`);
        matchedRules.push(rule.rule_name);

        if (actions.add_tags && Array.isArray(actions.add_tags)) ruleTags.push(...actions.add_tags);
        if (actions.route_to_team) routedToTeam = actions.route_to_team;

        // Keep the strongest priority when multiple rules match
        if (actions.set_priority) {
          if (priorityRank(actions.set_priority) >= priorityRank(rulePriority)) {
            rulePriority = actions.set_priority;
          }
        }

        // First matching category wins (unless later rules explicitly override — keep simple & deterministic)
        if (!ruleCategory && actions.set_category) {
          ruleCategory = actions.set_category;
        }
      }
    }

    // Apply rule updates to the signal row (deterministic, should never be skipped)
    if (matchedRules.length > 0) {
      const nextSeverity = normalizePriorityToSeverity(rulePriority, signal.severity);
      const nextCategory = ruleCategory || signal.category;

      const updateResult = await supabase
        .from('signals')
        .update({
          applied_rules: matchedRules,
          rule_category: ruleCategory,
          rule_priority: rulePriority,
          rule_tags: Array.from(new Set(ruleTags)),
          routed_to_team: routedToTeam,
          category: nextCategory,
          severity: nextSeverity,
          status: 'triaged'
        })
        .eq('id', signal_id);

      if (updateResult.error) {
        console.error('Failed to update signal with rule data:', updateResult.error);
      } else {
        console.log(`✓ Signal ${signal_id} updated with rule: ${matchedRules.join(', ')}`);
        // Keep local values aligned for downstream AI prompt
        signal.category = nextCategory;
        signal.severity = nextSeverity;
      }
    }

    // 2) SMART FILTERING: Only use AI for high-priority signals
    // NOTE: rules can elevate severity, so compute shouldUseAI AFTER rule application.
    const shouldUseAI =
      force_ai ||
      signal.severity === 'critical' ||
      signal.severity === 'high' ||
      (signal.confidence && signal.confidence >= 0.8) ||
      priorityRank(rulePriority) >= 3; // treat high/p2+ as worthy of AI

    if (!shouldUseAI) {
      console.log(`Using rule-based logic for low-priority signal ${signal_id}`);

      const ruleBasedDecision = {
        threat_level: signal.severity || 'low',
        confidence: signal.confidence || 0.5,
        should_create_incident: signal.severity === 'high' || signal.severity === 'critical',
        incident_priority: signal.severity === 'high' ? 'p3' : 'p4',
        containment_actions: ['Monitor situation', 'Log for review'],
        remediation_steps: ['Continue monitoring', 'Review if pattern emerges'],
        alert_recipients: [],
        estimated_impact: 'Minimal - low severity signal',
        reasoning: 'Auto-classified as low priority based on severity and confidence scores'
      };

      await supabase
        .from('signals')
        .update({
          status: 'triaged',
          raw_json: {
            ...signal.raw_json,
            ai_decision: ruleBasedDecision,
            processing_method: 'rule-based'
          }
        })
        .eq('id', signal_id);

      return new Response(
        JSON.stringify({
          success: true,
          decision: ruleBasedDecision,
          processing_method: 'rule-based',
          credits_used: false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Using AI analysis for high-priority signal ${signal_id}`);
    
    console.log('Calling AI with signal:', {
      id: signal.id,
      category: signal.category,
      severity: signal.severity,
      client: signal.clients?.name
    });
    
    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a strategic threat intelligence analyst and autonomous SOC decision engine.

Your responsibilities:
1. Assess threat severity and strategic impact of the CURRENT signal
2. Identify ONLY direct, evidence-based connections to other signals
3. Provide strategic context and recommend containment actions
4. Determine escalation priority

CRITICAL ANTI-FABRICATION RULES:
- Analyze the CURRENT SIGNAL on its own merits FIRST before considering any other signals.
- Do NOT infer causal links between unrelated events just because they occurred near the same time or involve the same client.
- A copper theft is a copper theft — do NOT link it to activism, protests, or indigenous rights unless the signal text EXPLICITLY states such a connection.
- Correlation requires DIRECT EVIDENCE in the signal text (e.g., a claim of responsibility, named actors appearing in both events, explicit references). Temporal or geographic proximity alone is NOT evidence of correlation.
- If recent signals cover different topics (e.g., theft vs. environmental protest), state clearly that they are UNRELATED events.
- NEVER invent threat actors, motives, or campaign narratives not supported by the signal text.
- When in doubt, classify the signal as an ISOLATED incident rather than fabricating a pattern.

WHAT COUNTS AS A REAL CORRELATION:
- The same named threat actor appears in multiple signals
- One signal explicitly references another event
- A group claims responsibility for an action described in another signal
- The same specific TTP (not just broad category) is used across signals

WHAT IS NOT A CORRELATION:
- Two events happening in the same region or time period
- Events involving the same industry but different actors
- Thematic similarity (e.g., both involve "infrastructure") without specific shared actors or TTPs
- Activist protests existing in the same period as a criminal theft

Respond with structured JSON containing:
{
  "threat_level": "critical|high|medium|low",
  "confidence": 0.0-1.0,
  "should_create_incident": boolean,
  "incident_priority": "p1|p2|p3|p4",
  "containment_actions": ["action1", "action2"],
  "remediation_steps": ["step1", "step2"],
  "alert_recipients": ["email1@example.com"],
  "estimated_impact": string,
  "reasoning": string,
  "estimated_event_date": "ISO 8601 date string (YYYY-MM-DD) of when the described event ACTUALLY OCCURRED based on clues in the text. If the signal describes a past event (e.g., references a specific year, season, or past campaign), extract that date. If the event appears current/recent, use null.",
  "is_historical_content": boolean — true if the described event occurred more than 90 days ago,
  "strategic_context": "Broader threat landscape — only cite verified patterns",
  "threat_correlation": "ONLY list signals with direct evidence-based connections. State 'No direct correlations found' if none exist.",
  "campaign_assessment": "ONLY if direct evidence exists of coordination. Otherwise state 'No evidence of coordinated campaign'.",
  "sector_implications": "Industry-wide relevance based on the specific incident type"
}`
        },
        {
          role: 'user',
          content: `Analyze this security signal with strategic intelligence focus:

=== CURRENT SIGNAL ===
Signal: ${signal.normalized_text}
Category: ${signal.category}
Severity: ${signal.severity}
Location: ${signal.location}
Entity Tags: ${signal.entity_tags?.join(', ')}
Confidence: ${signal.confidence}
Raw Details: ${JSON.stringify(signal.raw_json)}

=== CLIENT CONTEXT ===
Name: ${signal.clients?.name}
Industry: ${signal.clients?.industry}
Locations: ${signal.clients?.locations?.join(', ')}
High-Value Assets: ${signal.clients?.high_value_assets?.join(', ')}
Risk Assessment: ${JSON.stringify(signal.clients?.risk_assessment)}
Threat Profile: ${JSON.stringify(signal.clients?.threat_profile)}

=== RECENT SIGNALS (Last 30 Days, for reference only) ===
${recentSignals && recentSignals.length > 0 ? 
  `${recentSignals.length} other signals exist for this client:
${recentSignals.map((s: any, i: number) => 
  `${i + 1}. [${s.severity?.toUpperCase()}] ${s.category}: ${s.normalized_text} (${s.entity_tags?.join(', ')})`
).join('\n')}

IMPORTANT: These signals are provided for REFERENCE ONLY. Do NOT assume they are related to the current signal unless you can cite SPECIFIC, DIRECT evidence (same named actor, explicit cross-reference, claim of responsibility). Most signals will be UNRELATED — that is normal and expected.
` : 'No recent signals for this client.'}

=== ANALYSIS TASK ===
1. Assess the CURRENT signal on its own merits — what happened, how severe, what actions are needed
2. ONLY IF direct evidence exists in the signal texts, note connections to other signals
3. Provide sector-wide context relevant to this specific incident type
4. Recommend containment and remediation actions

REMEMBER: Correlation requires explicit evidence. Do not fabricate links between unrelated events.`
        }
      ],
      functionName: 'ai-decision-engine',
      dlqOnFailure: true,
      dlqPayload: { signal_id },
      extraBody: {
        tools: [{
          type: 'function',
          function: {
            name: 'make_decision',
            description: 'Make autonomous security decision',
            parameters: {
              type: 'object',
              properties: {
                threat_level: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                confidence: { type: 'number' },
                should_create_incident: { type: 'boolean' },
                incident_priority: { type: 'string', enum: ['p1', 'p2', 'p3', 'p4'] },
                containment_actions: { type: 'array', items: { type: 'string' } },
                remediation_steps: { type: 'array', items: { type: 'string' } },
                alert_recipients: { type: 'array', items: { type: 'string' } },
                estimated_impact: { type: 'string' },
                reasoning: { type: 'string' },
                estimated_event_date: { type: 'string', description: 'ISO 8601 date (YYYY-MM-DD) of when the event actually occurred. Null if current/recent.' },
                is_historical_content: { type: 'boolean', description: 'True if the described event occurred more than 90 days ago' },
                strategic_context: { type: 'string' },
                threat_correlation: { type: 'string' },
                campaign_assessment: { type: 'string' },
                sector_implications: { type: 'string' }
              },
              required: ['threat_level', 'confidence', 'should_create_incident', 'reasoning', 'is_historical_content']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'make_decision' } }
      },
    });

    if (aiResult.error) {
      throw new Error(aiResult.error);
    }
    
    const aiData = aiResult.raw;
    console.log('AI response data:', JSON.stringify(aiData).slice(0, 500));
    
    if (!aiData?.choices?.[0]?.message?.tool_calls) {
      console.error('Invalid AI response structure. Full response:', JSON.stringify(aiData));
      throw new Error('Invalid AI response structure - no tool calls found');
    }
    
    const decision = JSON.parse(aiData.choices[0].message.tool_calls[0].function.arguments);

    console.log('AI Decision:', decision);

    // Execute autonomous actions based on AI decision
    let incident_id = null;

    if (decision.should_create_incident) {
      // Check if incident already exists for this signal
      const { data: existingIncident } = await supabase
        .from('incidents')
        .select('id')
        .eq('signal_id', signal.id)
        .maybeSingle();

      if (existingIncident) {
        console.log(`Incident already exists for signal ${signal.id}, skipping creation`);
        incident_id = existingIncident.id;
      } else {
        // Select initial AI agent for investigation based on signal characteristics
        const selectInitialAgent = (signalData: any, decisionData: any): { agentCallSign: string; agentId: string; prompt: string } => {
          const text = (signalData.normalized_text || '').toLowerCase();
          const category = (signalData.category || '').toLowerCase();
          const location = signalData.location || '';
          
          // Priority-based agent selection
          if (location && (text.includes('location') || text.includes('area') || text.includes('site'))) {
            return { 
              agentCallSign: 'LOCUS-INTEL', 
              agentId: '4fffd95a-c603-4f9d-857c-21de38e78747',
              prompt: `Conduct location-based threat analysis for this ${decisionData.threat_level} severity incident. Focus on geographic patterns, regional threats, and proximity to client assets.`
            };
          }
          if (category.includes('legal') || text.includes('lawsuit') || text.includes('regulation')) {
            return { 
              agentCallSign: 'LEX-MAGNA', 
              agentId: 'd0d43def-fec5-4ae5-a32c-34980097b1c1',
              prompt: `Analyze legal and regulatory implications for this incident. Identify applicable laws, potential liability, and compliance requirements.`
            };
          }
          if (category.includes('geopolitical') || text.includes('government') || text.includes('political')) {
            return { 
              agentCallSign: 'GLOBE-SAGE', 
              agentId: '664916cb-9395-47e1-b581-70dccad01f7c',
              prompt: `Provide geopolitical analysis for this incident. Assess strategic implications, potential state actor involvement, and sector-wide impacts.`
            };
          }
          // Default to pattern analysis
          return { 
            agentCallSign: 'BIRD-DOG', 
            agentId: 'b304c547-ab87-41a6-805c-e65330ee0f05',
            prompt: `Conduct pattern analysis for this ${decisionData.threat_level} severity incident. Identify behavioral indicators, anomalies, and potential coordinated activity.`
          };
        };

        const initialAgent = selectInitialAgent(signal, decision);
        console.log(`Selected initial agent: ${initialAgent.agentCallSign} for incident investigation`);

        // Map threat_level to valid severity_level (P1-P4)
        const mapThreatLevelToSeverity = (level: string): string => {
          const normalized = (level || '').toLowerCase();
          if (normalized === 'critical' || normalized === 'p1') return 'P1';
          if (normalized === 'high' || normalized === 'p2') return 'P2';
          if (normalized === 'medium' || normalized === 'p3') return 'P3';
          return 'P4'; // low or default
        };

        // Automatically create incident with AI Agent Task Force assignment
        const { data: incident, error: incidentError } = await supabase
          .from('incidents')
          .insert({
            signal_id: signal.id,
            client_id: signal.client_id,
            priority: decision.incident_priority || 'p3',
            status: 'open',
            is_test: signal.is_test || false,
            title: `${signal.category || 'Security'} Incident - ${signal.clients?.name || 'Unknown Client'}`,
            summary: decision.reasoning,
            severity_level: mapThreatLevelToSeverity(decision.threat_level),
            investigation_status: 'pending',
            assigned_agent_ids: [initialAgent.agentId],
            initial_agent_prompt: initialAgent.prompt,
            ai_analysis_log: [{
              timestamp: new Date().toISOString(),
              agent_id: null,
              agent_call_sign: 'AI Decision Engine',
              agent_specialty: 'Threat Assessment & Incident Creation',
              analysis: `## Initial Assessment\n\n**Threat Level:** ${decision.threat_level?.toUpperCase()}\n**Confidence:** ${Math.round((decision.confidence || 0) * 100)}%\n\n### Strategic Context\n${decision.strategic_context || 'N/A'}\n\n### Threat Correlation\n${decision.threat_correlation || 'N/A'}\n\n### Campaign Assessment\n${decision.campaign_assessment || 'N/A'}\n\n### Sector Implications\n${decision.sector_implications || 'N/A'}\n\n---\n\n**Next Step:** ${initialAgent.agentCallSign} assigned for specialized investigation.`,
              investigation_focus: ['initial assessment', 'threat classification', 'agent assignment']
            }],
            timeline_json: [{
              timestamp: new Date().toISOString(),
              event: 'Incident automatically created by AI Task Force',
              details: `${decision.reasoning}\n\n🎯 Strategic Context: ${decision.strategic_context}\n\n🔗 Threat Correlation: ${decision.threat_correlation}\n\n🤖 Initial Agent Assigned: ${initialAgent.agentCallSign}`,
              actor: 'AI Decision Engine'
            }]
          })
          .select()
          .single();

        if (incidentError) {
          console.error('Error creating incident:', incidentError);
          throw new Error(`Failed to create incident: ${incidentError.message}`);
        }
        
        if (incident) {
          incident_id = incident.id;
          console.log(`Incident created successfully: ${incident_id}`);
        
        // Update automation metrics - increment incidents_created
        const today = new Date().toISOString().split('T')[0];
        const { data: existingMetric } = await supabase
          .from('automation_metrics')
          .select('*')
          .eq('metric_date', today)
          .single();

        if (existingMetric) {
          await supabase
            .from('automation_metrics')
            .update({ 
              incidents_created: (existingMetric.incidents_created || 0) + 1 
            })
            .eq('id', existingMetric.id);
        } else {
          await supabase
            .from('automation_metrics')
            .insert({ 
              metric_date: today,
              incidents_created: 1,
              signals_processed: 0,
              incidents_auto_escalated: 0,
              osint_scans_completed: 0
            });
        }
        
          // Auto-assign based on priority
          if (decision.incident_priority === 'p1' || decision.incident_priority === 'p2') {
            // Update incident timeline with containment actions
            const { error: updateError } = await supabase
              .from('incidents')
              .update({
                timeline_json: [
                  ...incident.timeline_json,
                  {
                    timestamp: new Date().toISOString(),
                    event: 'Automated containment initiated',
                    details: decision.containment_actions?.join(', '),
                    actor: 'AI Decision Engine'
                  }
                ],
                acknowledged_at: new Date().toISOString()
              })
              .eq('id', incident.id);
          }
        }
      }
    }

    // Automatically send alerts
    if (decision.alert_recipients && decision.alert_recipients.length > 0) {
      for (const recipient of decision.alert_recipients) {
        await supabase.from('alerts').insert({
          incident_id: incident_id,
          recipient: recipient,
          channel: 'email',
          status: 'pending',
          response_json: {
            subject: `[${decision.threat_level.toUpperCase()}] ${signal.category} Alert - Strategic Intelligence`,
            body: `
🚨 THREAT ALERT: ${signal.category}
Threat Level: ${decision.threat_level.toUpperCase()}
Priority: ${decision.incident_priority?.toUpperCase()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 SIGNAL DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${signal.normalized_text}
Location: ${signal.location}
Confidence: ${(signal.confidence || 0) * 100}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STRATEGIC CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decision.strategic_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 THREAT CORRELATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decision.threat_correlation}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 CAMPAIGN ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decision.campaign_assessment}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏭 SECTOR IMPLICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decision.sector_implications}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ IMMEDIATE ACTIONS REQUIRED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decision.containment_actions?.map((a: string, i: number) => `${i + 1}. ${a}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 REMEDIATION STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decision.remediation_steps?.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 IMPACT ASSESSMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${decision.estimated_impact}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This strategic intelligence alert was generated and sent automatically by the AI Decision Engine using pattern analysis across ${recentSignals?.length || 0} recent signals.

Analyzed by: AI Decision Engine (3Si-style Strategic Intelligence)
Generated: ${new Date().toISOString()}
            `
          }
        });
      }
    }

    // Update signal status with enhanced decision data
    // Also set event_date if AI identified this as historical content
    const signalUpdate: Record<string, any> = { 
      status: 'triaged',
      raw_json: {
        ...signal.raw_json,
        ai_decision: decision,
        processing_method: 'ai',
        pattern_analysis: {
          recent_signals_analyzed: recentSignals?.length || 0,
          strategic_context: decision.strategic_context,
          threat_correlation: decision.threat_correlation,
          campaign_assessment: decision.campaign_assessment
        }
      }
    };

    // If AI extracted an event date and signal doesn't already have one, set it
    if (decision.estimated_event_date && !signal.event_date) {
      try {
        const parsed = new Date(decision.estimated_event_date);
        if (!isNaN(parsed.getTime())) {
          signalUpdate.event_date = parsed.toISOString();
          console.log(`[AI-Decision] Set event_date to ${signalUpdate.event_date} (historical: ${decision.is_historical_content})`);
        }
      } catch { /* ignore invalid dates */ }
    }

    const { error: updateError } = await supabase
      .from('signals')
      .update(signalUpdate)
      .eq('id', signal.id);
    
    if (updateError) {
      console.error('Error updating signal:', updateError);
      throw new Error(`Failed to update signal: ${updateError.message}`);
    }
    
    console.log(`Signal ${signal.id} updated successfully with AI decision`);

    return new Response(
      JSON.stringify({
        success: true,
        decision,
        incident_id,
        processing_method: 'ai',
        credits_used: true,
        pattern_analysis: {
          signals_analyzed: recentSignals?.length || 0,
          timeframe_days: 30,
          correlation_detected: decision.threat_correlation !== 'No significant correlation detected.',
          campaign_identified: decision.campaign_assessment?.includes('coordinated') || decision.campaign_assessment?.includes('campaign')
        },
        actions_taken: {
          incident_created: decision.should_create_incident,
          alerts_sent: decision.alert_recipients?.length || 0,
          containment_initiated: decision.containment_actions?.length > 0
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in AI decision engine:', error);
    
    // Return specific error for payment required
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('402') || errorMessage.includes('Not enough credits')) {
      return new Response(
        JSON.stringify({ 
          error: 'Lovable AI credits exhausted. Please add credits in Settings → Workspace → Usage to continue.' 
        }),
        { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
