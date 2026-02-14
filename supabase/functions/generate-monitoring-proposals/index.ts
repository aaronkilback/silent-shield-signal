import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Generate Monitoring Proposals
 * 
 * Analyzes recent agent learnings, signal patterns, and knowledge gaps
 * to propose keyword/source additions for client monitoring configs.
 * Proposals queue for analyst approval — never auto-applied.
 */

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
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return errorResponse('LOVABLE_API_KEY not configured', 500);
    }

    let totalProposals = 0;

    for (const client of clients) {
      const currentKeywords = client.monitoring_keywords || [];
      const currentEntities = client.supply_chain_entities || [];

      // Filter signals relevant to this client
      const clientSignals = recentSignals?.filter(s => s.client_id === client.id) || [];
      
      if (clientSignals.length === 0 && (!recentLearnings || recentLearnings.length === 0)) {
        continue;
      }

      // Build analysis prompt
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

IMPORTANT: Only propose changes with clear evidence from the data above. Do not propose generic security terms already likely monitored.`;

      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'You are a security intelligence analyst. Return structured proposals only.' },
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
                        value: { type: 'string', description: 'The keyword or entity name' },
                        reasoning: { type: 'string', description: 'Why this change should be made, citing specific signals or learnings' },
                        confidence: { type: 'number', description: '0.0-1.0 confidence score' }
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

      // Filter out low-confidence and duplicate proposals
      const validProposals = proposals.filter(p => {
        if (p.confidence < 0.4) return false;
        if (p.type === 'add_keyword' && currentKeywords.includes(p.value.toLowerCase())) return false;
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

      console.log(`Generated ${validProposals.length} proposals for client ${client.name}`);
    }

    // Log autonomous action
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'monitoring_proposal_generation',
      trigger_source: 'generate-monitoring-proposals',
      action_details: { total_proposals: totalProposals, clients_analyzed: clients.length },
      status: 'completed'
    });

    return successResponse({
      success: true,
      proposals_created: totalProposals,
      clients_analyzed: clients.length
    });

  } catch (error: any) {
    console.error('Error generating monitoring proposals:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
