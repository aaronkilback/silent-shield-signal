import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Generate Monitoring Proposals
 * 
 * Analyzes recent agent learnings, signal patterns, and knowledge gaps
 * to propose keyword/source additions for client monitoring configs.
 * Proposals queue for analyst approval — never auto-applied.
 * 
 * QUALITY GATES:
 * - Minimum confidence: 0.7
 * - Minimum keyword length: 2 words (single generic words blocked)
 * - Generic term blocklist prevents noise-generating keywords
 * - Country names require compound phrases (e.g. "Iran sanctions" not "Iran")
 */

// Generic terms that generate massive noise when used as standalone keywords
const GENERIC_TERM_BLOCKLIST = new Set([
  // Single-word geopolitical noise
  'iran', 'russia', 'china', 'ukraine', 'syria', 'iraq', 'afghanistan',
  'north korea', 'pakistan', 'india', 'turkey', 'israel', 'palestine',
  // Overly broad threat categories
  'murder', 'suicide', 'shooting', 'stabbing', 'assault', 'robbery',
  'theft', 'fraud', 'corruption', 'violence', 'crime', 'attack',
  'terrorism', 'extremism', 'radicalization',
  // Generic tech/media terms
  'ai', 'social media', 'cyber', 'hacking', 'malware', 'ransomware',
  'data breach', 'phishing',
  // Broad geopolitical concepts
  'war', 'conflict', 'sanctions', 'embargo', 'coup', 'revolution',
  'unrest', 'protest', 'riot', 'crisis', 'recession', 'inflation',
  // Weapons (too broad without context)
  'icbms', 'missile', 'nuclear', 'weapon', 'bomb', 'drone',
  // Generic industry terms
  'fossil fuels', 'oil', 'gas', 'energy', 'mining',
  'economic crisis', 'social unrest', 'middle east tensions',
  'ballistic missile', 'nuclear capability', 'cyber warfare',
  'human trafficking',
]);

// Check if a proposed keyword is too generic to be useful
function isGenericKeyword(value: string): { blocked: boolean; reason?: string } {
  const lower = value.toLowerCase().trim();
  
  // Direct blocklist match
  if (GENERIC_TERM_BLOCKLIST.has(lower)) {
    return { blocked: true, reason: `"${value}" is too generic and will generate excessive noise` };
  }
  
  // Single words under 6 chars are almost always too broad
  const wordCount = lower.split(/\s+/).length;
  if (wordCount === 1 && lower.length < 6) {
    return { blocked: true, reason: `Single short keyword "${value}" is too broad for monitoring` };
  }
  
  // Country names as standalone keywords (need compound phrase)
  const countryNames = ['iran', 'russia', 'china', 'ukraine', 'syria', 'iraq', 'turkey', 'israel', 'india', 'pakistan', 'brazil', 'mexico'];
  if (countryNames.includes(lower)) {
    return { blocked: true, reason: `Country name "${value}" alone will match all news. Use compound phrase (e.g., "${value} energy sanctions")` };
  }
  
  return { blocked: false };
}

interface ProposalRequest {
  client_id?: string;
  agent_call_sign?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({})) as ProposalRequest;
    const { client_id, agent_call_sign } = body;

    console.log('Generating monitoring proposals...');

    // 1. Get recent expert knowledge entries (last 7 days) as learning signals
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentLearnings } = await supabase
      .from('expert_knowledge')
      .select('id, title, domain, content, source_type, created_at')
      .gte('created_at', sevenDaysAgo.toISOString())
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20);

    // 2. Get recent high-value signals to identify trending topics
    const { data: recentSignals } = await supabase
      .from('signals')
      .select('id, title, normalized_text, signal_type, category, severity_score, client_id')
      .gte('created_at', sevenDaysAgo.toISOString())
      .gte('severity_score', 60)
      .order('severity_score', { ascending: false })
      .limit(30);

    // 3. Get clients to propose for
    let clientQuery = supabase.from('clients').select('id, name, monitoring_keywords, supply_chain_entities');
    if (client_id) {
      clientQuery = clientQuery.eq('id', client_id);
    }
    const { data: clients } = await clientQuery;

    if (!clients || clients.length === 0) {
      return successResponse({ proposals_created: 0, reason: 'No clients found' });
    }

    // 4. Use AI to analyze gaps and generate proposals
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      return errorResponse('GEMINI_API_KEY not configured', 500);
    }

    let totalProposals = 0;
    let rejectedProposals = 0;

    for (const client of clients) {
      const currentKeywords = client.monitoring_keywords || [];
      const currentEntities = client.supply_chain_entities || [];

      // Filter signals relevant to this client
      const clientSignals = recentSignals?.filter(s => s.client_id === client.id) || [];
      
      if (clientSignals.length === 0 && (!recentLearnings || recentLearnings.length === 0)) {
        continue;
      }

      // Build analysis prompt — with stricter instructions
      const prompt = `You are CRUCIBLE, the Data Quality Auditor for a security intelligence platform.

Analyze the following data and propose monitoring keyword or entity additions for client "${client.name}".

CURRENT MONITORING KEYWORDS: ${JSON.stringify(currentKeywords)}
CURRENT SUPPLY CHAIN ENTITIES: ${JSON.stringify(currentEntities)}

RECENT HIGH-SEVERITY SIGNALS FOR THIS CLIENT (last 7 days):
${clientSignals.map(s => `- [${s.signal_type}/${s.category}] ${s.title} (severity: ${s.severity_score})`).join('\n') || 'None'}

RECENT KNOWLEDGE ACQUISITIONS (agent learnings):
${(recentLearnings || []).map(l => `- [${l.domain}] ${l.title}`).join('\n') || 'None'}

Based on signal patterns and learned knowledge, identify:
1. Keywords that should be ADDED to monitoring (emerging threats, new TTPs, trending topics relevant to this client)
2. Keywords that should be REMOVED (no longer relevant, too noisy)
3. New entities to monitor (organizations, threat actors, infrastructure mentioned in signals)

STRICT RULES — VIOLATIONS WILL BE REJECTED:
- NEVER propose single generic words (e.g., "murder", "Iran", "AI", "unrest"). These match millions of irrelevant articles.
- Keywords MUST be specific compound phrases (2+ words minimum) that relate DIRECTLY to the client's operations, geography, or supply chain.
- Country names are ONLY acceptable as part of a compound phrase (e.g., "Iran energy sanctions" not "Iran").
- Crime categories (murder, suicide, arson) are ONLY acceptable with geographic qualifiers (e.g., "Fort St. John homicide").
- Broad threat categories (cyber warfare, social unrest, economic crisis) are NEVER acceptable as keywords.
- Each proposal MUST cite a specific signal or learning as evidence.
- Confidence scores MUST be honest: 0.9+ only for keywords directly naming client assets, operations, or known threats.
- If no high-quality proposals exist, return an EMPTY array. Do not pad with generic terms.`;

      const aiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GEMINI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'You are a security intelligence analyst. Return structured proposals only. Quality over quantity — an empty proposal list is better than noisy suggestions.' },
            { role: 'user', content: prompt }
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'submit_proposals',
              description: 'Submit monitoring change proposals',
              parameters: {
                type: 'object',
                properties: {
                  proposals: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['add_keyword', 'remove_keyword', 'add_entity'] },
                        value: { type: 'string', description: 'The keyword or entity name — must be a specific compound phrase, not a generic term' },
                        reasoning: { type: 'string', description: 'Why this change should be made, citing specific signals or learnings by title' },
                        confidence: { type: 'number', description: '0.0-1.0 confidence score. 0.9+ reserved for direct client asset/operation matches only.' }
                      },
                      required: ['type', 'value', 'reasoning', 'confidence']
                    }
                  }
                },
                required: ['proposals']
              }
            }
          }],
          tool_choice: { type: 'function', function: { name: 'submit_proposals' } }
        })
      });

      if (!aiResponse.ok) {
        console.error(`AI analysis failed for client ${client.name}:`, await aiResponse.text());
        continue;
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      
      if (!toolCall) {
        console.log(`No proposals generated for client ${client.name}`);
        continue;
      }

      let proposals: any[];
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        proposals = parsed.proposals || [];
      } catch {
        console.error('Failed to parse AI proposals');
        continue;
      }

      // === QUALITY GATE: Multi-layer filtering ===
      const validProposals = proposals.filter(p => {
        // Gate 1: Minimum confidence threshold (raised from 0.4 to 0.7)
        if (p.confidence < 0.7) {
          console.log(`[REJECTED] "${p.value}" — confidence ${p.confidence} below 0.7 threshold`);
          rejectedProposals++;
          return false;
        }
        
        // Gate 2: Generic term blocklist
        const genericCheck = isGenericKeyword(p.value);
        if (genericCheck.blocked) {
          console.log(`[REJECTED] ${genericCheck.reason}`);
          rejectedProposals++;
          return false;
        }
        
        // Gate 3: Already exists in current keywords (case-insensitive)
        if (p.type === 'add_keyword') {
          const lowerValue = p.value.toLowerCase();
          if (currentKeywords.some((k: string) => k.toLowerCase() === lowerValue)) {
            console.log(`[REJECTED] "${p.value}" — already in monitoring keywords`);
            rejectedProposals++;
            return false;
          }
        }
        
        // Gate 4: Reasoning must reference specific evidence (not just generic justification)
        if (!p.reasoning || p.reasoning.length < 20) {
          console.log(`[REJECTED] "${p.value}" — insufficient reasoning`);
          rejectedProposals++;
          return false;
        }
        
        return true;
      });

      // Check for existing pending proposals to avoid duplicates
      const { data: existingPending } = await supabase
        .from('monitoring_proposals')
        .select('proposed_value')
        .eq('client_id', client.id)
        .eq('status', 'pending');

      const existingValues = new Set((existingPending || []).map(p => p.proposed_value.toLowerCase()));

      // Insert proposals
      for (const proposal of validProposals) {
        if (existingValues.has(proposal.value.toLowerCase())) continue;

        const proposalType = proposal.type === 'add_entity' ? 'add_entity' : proposal.type;

        await supabase.from('monitoring_proposals').insert({
          client_id: client.id,
          proposal_type: proposalType,
          proposed_value: proposal.value,
          proposed_by_agent: agent_call_sign || 'CRUCIBLE',
          reasoning: proposal.reasoning,
          confidence: proposal.confidence,
          source_evidence: {
            signal_count: clientSignals.length,
            learning_count: recentLearnings?.length || 0,
            generated_at: new Date().toISOString()
          }
        });

        totalProposals++;
      }

      console.log(`[${client.name}] Accepted: ${validProposals.length}, Rejected: ${rejectedProposals}`);
    }

    // Log autonomous action
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'monitoring_proposal_generation',
      trigger_source: 'generate-monitoring-proposals',
      action_details: { 
        total_proposals: totalProposals, 
        rejected_proposals: rejectedProposals,
        clients_analyzed: clients.length 
      },
      status: 'completed'
    });

    return successResponse({
      success: true,
      proposals_created: totalProposals,
      proposals_rejected: rejectedProposals,
      clients_analyzed: clients.length
    });

  } catch (error: any) {
    console.error('Error generating monitoring proposals:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
