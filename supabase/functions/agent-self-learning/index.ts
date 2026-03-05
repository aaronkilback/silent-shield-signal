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
  mode: 'reactive' | 'proactive' | 'deep_dive' | 'literature_review';
  agent_call_sign?: string;
  topic?: string;
  context?: string;
  incident_id?: string;
  max_queries?: number;
  domain_focus?: string;
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
  '0DAY': 'You are an elite offensive security specialist and ethical hacker modeled after Ryan Montgomery (0dayctf). Research this topic for exploitation techniques, vulnerability patterns, attack methodologies, defensive countermeasures, and red team tradecraft. Focus on penetration testing, digital footprint exposure, WiFi/Bluetooth/network vulnerabilities, password security, AI-weaponized attacks, phishing campaigns, mobile device threats, and emerging offensive tooling. Always include detection and mitigation alongside attack vectors.',
  'VERIDIAN-TANGO': 'You are an elite counterterrorism intelligence analyst specializing in energy-sector threats. Research this topic for terrorism plot indicators, radicalization pathways, attack methodologies targeting pipelines/LNG/refineries, Canadian national security frameworks (CSIS/RCMP INSET), BC/Alberta regional threat patterns, eco-terrorism escalation indicators, and critical infrastructure protection strategies. Always distinguish between activism and terrorism, and anchor findings to specific evidence.',
};

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({})) as LearningRequest;
    const { mode = 'proactive', agent_call_sign, topic, context, incident_id, max_queries, domain_focus } = body;

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      return errorResponse('OPENAI_API_KEY not configured', 500);
    }
    const PERPLEXITY_API_KEY = OPENAI_API_KEY; // Route through OpenAI

    const supabase = createServiceClient();
    const queryLimit = max_queries || (mode === 'deep_dive' ? 5 : mode === 'literature_review' ? 6 : 3);
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

    } else if (mode === 'literature_review') {
      // ── Literature Review: Autonomously discover and ingest expert books/publications ──
      console.log(`[agent-self-learning] Literature review mode — agent: ${agent_call_sign || 'auto'}, domain: ${domain_focus || 'auto'}`);
      
      if (topic) {
        // Targeted literature review on a specific subject
        const litQueries = generateLiteratureQueries(topic, agent_call_sign || 'AEGIS-CMD');
        for (const query of litQueries.slice(0, queryLimit)) {
          await new Promise(r => setTimeout(r, 2000)); // Slightly longer delay for deeper searches
          await researchLiterature(supabase, PERPLEXITY_API_KEY, {
            topic: query,
            context: `Literature review: ${topic}`,
            agentCallSign: agent_call_sign || 'AEGIS-CMD',
          }, results);
        }
      } else {
        // Autonomous: agents identify their own reading list based on gaps
        const readingList = await identifyLiteratureGaps(supabase, agent_call_sign, domain_focus);
        console.log(`[agent-self-learning] Generated ${readingList.length} literature targets`);
        
        for (const item of readingList.slice(0, queryLimit)) {
          await new Promise(r => setTimeout(r, 2000));
          await researchLiterature(supabase, PERPLEXITY_API_KEY, {
            topic: item.query,
            context: item.context,
            agentCallSign: item.suggestedAgent,
          }, results);
        }
      }

    } else {
      // ── Proactive: Identify knowledge gaps from recent activity ──
      // If a specific agent was requested, run learning for that agent directly
      if (agent_call_sign && agent_call_sign !== 'AEGIS-CMD') {
        console.log(`[agent-self-learning] Proactive learning for agent: ${agent_call_sign}`);
        const agentGaps = await identifyLiteratureGaps(supabase, agent_call_sign);
        console.log(`[agent-self-learning] ${agent_call_sign}: ${agentGaps.length} learning targets`);
        for (const gap of agentGaps.slice(0, queryLimit)) {
          await new Promise(r => setTimeout(r, 1500));
          await researchTopic(supabase, PERPLEXITY_API_KEY, {
            topic: gap.query,
            context: gap.context,
            agentCallSign: agent_call_sign,
          }, results);
        }
      } else {
        // General proactive: identify gaps + rotate through underserved agents
        const gaps = await identifyKnowledgeGaps(supabase);
        
        // Also find the agent with the least learning activity and add a gap for them
        const agentsToRotate = Object.keys(AGENT_LEARNING_PROMPTS);
        const { data: recentSessions } = await supabase
          .from('agent_learning_sessions')
          .select('agent_id')
          .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
        
        const activeAgentIds = new Set((recentSessions || []).map((s: any) => s.agent_id).filter(Boolean));
        
        // Find agents that haven't had any learning sessions
        for (const callSign of agentsToRotate) {
          const { data: agentRow } = await supabase
            .from('ai_agents')
            .select('id')
            .eq('call_sign', callSign)
            .maybeSingle();
          
          if (agentRow && !activeAgentIds.has(agentRow.id)) {
            const agentSpecialty = AGENT_LEARNING_PROMPTS[callSign]?.substring(0, 60) || 'security';
            gaps.push({
              query: `${agentSpecialty} - latest tactics, detection methods, and response procedures 2025 2026`,
              context: `Agent ${callSign} has had no learning activity in 7 days — rotating in`,
              suggestedAgent: callSign,
            });
            break; // Only add one underserved agent per cycle to avoid overwhelming
          }
        }
        
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
    }

    // Record learning session — link to actual agent record
    let resolvedAgentId: string | null = null;
    if (agent_call_sign) {
      const { data: agentRow } = await supabase
        .from('ai_agents')
        .select('id')
        .eq('call_sign', agent_call_sign)
        .maybeSingle();
      resolvedAgentId = agentRow?.id || null;
    }

    await supabase.from('agent_learning_sessions').insert({
      agent_id: resolvedAgentId,
      session_type: mode,
      learnings: results,
      source_count: results.topics_researched.length,
      quality_score: results.entries_created > 0 ? 0.85 : 0.5,
      promoted_to_global: results.entries_created > 2,
    });

    // Trigger monitoring proposal generation after learning
    if (results.entries_created > 0) {
      console.log('[agent-self-learning] Triggering monitoring proposal generation...');
      supabase.functions.invoke('generate-monitoring-proposals', {
        body: { agent_call_sign: agent_call_sign || 'CRUCIBLE' }
      }).catch(err => console.error('[agent-self-learning] Proposal generation failed:', err));
    }

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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error(`[agent-self-learning] OpenAI error ${response.status}`);
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations: string[] = [];

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
            citation: `[${agentCallSign}] ${entry.citation || citations.join(', ')}`,
            confidence_score: 0.85,
          });
        results.entries_created++;
      }
    }

    // Store in agent memory for the specific agent
    if (entries.length > 0) {
      const memoryContent = entries.map((e: any) => `[${e.knowledge_type}] ${e.title}: ${e.content?.substring(0, 200)}`).join('\n\n');
      const primaryDomain = entries[0]?.domain || 'general';
      try {
        await supabase.from('agent_investigation_memory').insert({
          agent_call_sign: agentCallSign,
          content: `Self-learning on "${topic}": ${memoryContent}`,
          memory_type: 'learned_expertise',
          confidence: 0.85,
          incident_id: incidentId || null,
          tags: ['self_learning', primaryDomain],
          entities: [],
        });
      } catch (_) { /* non-critical */ }
    }
  } catch (err) {
    console.error(`[agent-self-learning] Research error for "${topic}":`, err);
  }
}

function generateLiteratureQueries(topic: string, agent: string): string[] {
  const agentFocus: Record<string, string> = {
    'CERBERUS': 'financial crime, AML, sanctions, money laundering',
    'NEO': 'cyber threat intelligence, APT groups, malware analysis',
    'SPECTER': 'insider threat, behavioral analysis, counterintelligence',
    'MERIDIAN': 'geopolitical risk, political violence, regional stability',
    'ARGUS': 'physical security, executive protection, surveillance detection',
    'VIPER': 'narcotics intelligence, cartel operations, drug trafficking',
    'PRAETOR': 'criminal investigations, evidence management, case law',
    'WARDEN': 'content moderation, online radicalization, digital safety',
    'OUROBOROS': 'supply chain security, vendor risk, logistics threats',
    'CRUCIBLE': 'intelligence analysis methodology, structured analytic techniques',
    '0DAY': 'offensive security, ethical hacking, penetration testing, red team operations, vulnerability research, digital footprint analysis, WiFi security, Bluetooth security, password security, AI-weaponized attacks, phishing campaigns, mobile device security',
    'VERIDIAN-TANGO': 'counterterrorism intelligence, energy sector terrorism, radicalization detection, plot disruption, critical infrastructure protection, Canadian national security, eco-terrorism, CBRNE threats, lone wolf identification, pipeline and LNG facility attack vectors',
  };

  const focus = agentFocus[agent] || 'security and intelligence';

  return [
    `Most authoritative and widely-cited books written by experts on "${topic}" in the field of ${focus}. List the book titles, authors, key frameworks, and most important concepts from each.`,
    `Academic publications, peer-reviewed research papers, and seminal works on "${topic}" relevant to ${focus}. Extract the core methodologies, statistical models, and analytical frameworks.`,
    `Expert practitioner handbooks and professional reference guides on "${topic}" for ${focus}. What are the step-by-step procedures, decision matrices, and operational checklists these experts recommend?`,
    `Key concepts and frameworks from leading textbooks on "${topic}" used in graduate-level security programs and intelligence training academies. Extract the theoretical models and their practical applications.`,
    `Lessons learned and case studies documented in books and publications about "${topic}" in ${focus}. What recurring failure patterns do experts identify and what countermeasures do they prescribe?`,
    `The most recent books and expert publications (2023-2026) on "${topic}" that introduce new thinking, revised frameworks, or challenge conventional wisdom in ${focus}.`,
  ];
}

async function researchLiterature(
  supabase: any,
  apiKey: string,
  params: { topic: string; context: string; agentCallSign: string },
  results: { topics_researched: string[]; entries_created: number; entries_updated: number }
) {
  const { topic, context, agentCallSign } = params;
  const agentPersona = AGENT_LEARNING_PROMPTS[agentCallSign] || AGENT_LEARNING_PROMPTS['AEGIS-CMD'];

  const systemPrompt = `${agentPersona}

You are conducting a LITERATURE REVIEW — extracting deep structured knowledge from expert books, academic publications, and authoritative references.

Your goal is NOT surface-level summaries. Extract the OPERATIONAL KNOWLEDGE:
- Specific frameworks with their steps/phases/stages
- Decision matrices and threshold criteria
- Checklists and standard operating procedures
- Named methodologies and their originators
- Quantitative benchmarks and metrics experts cite
- Contrarian views and debates between schools of thought

Return your findings as a JSON array of 3-5 knowledge entries. Each entry:
- "title": concise title referencing the source (e.g., "Heuer's Analysis of Competing Hypotheses Framework") (max 120 chars)
- "content": deep extracted knowledge (400-800 words). Write as a classified intelligence reference document. Include specific steps, criteria, thresholds, and decision points. Cite the book/author inline.
- "domain": one of "cyber", "physical_security", "executive_protection", "crisis_management", "threat_intelligence", "travel_security", "compliance", "geopolitical", "investigations", "osint", "financial_crime", "counterintelligence"
- "subdomain": specific sub-area
- "knowledge_type": one of "framework", "methodology", "best_practice", "tactical_procedure", "standard", "case_study", "emerging_trend", "reference_model"
- "tags": array of 4-8 applicability tags
- "citation": "Author (Year). Book Title. Publisher." format
- "source_authority": "textbook" | "academic_paper" | "practitioner_guide" | "government_publication" | "industry_standard"

Return ONLY the JSON array.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${context}\n\n${topic}` }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error(`[agent-self-learning] Literature research OpenAI error ${response.status}`);
      return;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations: string[] = [];

    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    const entries = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(entries)) return;

    results.topics_researched.push(topic.substring(0, 100));

    for (const entry of entries.slice(0, 5)) {
      if (!entry.title || !entry.content || entry.content.length < 100) continue;

      const normTitle = entry.title.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      const searchKey = normTitle.substring(0, 40);

      const { data: existing } = await supabase
        .from('expert_knowledge')
        .select('id, content')
        .eq('domain', entry.domain || 'threat_intelligence')
        .ilike('title', `%${searchKey}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        const oldWords = new Set(existing[0].content.toLowerCase().split(/\s+/));
        const newWords = entry.content.toLowerCase().split(/\s+/);
        const novelWords = newWords.filter((w: string) => !oldWords.has(w));
        
        if (novelWords.length / newWords.length > 0.25) { // Lower threshold for literature — richer content
          await supabase
            .from('expert_knowledge')
            .update({
              content: existing[0].content + '\n\n---\n\n' + entry.content, // Append rather than replace for books
              source_type: entry.source_authority || 'textbook',
              citation: entry.citation || citations.join(', '),
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
            knowledge_type: entry.knowledge_type || 'framework',
            title: entry.title,
            content: entry.content,
            applicability_tags: entry.tags || [],
            citation: `[${agentCallSign}] ${entry.citation || citations.join(', ')}`,
            source_type: entry.source_authority || 'textbook',
            confidence_score: 0.92,
          });
        results.entries_created++;
      }
    }

    // Store consolidated memory for the agent
    if (entries.length > 0) {
      try {
        const memoryContent = entries.map((e: any) => `[${e.source_authority || 'book'}] ${e.title}: ${e.content?.substring(0, 300)}`).join('\n\n');
        const primaryDomain = entries[0]?.domain || 'general';
        await supabase.from('agent_investigation_memory').insert({
          agent_call_sign: agentCallSign,
          content: `Literature review — "${topic.substring(0, 80)}": ${memoryContent}`,
          memory_type: 'learned_expertise',
          confidence: 0.92,
          tags: ['literature_review', 'expert_books', primaryDomain],
          entities: [],
        });
      } catch (_) { /* non-critical */ }
    }
  } catch (err) {
    console.error(`[agent-self-learning] Literature research error for "${topic}":`, err);
  }
}

async function identifyLiteratureGaps(
  supabase: any, 
  agentCallSign?: string, 
  domainFocus?: string
): Promise<Array<{ query: string; context: string; suggestedAgent: string }>> {
  const targets: Array<{ query: string; context: string; suggestedAgent: string }> = [];

  // 1. Find domains with low knowledge density
  const domains = ['cyber', 'physical_security', 'financial_crime', 'geopolitical', 'counterintelligence', 
                   'executive_protection', 'investigations', 'crisis_management', 'compliance', 'osint', 'offensive_security'];
  
  const targetDomains = domainFocus ? [domainFocus] : domains;

  for (const domain of targetDomains) {
    const { count } = await supabase
      .from('expert_knowledge')
      .select('id', { count: 'exact', head: true })
      .eq('domain', domain)
      .eq('is_active', true);

    if ((count || 0) < 5) {
      const agent = agentCallSign || mapDomainToAgent(domain);
      targets.push({
        query: `Most authoritative expert books and definitive publications on ${domain.replace(/_/g, ' ')} for security professionals. Extract key frameworks, methodologies, and operational procedures.`,
        context: `Domain "${domain}" has only ${count || 0} knowledge entries — needs foundational literature`,
        suggestedAgent: agent,
      });
    }
  }

  // 2. Find recently active signal types lacking textbook-level knowledge
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recentSignalTypes } = await supabase
    .from('signals')
    .select('signal_type')
    .gte('severity_score', 70)
    .gte('created_at', sevenDaysAgo.toISOString())
    .limit(50);

  if (recentSignalTypes) {
    const typeCounts: Record<string, number> = {};
    for (const s of recentSignalTypes) {
      typeCounts[s.signal_type] = (typeCounts[s.signal_type] || 0) + 1;
    }

    for (const [type, count] of Object.entries(typeCounts)) {
      if (count >= 3) {
        const { count: bookCount } = await supabase
          .from('expert_knowledge')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .or(`source_type.eq.textbook,source_type.eq.academic_paper`)
          .ilike('applicability_tags', `%${type}%`);

        if ((bookCount || 0) < 2) {
          targets.push({
            query: `Expert books and academic publications on ${type.replace(/_/g, ' ')} threats — detection frameworks, response procedures, and case studies from leading practitioners.`,
            context: `${count} high-severity ${type} signals this week but only ${bookCount || 0} textbook-level entries`,
            suggestedAgent: agentCallSign || mapTypeToAgent(type),
          });
        }
      }
    }
  }

  // 3. If a specific agent is requested, generate reading list for their specialty
  if (agentCallSign && targets.length === 0) {
    const specialtyReadingLists: Record<string, string[]> = {
      'CERBERUS': ['anti-money laundering compliance and financial crime investigation', 'sanctions evasion and trade-based money laundering', 'cryptocurrency tracing and blockchain forensics'],
      'NEO': ['advanced persistent threat analysis and cyber kill chain', 'malware reverse engineering and threat hunting', 'network forensics and intrusion detection'],
      'SPECTER': ['insider threat program development and behavioral indicators', 'counterintelligence tradecraft and operational security', 'social engineering and deception detection'],
      'MERIDIAN': ['geopolitical risk assessment and political instability forecasting', 'conflict zone security management', 'sanctions and export control compliance'],
      'ARGUS': ['surveillance detection routes and counter-surveillance', 'executive protection advance operations', 'security operations center management'],
      'VIPER': ['narcotics trafficking intelligence and interdiction', 'transnational organized crime networks', 'dark web marketplace operations'],
      'PRAETOR': ['criminal investigation case management', 'digital forensics and evidence preservation', 'complex fraud investigation methodology'],
      'CRUCIBLE': ['structured analytic techniques for intelligence analysis', 'intelligence collection management', 'critical thinking and cognitive bias in analysis'],
      '0DAY': [
        'penetration testing methodology and red team operations — PTES, OSSTMM, OWASP Testing Guide',
        'AI weaponization in cyberattacks — deepfake phishing, LLM-assisted exploitation, prompt injection attacks, AI-generated malware',
        'advanced phishing campaigns and social engineering — spearphishing, BEC, MFA bypass techniques like Evilginx and AitM attacks',
        'WiFi and Bluetooth exploitation — Evil Twin, KARMA, WPA3 Dragonblood, BLE GATT attacks, car key relay, Flipper Zero threats',
        'digital footprint analysis and OPSEC — personal data exposure, breach correlation, dark web credential monitoring, data broker removal',
        'password security and credential attacks — credential stuffing, password spraying, hashcat techniques, passkey/FIDO2 migration',
        'mobile device security for field operators — iOS/Android exploitation, SIM swapping, SS7 attacks, juice jacking, baseband attacks',
        'network vulnerability assessment — zero-trust architecture, VPN exploitation (Fortinet/Citrix/Pulse CVEs), lateral movement techniques',
        'bug bounty methodology and responsible disclosure — HackerOne, Bugcrowd, vulnerability chaining, CVSS scoring, 0-day market dynamics',
      ],
      'VERIDIAN-TANGO': [
        'counterterrorism intelligence analysis and plot detection methodology — attack planning cycle, precursor indicators, disruption windows',
        'energy sector terrorism and critical infrastructure protection — pipeline sabotage, LNG facility vulnerabilities, SCADA/ICS attack vectors, refinery targeting',
        'Canadian counterterrorism framework — CSIS strategic assessments, RCMP INSET operations, Canadian Anti-Terrorism Act, Five Eyes intelligence sharing',
        'radicalization pathways and extremism detection — IMVE, eco-terrorism escalation, online radicalization, lone wolf behavioral indicators',
        'BC and Alberta regional threat landscape — environmental extremism history, Indigenous rights vs. extremism distinction, energy corridor security',
        'CBRNE threat assessment for energy infrastructure — chemical release scenarios, explosive device detection, radiological dispersal devices',
        'terrorism financing and logistics — material acquisition patterns, operational security indicators, cell communication methods',
      ],
    };

    const readingList = specialtyReadingLists[agentCallSign] || ['security risk management and threat assessment'];
    for (const subject of readingList) {
      targets.push({
        query: `Most important expert books and definitive publications on ${subject}. Extract the core frameworks, step-by-step methodologies, and key decision criteria.`,
        context: `Agent ${agentCallSign} autonomous literature acquisition`,
        suggestedAgent: agentCallSign,
      });
    }
  }

  return targets;
}

function mapDomainToAgent(domain: string): string {
  const mapping: Record<string, string> = {
    cyber: 'NEO', financial_crime: 'CERBERUS', geopolitical: 'MERIDIAN',
    physical_security: 'ARGUS', counterintelligence: 'SPECTER', investigations: 'PRAETOR',
    executive_protection: 'ARGUS', crisis_management: 'AEGIS-CMD', compliance: 'CRUCIBLE',
    osint: 'NEO', offensive_security: '0DAY', terrorism: 'VERIDIAN-TANGO',
    counterterrorism: 'VERIDIAN-TANGO', extremism: 'VERIDIAN-TANGO',
    radicalization: 'VERIDIAN-TANGO', energy_terrorism: 'VERIDIAN-TANGO',
  };
  return mapping[domain] || 'AEGIS-CMD';
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
    data_exposure: '0DAY',
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
    vulnerability: '0DAY',
    exploit: '0DAY',
    phishing: '0DAY',
    credential_leak: '0DAY',
    ransomware: '0DAY',
    terrorism: 'VERIDIAN-TANGO',
    extremism: 'VERIDIAN-TANGO',
    radicalization: 'VERIDIAN-TANGO',
    ied: 'VERIDIAN-TANGO',
    bomb_threat: 'VERIDIAN-TANGO',
    cbrne: 'VERIDIAN-TANGO',
  };
  return mapping[signalType] || 'AEGIS-CMD';
}
