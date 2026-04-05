/**
 * Tier 6: Predictive Playbook Generator
 * 
 * Learns from past investigations and incidents to automatically generate
 * response playbooks. When a new threat emerges, it finds similar historical
 * cases and synthesizes what worked into actionable step-by-step playbooks.
 */

import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { threat_category, signal_id, incident_id, force_regenerate } = await req.json();
    const supabase = createServiceClient();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    const dateContext = getCriticalDateContext();
    console.log(`[PlaybookGen] Generating playbook for category: ${threat_category || 'auto-detect'}`);

    // Determine the threat category from signal or incident
    let category = threat_category;
    let contextSignal: any = null;

    if (signal_id) {
      const { data } = await supabase.from('signals')
        .select('id, category, severity, normalized_text, entity_tags, client_id')
        .eq('id', signal_id).single();
      contextSignal = data;
      category = category || data?.category;
    }

    if (incident_id && !category) {
      const { data } = await supabase.from('incidents')
        .select('id, signal_id, priority, status, signals(category, severity)')
        .eq('id', incident_id).single();
      category = (data as any)?.signals?.category;
    }

    if (!category) {
      return errorResponse('threat_category, signal_id, or incident_id required', 400);
    }

    // Check if a valid playbook already exists
    if (!force_regenerate) {
      const { data: existing } = await supabase.from('investigation_playbooks')
        .select('*')
        .eq('threat_category', category)
        .eq('is_active', true)
        .order('effectiveness_score', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing && existing.effectiveness_score > 0.5) {
        // Update usage count
        await supabase.from('investigation_playbooks').update({
          times_used: (existing.times_used || 0) + 1,
        }).eq('id', existing.id);

        return successResponse({
          playbook: existing,
          source: 'cached',
          message: `Existing playbook with ${Math.round((existing.effectiveness_score || 0) * 100)}% effectiveness score`,
        });
      }
    }

    // Fetch historical data for learning
    const [
      { data: pastIncidents },
      { data: pastInvestigations },
      { data: categorySignals },
      { data: debateRecords },
      { data: feedbackData },
    ] = await Promise.all([
      // Past incidents in this category
      supabase.from('incidents')
        .select('id, priority, status, severity_level, resolution_summary, lessons_learned, opened_at, resolved_at, signal_id')
        .order('opened_at', { ascending: false })
        .limit(50),
      // Past investigations
      supabase.from('investigations')
        .select('id, title, status, priority, findings, methodology, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
      // Signals in this category to understand patterns
      supabase.from('signals')
        .select('id, category, severity, normalized_text, entity_tags')
        .eq('category', category)
        .order('created_at', { ascending: false })
        .limit(100),
      // Agent debate records for this type
      supabase.from('agent_debate_records')
        .select('debate_type, individual_analyses, synthesis, consensus_score, final_assessment')
        .order('created_at', { ascending: false })
        .limit(10),
      // Feedback on past assessments
      supabase.from('feedback_events')
        .select('feedback_type, rating, comment, object_type')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    // Compute historical outcome metrics
    const resolvedIncidents = (pastIncidents || []).filter(i => i.status === 'resolved' || i.status === 'closed');
    const avgResolutionTime = resolvedIncidents.length > 0
      ? resolvedIncidents.reduce((sum, i) => {
          if (i.resolved_at && i.opened_at) {
            return sum + (new Date(i.resolved_at).getTime() - new Date(i.opened_at).getTime());
          }
          return sum;
        }, 0) / resolvedIncidents.length / 3600000 // hours
      : null;

    const lessonsLearned = (pastIncidents || [])
      .filter(i => i.lessons_learned)
      .map(i => i.lessons_learned)
      .slice(0, 10);

    const investigationFindings = (pastInvestigations || [])
      .filter(i => i.findings)
      .map(i => ({ title: i.title, findings: i.findings, methodology: i.methodology }))
      .slice(0, 5);

    // AI synthesis to generate playbook
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert security operations playbook architect. Generate investigation and response playbooks by learning from historical incident data, investigation outcomes, and organizational lessons learned. Your playbooks must be actionable, specific, and measurable.

Current date: ${dateContext.currentDateISO}

OUTPUT FORMAT (respond ONLY with valid JSON):
{
  "name": "Playbook name",
  "description": "One-paragraph description",
  "severity_assessment": "low|medium|high|critical",
  "steps": [
    {
      "order": 1,
      "phase": "detection|triage|investigation|containment|remediation|recovery",
      "title": "Step title",
      "description": "Detailed instructions",
      "estimated_minutes": 15,
      "required_tools": ["tool names"],
      "decision_points": ["If X, then Y"],
      "success_criteria": "What constitutes completion"
    }
  ],
  "countermeasures": [
    {
      "name": "Countermeasure name",
      "type": "preventive|detective|corrective",
      "priority": "immediate|short_term|long_term",
      "description": "Implementation details",
      "effectiveness_estimate": 0.8
    }
  ],
  "escalation_criteria": ["When to escalate"],
  "success_metrics": {
    "target_detection_time_minutes": 30,
    "target_containment_time_minutes": 120,
    "target_resolution_time_hours": 24
  },
  "historical_context": "What we learned from past incidents"
}`,
          },
          {
            role: 'user',
            content: `Generate a response playbook for: "${category}" threats.

HISTORICAL INCIDENT DATA (${resolvedIncidents.length} resolved incidents):
- Average resolution time: ${avgResolutionTime ? Math.round(avgResolutionTime) + ' hours' : 'Unknown'}
- Priority distribution: ${JSON.stringify((pastIncidents || []).reduce((acc: any, i) => { acc[i.priority || 'unknown'] = (acc[i.priority || 'unknown'] || 0) + 1; return acc; }, {}))}

LESSONS LEARNED FROM PAST INCIDENTS:
${lessonsLearned.map((l, i) => `${i + 1}. ${typeof l === 'string' ? l.substring(0, 200) : JSON.stringify(l).substring(0, 200)}`).join('\n')}

INVESTIGATION FINDINGS:
${investigationFindings.map(f => `- ${f.title}: ${typeof f.findings === 'string' ? f.findings.substring(0, 150) : JSON.stringify(f.findings).substring(0, 150)}`).join('\n')}

AGENT DEBATE INSIGHTS:
${(debateRecords || []).slice(0, 3).map(d => `- Consensus: ${d.consensus_score}, Assessment: ${typeof d.final_assessment === 'string' ? d.final_assessment.substring(0, 150) : ''}`).join('\n')}

SIGNAL PATTERNS (${(categorySignals || []).length} signals in category):
- Severity distribution: ${JSON.stringify((categorySignals || []).reduce((acc: any, s) => { acc[s.severity || 'unknown'] = (acc[s.severity || 'unknown'] || 0) + 1; return acc; }, {}))}
- Common entities: ${JSON.stringify(Object.entries((categorySignals || []).reduce((acc: any, s) => { for (const e of s.entity_tags || []) acc[e] = (acc[e] || 0) + 1; return acc; }, {})).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5))}

${contextSignal ? `CURRENT TRIGGER SIGNAL:\n${contextSignal.normalized_text?.substring(0, 300)}` : ''}

Generate a comprehensive, data-driven playbook.`,
          },
        ],
        max_tokens: 3000,
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || '';

    // Parse playbook JSON
    let playbook: any;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      playbook = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      playbook = { name: `${category} Response Playbook`, steps: [], raw: content };
    }

    if (!playbook) {
      throw new Error('Failed to generate playbook');
    }

    // Store playbook
    const { data: stored, error: storeError } = await supabase.from('investigation_playbooks').insert({
      name: playbook.name || `${category} Response Playbook`,
      description: playbook.description || '',
      threat_category: category,
      severity_level: playbook.severity_assessment || 'medium',
      source_type: 'ai_generated',
      steps: playbook.steps || [],
      countermeasures: playbook.countermeasures || [],
      success_metrics: playbook.success_metrics || {},
      model_version: 'gpt-5.2-v1',
    }).select().single();

    if (storeError) {
      console.error('[PlaybookGen] Storage error:', storeError);
    }

    // Log autonomous action
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'playbook_generated',
      trigger_source: signal_id ? 'signal' : incident_id ? 'incident' : 'manual',
      trigger_id: signal_id || incident_id || null,
      action_details: {
        category,
        playbook_id: stored?.id,
        steps_count: (playbook.steps || []).length,
        countermeasures_count: (playbook.countermeasures || []).length,
      },
      status: 'completed',
    });

    console.log(`[PlaybookGen] Generated playbook "${playbook.name}" with ${(playbook.steps || []).length} steps`);

    return successResponse({
      playbook: {
        ...playbook,
        id: stored?.id,
        historical_context: {
          incidents_analyzed: resolvedIncidents.length,
          avg_resolution_hours: avgResolutionTime ? Math.round(avgResolutionTime) : null,
          lessons_learned_count: lessonsLearned.length,
        },
      },
      source: 'generated',
    });
  } catch (error) {
    console.error('[PlaybookGen] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
