import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { briefing_id, agent_id, user_message, parent_message_id, is_group_question } = await req.json();
    console.log('Briefing chat response request:', { briefing_id, agent_id, is_group_question });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch the agent configuration
    const { data: agent, error: agentError } = await supabase
      .from('ai_agents')
      .select('*')
      .eq('id', agent_id)
      .single();

    if (agentError || !agent) {
      throw new Error('Agent not found');
    }

    // Fetch briefing context
    const { data: briefing } = await supabase
      .from('briefing_sessions')
      .select('*, investigation_workspaces(name, case_number)')
      .eq('id', briefing_id)
      .single();

    // Fetch recent chat history for context
    const { data: recentMessages } = await supabase
      .from('briefing_chat_messages')
      .select('content, message_type, author_user_id, author_agent_id')
      .eq('briefing_id', briefing_id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Fetch workspace evidence and notes for additional context
    const { data: evidence } = await supabase
      .from('workspace_evidence')
      .select('filename, description, evidence_type, tags')
      .eq('workspace_id', briefing?.workspace_id)
      .limit(10);

    const { data: notes } = await supabase
      .from('briefing_notes')
      .select('content, note_type, topic')
      .eq('briefing_id', briefing_id)
      .limit(10);

    const { data: decisions } = await supabase
      .from('briefing_decisions')
      .select('decision_text, rationale, category, status')
      .eq('briefing_id', briefing_id)
      .limit(5);

    // Build context
    let contextData = '';
    
    if (briefing) {
      contextData += `\n\nBRIEFING CONTEXT:`;
      contextData += `\nTitle: ${briefing.title}`;
      contextData += `\nStatus: ${briefing.status}`;
      if (briefing.description) contextData += `\nDescription: ${briefing.description}`;
    }

    if (recentMessages?.length) {
      contextData += `\n\nRECENT CHAT HISTORY:`;
      recentMessages.reverse().forEach((msg, i) => {
        const role = msg.author_agent_id ? 'Agent' : 'User';
        contextData += `\n${i + 1}. [${role}]: ${msg.content.substring(0, 300)}`;
      });
    }

    if (evidence?.length) {
      contextData += `\n\nAVAILABLE EVIDENCE:`;
      evidence.forEach(e => {
        contextData += `\n- ${e.filename} (${e.evidence_type}): ${e.description || 'No description'}`;
      });
    }

    if (notes?.length) {
      contextData += `\n\nBRIEFING NOTES:`;
      notes.forEach(n => {
        contextData += `\n- [${n.note_type}${n.topic ? '/' + n.topic : ''}]: ${n.content.substring(0, 200)}`;
      });
    }

    if (decisions?.length) {
      contextData += `\n\nKEY DECISIONS:`;
      decisions.forEach(d => {
        contextData += `\n- [${d.status}] ${d.decision_text}`;
        if (d.rationale) contextData += ` (Rationale: ${d.rationale.substring(0, 100)})`;
      });
    }

    // Build system prompt
    const systemPrompt = `${agent.system_prompt || `You are ${agent.codename}, an AI agent specializing in ${agent.specialty}.`}

Your Mission: ${agent.mission_scope}

You are participating in an investigative briefing session. ${is_group_question ? 'Multiple agents are being asked this question - provide your unique perspective based on your specialty.' : 'You have been specifically tagged to respond.'}

${contextData}

RESPONSE GUIDELINES:
- Be concise but insightful (aim for 2-4 paragraphs maximum)
- Focus on your area of expertise: ${agent.specialty}
- Provide actionable intelligence or recommendations when possible
- Reference evidence or notes when relevant
- If this is a group question, acknowledge other perspectives but focus on your specialty
- Maintain your persona as ${agent.codename}
- Be collaborative and supportive of the investigation team`;

    // Call AI Gateway
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: user_message }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        console.error('Rate limit exceeded');
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        console.error('Payment required');
        return new Response(
          JSON.stringify({ error: 'Payment required' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const agentResponse = data.choices?.[0]?.message?.content;

    if (!agentResponse) {
      throw new Error('No response from AI');
    }

    // Store the agent's response in the chat
    const { error: insertError } = await supabase
      .from('briefing_chat_messages')
      .insert({
        briefing_id,
        author_agent_id: agent_id,
        content: agentResponse,
        message_type: 'agent_response',
        parent_message_id,
        is_group_question
      });

    if (insertError) {
      console.error('Failed to store agent response:', insertError);
    }

    console.log('Agent response stored successfully');

    return new Response(
      JSON.stringify({ success: true, response: agentResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in briefing-chat-response:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
