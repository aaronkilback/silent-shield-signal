import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { getLearningPromptBlock } from "../_shared/learning-context-builder.ts";
import { classifySignalIntoStoryline } from "../_shared/storyline-engine.ts";

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

    const { signal_id, force_ai = false, tier2_promotion = false, tier2_reasoning = '' } = body;

    // Get signal details
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('*, clients(*)')
      .eq('id', signal_id)
      .single();

    if (signalError) throw signalError;

    // Fetch source credibility score for this signal's source_key
    let sourceCredibility = 0.65; // default — neutral score before enough history
    if (signal.source_key) {
      const { data: credScore } = await supabase
        .from('source_credibility_scores')
        .select('current_credibility')
        .eq('source_key', signal.source_key)
        .maybeSingle();
      if (credScore?.current_credibility) {
        sourceCredibility = credScore.current_credibility;
      }
    }

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

      const ruleRelevanceScore = signal.relevance_score || 0.5;
      const ruleCompositeScore = Math.round(
        ((ruleBasedDecision.confidence * 0.50) + (ruleRelevanceScore * 0.35) + (sourceCredibility * 0.15)) * 1000
      ) / 1000;

      await supabase
        .from('signals')
        .update({
          status: 'triaged',
          composite_confidence: ruleCompositeScore,
          raw_json: {
            ...signal.raw_json,
            ai_decision: ruleBasedDecision,
            processing_method: 'rule-based'
          }
        })
        .eq('id', signal_id);

      console.log(`[AI-Decision] Rule-based composite: ${ruleCompositeScore} (confidence=${ruleBasedDecision.confidence}, relevance=${ruleRelevanceScore}, source=${sourceCredibility})`);

      return new Response(
        JSON.stringify({
          success: true,
          decision: ruleBasedDecision,
          composite_confidence: ruleCompositeScore,
          processing_method: 'rule-based',
          credits_used: false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Using AI analysis for high-priority signal ${signal_id}`);

    // Fetch adaptive learning context and contradiction data in parallel
    const [learningContext, contradictionData] = await Promise.all([
      getLearningPromptBlock(supabase, 'compact'),
      (async () => {
        const entityTags = signal.entity_tags || [];
        if (entityTags.length === 0) return '';
        const { data: contradictions } = await supabase
          .from('signal_contradictions')
          .select('entity_name, signal_a_summary, signal_b_summary, contradiction_type, ai_analysis')
          .in('entity_name', entityTags)
          .eq('resolution_status', 'unresolved')
          .order('detected_at', { ascending: false })
          .limit(5);
        if (!contradictions || contradictions.length === 0) return '';
        return `\n\n⚠️ KNOWN CONTRADICTIONS for entities in this signal:\n${contradictions.map(c => 
          `• ${c.entity_name}: "${c.signal_a_summary}" vs "${c.signal_b_summary}" (${c.contradiction_type})`
        ).join('\n')}\nFactor these conflicts into your confidence assessment.`;
      })(),
    ]);
    
    console.log('Calling AI with signal:', {
      id: signal.id,
      category: signal.category,
      severity: signal.severity,
      client: signal.clients?.name
    });
    
    const aiResult = await callAiGateway({
      model: 'openai/gpt-5.2',
      messages: [
        {
          role: 'system',
          content: `You are a strategic threat intelligence analyst and autonomous SOC decision engine.

${learningContext}${contradictionData}

Your responsibilities:
1. Assess threat severity and strategic impact of the CURRENT signal
2. Identify ONLY direct, evidence-based connections to other signals
3. Provide strategic context and recommend containment actions
4. Determine escalation priority

CRITICAL TEMPORAL AWARENESS RULES:
- BEFORE assessing severity, determine WHEN the described event actually occurred.
- If the signal describes events from months or years ago (e.g., references "2019", "2020", "last year", a past campaign, historical incidents), it is HISTORICAL CONTENT.
- Historical content (events >90 days old) must ALWAYS receive:
  - threat_level: "low" (regardless of how dramatic the event was)
  - should_create_incident: false (historical events do not warrant new incidents)
  - is_historical_content: true
  - confidence should reflect the age of the content (older = lower confidence)
- A signal about a major protest from 2020 is NOT a current threat. A signal about planned future action IS a current threat.
- Look for temporal clues: specific dates, years, "years ago", past tense descriptions of concluded events, archived news articles.

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
  "is_historical_content": boolean — true if the described event occurred more than 90 days ago. CRITICAL: If true, threat_level MUST be "low" and should_create_incident MUST be false.,
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

    console.log('AI Decision (raw):', decision);

    // ═══ HISTORICAL CONTENT GUARDRAIL ═══
    // Enforce severity downgrade for historical signals regardless of AI output
    if (decision.is_historical_content) {
      console.log(`[HISTORICAL GUARDRAIL] Signal ${signal_id} identified as historical content — enforcing downgrade`);
      decision.threat_level = 'low';
      decision.should_create_incident = false;
      decision.incident_priority = 'p4';
      decision.alert_recipients = [];
      if (!decision.reasoning.includes('[HISTORICAL]')) {
        decision.reasoning = `[HISTORICAL] ${decision.reasoning}`;
      }
    }

    // Also check event_date on the signal itself (belt-and-suspenders)
    const signalEventDate = signal.event_date ? new Date(signal.event_date) : null;
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    if (signalEventDate && signalEventDate < ninetyDaysAgo && !decision.is_historical_content) {
      console.log(`[HISTORICAL GUARDRAIL] Signal ${signal_id} has event_date ${signal.event_date} older than 90 days — forcing historical classification`);
      decision.is_historical_content = true;
      decision.threat_level = 'low';
      decision.should_create_incident = false;
      decision.incident_priority = 'p4';
      decision.alert_recipients = [];
      decision.reasoning = `[HISTORICAL] ${decision.reasoning}`;
    }

    console.log('AI Decision (post-guardrail):', decision);

    // ═══ PHASE 2: COMPOSITE CONFIDENCE GATE — runs FIRST and ALWAYS ═══
    // Three independent inputs (AI confidence, relevance, source) feed a single
    // score that gates incident creation AND review-signal-agent escalation.
    // Previously the composite write lived inside the should_create_incident
    // branch, so any signal the AI declined (the majority) silently kept
    // composite_confidence=null, which blocked review-signal-agent and left
    // raw_json.agent_review unset network-wide.
    const aiConfidence = decision.confidence || 0;
    const relevanceScore = signal.relevance_score || 0.5;
    const compositeScore = (aiConfidence * 0.50) + (relevanceScore * 0.35) + (sourceCredibility * 0.15);
    console.log(`[AI-Decision] Composite score: ${compositeScore.toFixed(3)} (ai=${aiConfidence.toFixed(2)}, relevance=${relevanceScore.toFixed(2)}, source=${sourceCredibility.toFixed(2)})`);

    // Write composite ONLY — do NOT touch raw_json here. The downstream
    // review-signal-agent merges agent_review into raw_json; if we wrote
    // raw_json from a stale in-memory snapshot we would clobber that merge
    // on every retrigger. The full ai_decision detail is captured in
    // signal_agent_analyses below; raw_json.ai_decision will continue to
    // be set only by the should_create_incident branch where it matters
    // for the incident audit trail.
    const compositeWriteResult = await supabase.from('signals').update({
      composite_confidence: Math.round(compositeScore * 1000) / 1000,
    }).eq('id', signal.id);
    if (compositeWriteResult.error) {
      console.warn('[AI-Decision] Failed to write composite_confidence:', compositeWriteResult.error);
    }

    // Tier-2 review (composite ≥ 0.60). Awaited — fire-and-forget races with the
    // Edge runtime teardown after this function returns, so the fetch dies and
    // raw_json.agent_review never lands. Awaiting adds ~3-5s to total latency
    // but is the only way to ensure the review actually runs in production.
    const isAmbiguousTier_pre = compositeScore >= 0.60 && compositeScore < 0.75;
    const isHighValueSignal_pre = compositeScore >= 0.75 && (signal.severity_score ?? 0) >= 50;
    if (isAmbiguousTier_pre || isHighValueSignal_pre) {
      const supabaseUrlPre = Deno.env.get('SUPABASE_URL');
      const serviceRoleKeyPre = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrlPre && serviceRoleKeyPre) {
        try {
          await fetch(`${supabaseUrlPre}/functions/v1/review-signal-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceRoleKeyPre}` },
            body: JSON.stringify({
              signal_id: signal.id,
              composite_score: compositeScore,
              ai_confidence: aiConfidence,
              relevance_score: relevanceScore,
              source_credibility: sourceCredibility,
            }),
            signal: AbortSignal.timeout(20000),
          });
        } catch (e: any) {
          console.warn('[AI-Decision] review-signal-agent call failed:', e?.message || e);
        }
      }
    }

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
          const tags = (signalData.entity_tags || []).join(' ').toLowerCase();
          const combined = `${text} ${category} ${tags}`;

          // ── Cyber / technical threats ──────────────────────────────────────
          if (category.includes('cyber') || category.includes('malware') || category.includes('ransomware') ||
              category.includes('phishing') || category.includes('intrusion') || category.includes('data_exfil') ||
              /\b(malware|ransomware|phishing|exploit|zero.?day|cve|vulnerability|breach|hacker|ddos|botnet)\b/.test(combined)) {
            return {
              agentCallSign: '0DAY',
              agentId: 'b233fa1a-455e-4d93-b9d6-274a8e0a9d16',
              prompt: `Conduct offensive security and cyber threat analysis for this ${decisionData.threat_level} incident. Identify TTPs, affected systems, CVEs, and recommend technical containment steps.`
            };
          }

          // ── Social media / SOCMINT ─────────────────────────────────────────
          if (category.includes('social') || category.includes('socmint') ||
              /\b(instagram|twitter|facebook|telegram|tiktok|reddit|hashtag|viral|post|repost|thread|influencer)\b/.test(combined)) {
            return {
              agentCallSign: 'ECHO-WATCH',
              agentId: 'eca2452b-7ea5-478e-ac34-fd103df7a754',
              prompt: `Perform social media intelligence (SOCMINT) analysis for this ${decisionData.threat_level} incident. Assess narrative spread, influencer amplification, engagement metrics, and coordination indicators.`
            };
          }

          // ── Financial crime / sanctions ────────────────────────────────────
          if (category.includes('financial') || category.includes('finint') || category.includes('sanctions') ||
              /\b(fraud|money.?laundering|sanctions|ofac|wire.?transfer|crypto|bitcoin|dark.?web|bribery|corruption)\b/.test(combined)) {
            return {
              agentCallSign: 'FININT',
              agentId: '7651f918-49d8-4f0a-9ff7-6a0ab401396b',
              prompt: `Conduct financial crime and sanctions intelligence analysis for this ${decisionData.threat_level} incident. Trace financial flows, identify sanctions exposure, and assess money laundering indicators.`
            };
          }

          // ── Narcotics / drug trade ─────────────────────────────────────────
          if (category.includes('narco') || category.includes('drug') ||
              /\b(fentanyl|narco|cartel|drug.?trafficking|methamphetamine|cocaine|opioid|smuggling)\b/.test(combined)) {
            return {
              agentCallSign: 'NARCO-INTEL',
              agentId: '471c17c4-75e7-4d52-989b-cd51d2e98ab0',
              prompt: `Conduct narcotics and organized crime intelligence analysis for this ${decisionData.threat_level} incident. Map trafficking networks, identify cartel connections, and assess regional drug trade implications.`
            };
          }

          // ── Counterterrorism / energy sector threats ───────────────────────
          if (category.includes('terrorism') || category.includes('counterterrorism') ||
              /\b(terrorism|extremist|radicali[sz]ation|jihad|isis|al.?qaeda|pipeline.+attack|sabotage.+infrastructure|lng.+attack)\b/.test(combined)) {
            return {
              agentCallSign: 'VERIDIAN-TANGO',
              agentId: 'e154cece-b070-40ce-ac38-cad235c71cac',
              prompt: `Conduct counterterrorism and energy infrastructure threat analysis for this ${decisionData.threat_level} incident. Assess extremist indicators, attack vectors, and critical infrastructure vulnerability.`
            };
          }

          // ── Supply chain risk ──────────────────────────────────────────────
          if (category.includes('supply_chain') || category.includes('vendor') ||
              /\b(supply.?chain|third.?party|vendor|contractor|logistics|procurement|counterfeit)\b/.test(combined)) {
            return {
              agentCallSign: 'CHAIN-WATCH',
              agentId: 'f9a7dc0c-2e97-467f-83dd-dac8c598480f',
              prompt: `Conduct supply chain risk intelligence analysis for this ${decisionData.threat_level} incident. Assess vendor exposure, counterfeit risks, and third-party vulnerability in the supply chain.`
            };
          }

          // ── Insider threat ─────────────────────────────────────────────────
          if (category.includes('insider') ||
              /\b(insider.?threat|disgruntled|employee.+(theft|leak|espionage)|data.+exfil.+employee|unauthorized.+access)\b/.test(combined)) {
            return {
              agentCallSign: 'INSIDE-EYE',
              agentId: 'de3f1f25-a8d1-421e-a882-746f869e3b6a',
              prompt: `Conduct insider threat analysis for this ${decisionData.threat_level} incident. Identify behavioral indicators, access anomalies, and potential data exfiltration pathways.`
            };
          }

          // ── Legal / regulatory ─────────────────────────────────────────────
          if (category.includes('legal') || category.includes('regulatory') || category.includes('compliance') ||
              /\b(lawsuit|litigation|regulation|compliance|fine|penalty|court|injunction|tribunal|investigation.+government)\b/.test(combined)) {
            return {
              agentCallSign: 'LEX-MAGNA',
              agentId: 'd0d43def-fec5-4ae5-a32c-34980097b1c1',
              prompt: `Analyze legal and regulatory implications for this ${decisionData.threat_level} incident. Identify applicable laws, potential liability, compliance requirements, and recommended legal actions.`
            };
          }

          // ── Geopolitical / state actor ─────────────────────────────────────
          if (category.includes('geopolitical') || category.includes('political') ||
              /\b(government|state.?actor|nation.?state|election|foreign.+interference|espionage|diplomatic|geopolit)\b/.test(combined)) {
            return {
              agentCallSign: 'GLOBE-SAGE',
              agentId: '664916cb-9395-47e1-b581-70dccad01f7c',
              prompt: `Provide geopolitical intelligence analysis for this ${decisionData.threat_level} incident. Assess strategic implications, state actor involvement, diplomatic context, and sector-wide geopolitical impacts.`
            };
          }

          // ── Physical security / theft / access ─────────────────────────────
          if (category.includes('physical') || category.includes('theft') || category.includes('trespass') ||
              /\b(copper.?theft|break.?and.?enter|vandalism|trespass|intrusion|access.?control|camera|surveillance.+physical|perimeter)\b/.test(combined)) {
            return {
              agentCallSign: 'SENTINEL-OPS',
              agentId: '93369424-b632-4bfd-84e0-8528ab5ead4e',
              prompt: `Conduct physical security analysis for this ${decisionData.threat_level} incident. Assess access control gaps, physical vulnerability indicators, and recommend hardening measures.`
            };
          }

          // ── Location-based / geographic ────────────────────────────────────
          if (signalData.location && signalData.location.length > 2) {
            return {
              agentCallSign: 'LOCUS-INTEL',
              agentId: '4fffd95a-c603-4f9d-857c-21de38e78747',
              prompt: `Conduct location-based threat analysis for this ${decisionData.threat_level} incident in ${signalData.location}. Map geographic patterns, regional threat actors, proximity to client assets, and terrain factors.`
            };
          }

          // ── P1/P2 high-stakes: route to BRAVO-1 (major case management) ───
          if (decisionData.incident_priority === 'p1' || decisionData.incident_priority === 'p2') {
            return {
              agentCallSign: 'BRAVO-1',
              agentId: '07dada1e-a4e0-4e80-8176-01633cedc2de',
              prompt: `Lead major case management for this ${decisionData.threat_level} priority incident. Coordinate the investigation response, assign specialist agents, and maintain incident command structure.`
            };
          }

          // ── Default: MATRIX (pattern detection & behavioral analysis) ──────
          return {
            agentCallSign: 'MATRIX',
            agentId: 'b304c547-ab87-41a6-805c-e65330ee0f05',
            prompt: `Conduct pattern detection and behavioral analysis for this ${decisionData.threat_level} incident. Identify behavioral indicators, anomalies, emerging patterns, and potential coordinated threat activity.`
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

        // ═══ PHASE 2: COMPOSITE CONFIDENCE GATE ═══
        // Three independent inputs must agree before an incident is created.
        // Weights are conservative — source credibility has low weight until
        // enough outcomes accumulate to make it meaningful.
        const aiConfidence = decision.confidence || 0;
        const relevanceScore = signal.relevance_score || 0.5; // from ingest-signal PECL gate
        const compositeScore = (aiConfidence * 0.50) + (relevanceScore * 0.35) + (sourceCredibility * 0.15);

        console.log(`[AI-Decision] Composite score: ${compositeScore.toFixed(3)} (ai=${aiConfidence.toFixed(2)}, relevance=${relevanceScore.toFixed(2)}, source=${sourceCredibility.toFixed(2)})`);

        // Phase 2B: Write composite score back to signal row for auditability.
        // Stored regardless of whether the gate passes or fails — every signal
        // gets a queryable score showing exactly why it did or didn't become an incident.
        // Awaited (used to be fire-and-forget) — when called from cron via
        // net.http_post the runtime tore down before the async update landed,
        // leaving composite_confidence null on most signals. That blocked the
        // downstream review-signal-agent trigger gate.
        const compositeWriteResult = await supabase.from('signals').update({
          composite_confidence: Math.round(compositeScore * 1000) / 1000
        }).eq('id', signal.id);
        if (compositeWriteResult.error) {
          console.warn('[AI-Decision] Failed to write composite_confidence:', compositeWriteResult.error);
        }

        // Phase 2B-bis: Write full reasoning row to signal_agent_analyses so analysts
        // can see exactly HOW the confidence score was constructed.
        // Awaited (was fire-and-forget via .then) so the audit trail row lands
        // before the runtime tears down.
        const analysesResult = await supabase.from('signal_agent_analyses').insert({
          signal_id: signal.id,
          agent_call_sign: 'AI-DECISION-ENGINE',
          analysis: (decision.reasoning || '').substring(0, 2000),
          confidence_score: Math.round(compositeScore * 1000) / 1000,
          trigger_reason: 'composite_confidence_gate',
          analysis_tier: 'tier1',
          confidence_breakdown: {
            ai_confidence: Math.round(aiConfidence * 1000) / 1000,
            ai_weight: 0.50,
            relevance_score: Math.round(relevanceScore * 1000) / 1000,
            relevance_weight: 0.35,
            source_credibility: Math.round(sourceCredibility * 1000) / 1000,
            source_weight: 0.15,
            composite: Math.round(compositeScore * 1000) / 1000,
          },
          pattern_matches: {
            matched_rules: matchedRules,
            threat_level: decision.threat_level,
            category: signal.category,
            entity_tags: signal.entity_tags || [],
            is_historical: decision.is_historical_content || false,
          },
          reasoning_log: [
            {
              step: 'rule_matching',
              rules_matched: matchedRules,
              tags_added: ruleTags,
              rule_category: ruleCategory,
            },
            {
              step: 'ai_assessment',
              threat_level: decision.threat_level,
              ai_confidence: Math.round(aiConfidence * 1000) / 1000,
              is_historical: decision.is_historical_content || false,
              strategic_context: (decision.strategic_context || '').substring(0, 300),
              threat_correlation: (decision.threat_correlation || '').substring(0, 300),
            },
            {
              step: 'composite_gate',
              composite: Math.round(compositeScore * 1000) / 1000,
              threshold: 0.65,
              passed: compositeScore >= 0.65 || tier2_promotion,
              breakdown: {
                ai: `${Math.round(aiConfidence * 100)}% × 50% = ${Math.round(aiConfidence * 50)}%`,
                relevance: `${Math.round(relevanceScore * 100)}% × 35% = ${Math.round(relevanceScore * 35)}%`,
                source: `${Math.round(sourceCredibility * 100)}% × 15% = ${Math.round(sourceCredibility * 15)}%`,
              },
            },
          ],
        });
        if (analysesResult.error) {
          console.warn('[AI-Decision] Failed to write signal_agent_analyses row:', analysesResult.error);
        }

        if (compositeScore < 0.65 && !tier2_promotion) {
          console.log(`[AI-Decision] Composite score ${compositeScore.toFixed(3)} below 0.65 — signal ${signal.id} monitored, no incident created.`);
          await supabase.from('incident_creation_failures').insert({
            source_function: 'ai-decision-engine',
            failure_reason: `Composite score ${compositeScore.toFixed(3)} below threshold 0.65`,
            signal_id: signal.id,
            client_id: signal.client_id,
            attempted_data: {
              ai_confidence: aiConfidence,
              relevance_score: relevanceScore,
              source_credibility: sourceCredibility,
              composite_score: compositeScore,
              threat_level: decision.threat_level,
              incident_priority: decision.incident_priority,
              reasoning: (decision.reasoning || '').substring(0, 200),
            }
          }).then(
            () => {},
            (e: any) => console.warn('[AI-Decision] Failed to log creation failure:', e)
          );
          incident_id = null;
        } else {

        // Automatically create incident with AI Agent Task Force assignment
        const { data: incident, error: incidentError } = await supabase
          .from('incidents')
          .insert({
            signal_id: signal.id,
            client_id: signal.client_id,
            priority: decision.incident_priority || 'p3',
            status: 'open',
            is_test: signal.is_test || false,
            title: (() => {
              const cat = signal.category || '';
              const categoryMap: Record<string, string> = {
                malware: 'Malware Detection', phishing: 'Phishing Campaign', intrusion: 'Network Intrusion',
                data_exfil: 'Data Exfiltration', ddos: 'DDoS Attack', ransomware: 'Ransomware Activity',
                social_engineering: 'Social Engineering', insider_threat: 'Insider Threat',
                physical: 'Physical Security Threat', fraud: 'Fraud Activity', extremism: 'Extremist Activity',
                protest: 'Protest Activity', cyber: 'Cyber Threat', sabotage: 'Sabotage Threat', espionage: 'Espionage Activity',
              };
              const catLabel = categoryMap[cat] || (cat ? cat.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Security Incident');
              const sev = (decision.threat_level || signal.severity || '').toLowerCase();
              const sevPrefix = sev === 'critical' ? 'Critical ' : sev === 'high' ? 'High-Severity ' : '';
              const entities: string[] = signal.entity_tags || [];
              const meaningful = entities.filter((e: string) => e.length > 2 && !/^\d+$/.test(e));
              const target = meaningful.length > 0 ? meaningful.slice(0, 2).join(', ') : (signal.location || '');
              if (target) return `${sevPrefix}${catLabel} — ${target}`.substring(0, 100);
              const raw = (signal.normalized_text || '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
              const short = raw.split(/[.!?]/)[0].trim().substring(0, 60);
              if (short.length > 10) return `${sevPrefix}${catLabel}: ${short}`.substring(0, 100);
              return `${sevPrefix}${catLabel} Detected`.substring(0, 100);
            })(),
            summary: tier2_promotion && tier2_reasoning
              ? `${decision.reasoning}\n\n[Tier 2 Agent Promotion] ${tier2_reasoning}`
              : decision.reasoning,
            severity_level: mapThreatLevelToSeverity(decision.threat_level),
            investigation_status: 'pending',
            assigned_agent_ids: [initialAgent.agentId],
            initial_agent_prompt: initialAgent.prompt,
            provenance_type: 'signal',
            provenance_id: signal.id,
            provenance_summary: `Signal [${signal.category || 'unknown'}]: ${(signal.normalized_text || '').substring(0, 200)}`,
            created_by_function: 'ai-decision-engine',
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

          // Close the predictive feedback loop: mark any prior prediction for this signal as verified
          await supabase
            .from('predictive_incident_scores')
            .update({ outcome_verified: true, actual_escalated: true })
            .eq('signal_id', signal.id)
            .eq('outcome_verified', false);
        
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
        } // end confidence threshold else

        // ═══ PHASE 2C: TIER 2 ASYNC AGENT REVIEW ═══
        // Fires review-signal-agent for two cases:
        // 1. Ambiguous tier (0.60–0.75): no incident yet or incident just created — agent promotes/enriches/flags
        // 2. High-value signals (≥0.75, severity_score ≥50): most important signals get enrichment context, not just the ambiguous ones
        // Never blocks — fire-and-forget fetch.
        const isAmbiguousTier = compositeScore >= 0.60 && compositeScore < 0.75;
        const isHighValueSignal = compositeScore >= 0.75 && (signal.severity_score ?? 0) >= 50;
        if (!tier2_promotion && (isAmbiguousTier || isHighValueSignal)) {
          const supabaseUrlT2 = Deno.env.get('SUPABASE_URL');
          const serviceRoleKeyT2 = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          if (supabaseUrlT2 && serviceRoleKeyT2) {
            fetch(`${supabaseUrlT2}/functions/v1/review-signal-agent`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKeyT2}`,
              },
              body: JSON.stringify({
                signal_id: signal.id,
                composite_score: compositeScore,
                ai_confidence: aiConfidence,
                relevance_score: relevanceScore,
                source_credibility: sourceCredibility,
                incident_id: incident_id,
              }),
            }).catch((e: any) => console.warn('[AI-Decision] Tier 2 review fire-and-forget failed:', e));
            console.log(`[AI-Decision] Agent review queued for signal ${signal.id} (composite=${compositeScore.toFixed(3)}, severity=${signal.severity_score ?? 0}, reason=${isHighValueSignal ? 'high_value' : 'ambiguous_tier'})`);
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

    // ═══ AUTO-TRIAGE HISTORICAL SIGNALS ═══
    // Automatically move historical signals to the "historical" tab and downgrade severity
    if (decision.is_historical_content) {
      signalUpdate.triage_override = 'historical';
      signalUpdate.severity = 'low';
      console.log(`[AI-Decision] Auto-triaged signal ${signal.id} to historical tab with low severity`);
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

    // ═══ CROSS-MODEL CONSENSUS VALIDATION (P1/P2 only) ═══
    // For critical signals, run a second model to validate the primary assessment.
    // Disagreements are flagged for analyst review.
    let consensusResult = null;
    if (
      (decision.incident_priority === 'p1' || decision.incident_priority === 'p2') &&
      !decision.is_historical_content
    ) {
      try {
        console.log(`[AI-Decision] Running cross-model consensus for P1/P2 signal ${signal.id}`);
        const consensusResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/multi-model-consensus`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              signal_id: signal.id,
              signal_text: signal.normalized_text,
              signal_category: signal.category,
              signal_severity: decision.threat_level,
              context: {
                client_name: signal.clients?.name,
                ai_decision_priority: decision.incident_priority,
                ai_decision_confidence: decision.confidence,
              },
            }),
          }
        );
        if (consensusResponse.ok) {
          consensusResult = await consensusResponse.json();
          console.log(`[AI-Decision] Consensus: ${consensusResult.final_assessment} (score: ${consensusResult.consensus_score}, disagreement: ${consensusResult.disagreement})`);
          
          // If consensus disagrees with primary assessment, flag it on the signal
          if (consensusResult.disagreement) {
            await supabase
              .from('signals')
              .update({
                raw_json: {
                  ...signal.raw_json,
                  ai_decision: decision,
                  consensus_validation: {
                    disagreement: true,
                    consensus_score: consensusResult.consensus_score,
                    final_assessment: consensusResult.final_assessment,
                    requires_analyst_review: true,
                  },
                  processing_method: 'ai+consensus',
                },
              })
              .eq('id', signal.id);
          }
        }
      } catch (consensusErr) {
        console.warn('[AI-Decision] Non-fatal consensus validation error:', consensusErr);
      }
    }

    // ═══ STORYLINE CLUSTERING ═══
    // Classify signal into an existing narrative thread or create a new one
    let storylineResult = null;
    try {
      storylineResult = await classifySignalIntoStoryline(supabase, {
        id: signal.id,
        normalized_text: signal.normalized_text || '',
        category: signal.category,
        entity_tags: signal.entity_tags,
        location: signal.location,
        client_id: signal.client_id,
      });
      console.log(`[AI-Decision] Storyline: ${storylineResult.action} → ${storylineResult.storylineTitle || 'N/A'} (similarity: ${storylineResult.similarity})`);
    } catch (slErr) {
      console.warn('[AI-Decision] Non-fatal storyline classification error:', slErr);
    }

    // Mark predictions that did NOT escalate as verified (actual_escalated: false)
    if (!decision.should_create_incident) {
      await supabase
        .from('predictive_incident_scores')
        .update({ outcome_verified: true, actual_escalated: false })
        .eq('signal_id', signal.id)
        .eq('outcome_verified', false);
    }

    return new Response(
      JSON.stringify({
        success: true,
        decision,
        incident_id,
        processing_method: consensusResult ? 'ai+consensus' : 'ai',
        credits_used: true,
        storyline: storylineResult ? {
          action: storylineResult.action,
          storyline_id: storylineResult.storylineId,
          storyline_title: storylineResult.storylineTitle,
          similarity: storylineResult.similarity,
          is_new_development: storylineResult.isNewDevelopment,
        } : null,
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
        },
        consensus_validation: consensusResult ? {
          consensus_score: consensusResult.consensus_score,
          disagreement: consensusResult.disagreement,
          final_assessment: consensusResult.final_assessment,
          enforcement: consensusResult.enforcement || 'tool_calling_v2',
        } : null,
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
