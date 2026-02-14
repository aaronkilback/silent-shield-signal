import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Agent Self-Learning Engine
 * 
 * Enables every agent in the Fortress network to autonomously research
 * topics they encounter, learn from the world's experts, and grow
 * their knowledge base. This is the "PhD upgrade" — agents don't just
 * process data, they actively seek expertise.
 * 
 * Modes:
 * 1. "reactive" — Agent encounters an unknown topic during investigation,
 *    researches it immediately and stores findings.
 * 2. "proactive" — Scheduled sweep: agents review recent incidents/signals
 *    and identify knowledge gaps to fill.
 * 3. "deep_dive" — Agent performs exhaustive multi-query research on a
 *    specific domain (e.g., new ransomware variant, emerging protest tactic).
 */

interface LearningRequest {
  mode: 'reactive' | 'proactive' | 'deep_dive';
  agent_call_sign?: string;
  topic?: string;
  context?: string;
  incident_id?: string;
  max_queries?: number;
}

const AGENT_LEARNING_PROMPTS: Record<string, string> = {
  'AEGIS-CMD': 'You are a senior security operations commander. Research this topic for strategic decision-making and threat response coordination.',
  'NEO': 'You are a pattern detection specialist. Research this topic to identify hidden connections, emerging trends, and predictive indicators.',
  'CERBERUS': 'You are a financial crime investigator. Research this topic for AML/CFT patterns, sanctions evasion techniques, and financial threat indicators.',
  'OUROBOROS': 'You are a supply chain security analyst. Research this topic for vendor risks, logistics vulnerabilities, and supply chain attack vectors.',
  'SPECTER': 'You are an insider threat behavioral analyst. Research this topic for behavioral indicators, deception patterns, and psychological markers.',
  'MERIDIAN': 'You are a geopolitical intelligence analyst. Research this topic for regional stability indicators, political risk factors, and cross-border threat dynamics.',
  'VIPER': 'You are a narcotics intelligence analyst. Research this topic for drug trafficking patterns, cartel operations, and interdiction strategies.',
  'ARGUS': 'You are a physical security and surveillance specialist. Research this topic for access control, CCTV analytics, and perimeter defense.',
  'WARDEN': 'You are a content moderation and digital safety expert. Research this topic for online threat patterns, radicalization indicators, and platform exploitation.',
  'PRAETOR': 'You are a major case management specialist. Research this topic for investigative methodologies, evidence handling, and case coordination.',
  'CRUCIBLE': 'You are a data quality and intelligence gap analyst. Research this topic to identify coverage blind spots and monitoring improvements.',
};

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({})) as LearningRequest;
    const { mode = 'proactive', agent_call_sign, topic, context, incident_id, max_queries } = body;

    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    if (!PERPLEXITY_API_KEY) {
      return errorResponse('PERPLEXITY_API_KEY not configured', 500);
    }

    const supabase = createServiceClient();
    const queryLimit = max_queries || (mode === 'deep_dive' ? 5 : 3);
    const results: { topics_researched: string[]; entries_created: number; entries_updated: number } = {
      topics_researched: [],
      entries_created: 0,
      entries_updated: 0,
    };

    if (mode === 'reactive' && topic) {
      // ── Reactive: Agent encountered something unknown ──
      await researchTopic(supabase, PERPLEXITY_API_KEY, {
        topic,
        context: context || '',
        agentCallSign: agent_call_sign || 'AEGIS-CMD',
        incidentId: incident_id,
      }, results);

    } else if (mode === 'deep_dive' && topic) {
      // ── Deep Dive: Exhaustive multi-angle research ──
      const angles = generateDeepDiveQueries(topic, agent_call_sign || 'AEGIS-CMD');
      for (const query of angles.slice(0, queryLimit)) {
        await new Promise(r => setTimeout(r, 1500));
        await researchTopic(supabase, PERPLEXITY_API_KEY, {
          topic: query,
          context: `Deep dive research on: ${topic}`,
          agentCallSign: agent_call_sign || 'AEGIS-CMD',
          incidentId: incident_id,
        }, results);
      }

    } else {
      // ── Proactive: Identify knowledge gaps from recent activity ──
      const gaps = await identifyKnowledgeGaps(supabase);
      console.log(`[agent-self-learning] Identified ${gaps.length} knowledge gaps`);

      for (const gap of gaps.slice(0, queryLimit)) {
        await new Promise(r => setTimeout(r, 1500));
        await researchTopic(supabase, PERPLEXITY_API_KEY, {
          topic: gap.query,
          context: gap.context,
          agentCallSign: gap.suggestedAgent || 'AEGIS-CMD',
        }, results);
      }
    }

    // Record learning session
    await supabase.from('agent_learning_sessions').insert({
      agent_id: null,
      session_type: mode,
      learnings: results,
      source_count: results.topics_researched.length,
      quality_score: results.entries_created > 0 ? 0.85 : 0.5,
      promoted_to_global: results.entries_created > 2,
    });

    console.log(`[agent-self-learning] Complete: ${results.entries_created} new, ${results.entries_updated} updated`);

    return successResponse({
      message: `Agent learning complete (${mode})`,
      ...results,
    });
  } catch (error) {
    console.error('[agent-self-learning] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function researchTopic(
  supabase: any,
  apiKey: string,
  params: { topic: string; context: string; agentCallSign: string; incidentId?: string },
  results: { topics_researched: string[]; entries_created: number; entries_updated: number }
) {
  const { topic, context, agentCallSign, incidentId } = params;
  const agentPersona = AGENT_LEARNING_PROMPTS[agentCallSign] || AGENT_LEARNING_PROMPTS['AEGIS-CMD'];

  const systemPrompt = `${agentPersona}

Return your findings as a JSON array of 2-4 knowledge entries. Each entry:
- "title": concise title (max 100 chars)
- "content": detailed actionable knowledge (200-500 words). Include specific methodologies, frameworks, metrics, and procedures. Write like a classified intelligence handbook.
- "domain": one of "cyber", "physical_security", "executive_protection", "crisis_management", "threat_intelligence", "travel_security", "compliance", "geopolitical", "investigations", "osint"
- "subdomain": specific sub-area
- "knowledge_type": one of "best_practice", "framework", "methodology", "case_study", "threat_pattern", "standard", "emerging_trend", "tactical_procedure"
- "tags": array of 3-6 applicability tags
- "citation": source reference

Return ONLY the JSON array.`;

  const userPrompt = context 
    ? `Research this topic in the context of: ${context}\n\nTopic: ${topic}`
    : `Research this topic thoroughly: ${topic}`;

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        search_recency_filter: 'month',
      }),
    });

    if (!response.ok) {
      console.error(`[agent-self-learning] Perplexity error ${response.status}`);
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations = data.citations || [];

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const entries = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(entries)) return;

    results.topics_researched.push(topic);

    for (const entry of entries.slice(0, 4)) {
      if (!entry.title || !entry.content) continue;

      // Dedup: check for existing by normalized title
      const normTitle = entry.title.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      const searchKey = normTitle.substring(0, 40);

      const { data: existing } = await supabase
        .from('expert_knowledge')
        .select('id, content')
        .eq('domain', entry.domain || 'threat_intelligence')
        .ilike('title', `%${searchKey}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        // Update if new content is substantially different (> 30% new words)
        const oldWords = new Set(existing[0].content.toLowerCase().split(/\s+/));
        const newWords = entry.content.toLowerCase().split(/\s+/);
        const novelWords = newWords.filter((w: string) => !oldWords.has(w));
        
        if (novelWords.length / newWords.length > 0.3) {
          await supabase
            .from('expert_knowledge')
            .update({
              content: entry.content,
              last_validated_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing[0].id);
          results.entries_updated++;
        }
      } else {
        await supabase
          .from('expert_knowledge')
          .insert({
            domain: entry.domain || 'threat_intelligence',
            subdomain: entry.subdomain || 'general',
            knowledge_type: entry.knowledge_type || 'emerging_trend',
            title: entry.title,
            content: entry.content,
            applicability_tags: entry.tags || [],
            citation: entry.citation || citations.join(', '),
            confidence_score: 0.85,
          });
        results.entries_created++;
      }
    }

    // Store in agent memory for the specific agent
    if (entries.length > 0) {
      const memoryContent = entries.map((e: any) => `[${e.knowledge_type}] ${e.title}: ${e.content?.substring(0, 200)}`).join('\n\n');
      await supabase.from('agent_investigation_memory').insert({
        agent_call_sign: agentCallSign,
        content: `Self-learning on "${topic}": ${memoryContent}`,
        memory_type: 'learned_expertise',
        confidence: 0.85,
        incident_id: incidentId || null,
        tags: ['self_learning', entry.domain || 'general'],
        entities: [],
      }).catch(() => { /* non-critical */ });
    }
  } catch (err) {
    console.error(`[agent-self-learning] Research error for "${topic}":`, err);
  }
}

function generateDeepDiveQueries(topic: string, agent: string): string[] {
  return [
    `${topic} - latest developments and emerging trends 2025 2026`,
    `${topic} - expert methodologies and best practices from leading security professionals`,
    `${topic} - case studies and lessons learned from real-world incidents`,
    `${topic} - detection indicators and early warning signs`,
    `${topic} - mitigation strategies and response protocols`,
    `${topic} - future outlook and predicted evolution`,
  ];
}

async function identifyKnowledgeGaps(supabase: any): Promise<Array<{ query: string; context: string; suggestedAgent: string }>> {
  const gaps: Array<{ query: string; context: string; suggestedAgent: string }> = [];

  // 1. Look at recent high-severity signals for unfamiliar topics
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentSignals } = await supabase
    .from('signals')
    .select('signal_type, title, severity_score, location')
    .gte('severity_score', 60)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('severity_score', { ascending: false })
    .limit(20);

  if (recentSignals) {
    // Group by signal_type and find underrepresented domains in knowledge base
    const typeCounts: Record<string, number> = {};
    for (const s of recentSignals) {
      typeCounts[s.signal_type] = (typeCounts[s.signal_type] || 0) + 1;
    }

    for (const [type, count] of Object.entries(typeCounts)) {
      if (count >= 2) {
        const { count: knowledgeCount } = await supabase
          .from('expert_knowledge')
          .select('id', { count: 'exact', head: true })
          .ilike('applicability_tags', `%${type}%`);

        if ((knowledgeCount || 0) < 3) {
          gaps.push({
            query: `${type.replace(/_/g, ' ')} security threats - latest tactics, detection methods, and response procedures 2025 2026`,
            context: `${count} recent signals of type "${type}" but only ${knowledgeCount || 0} knowledge entries`,
            suggestedAgent: mapTypeToAgent(type),
          });
        }
      }
    }
  }

  // 2. Look at recent incidents for topics without expertise
  const { data: recentIncidents } = await supabase
    .from('incidents')
    .select('id, priority, status')
    .in('priority', ['p1', 'p2'])
    .gte('created_at', sevenDaysAgo.toISOString())
    .limit(5);

  if (recentIncidents && recentIncidents.length > 0) {
    gaps.push({
      query: 'Critical incident response best practices for corporate security operations centers - triage, escalation, and containment 2025 2026',
      context: `${recentIncidents.length} high-priority incidents in the last 7 days`,
      suggestedAgent: 'PRAETOR',
    });
  }

  // 3. Check for stale knowledge (not updated in 30+ days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: staleKnowledge } = await supabase
    .from('expert_knowledge')
    .select('domain, title')
    .lt('last_validated_at', thirtyDaysAgo.toISOString())
    .eq('is_active', true)
    .order('last_validated_at', { ascending: true })
    .limit(3);

  if (staleKnowledge) {
    for (const stale of staleKnowledge) {
      gaps.push({
        query: `${stale.title} - latest updates and developments 2025 2026`,
        context: `Stale knowledge entry in domain "${stale.domain}" needs refresh`,
        suggestedAgent: 'CRUCIBLE',
      });
    }
  }

  return gaps;
}

function mapTypeToAgent(signalType: string): string {
  const mapping: Record<string, string> = {
    cyber: 'NEO',
    data_exposure: 'NEO',
    theft: 'CERBERUS',
    protest: 'MERIDIAN',
    threat: 'SPECTER',
    surveillance: 'ARGUS',
    sabotage: 'ARGUS',
    violence: 'PRAETOR',
    wildfire: 'MERIDIAN',
    weather: 'MERIDIAN',
    regulatory: 'CRUCIBLE',
    reputational: 'WARDEN',
  };
  return mapping[signalType] || 'AEGIS-CMD';
}
