import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { conversation_id } = await req.json();

    if (!conversation_id) {
      return new Response(
        JSON.stringify({ error: 'conversation_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[extract-conversation-memory] Extracting memories from conversation: ${conversation_id}`);

    // Fetch all messages from the conversation
    const { data: messages, error: messagesError } = await supabase
      .from('ai_assistant_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversation_id)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (messagesError) {
      console.error('Failed to fetch messages:', messagesError);
      throw messagesError;
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, memories_extracted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Prepare conversation text for summarization
    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    // Use AI to extract key facts and decisions
    if (lovableApiKey) {
      const extractionPrompt = `Analyze this conversation and extract key facts, decisions, and preferences that should be remembered for future conversations. Focus on:
1. User preferences and settings
2. Important decisions made
3. Key facts about their work, clients, or projects
4. Recurring themes or interests

Conversation:
${conversationText.substring(0, 8000)}

Respond with a JSON object:
{
  "title": "Brief title for this conversation",
  "summary": "2-3 sentence summary",
  "key_facts": ["fact 1", "fact 2", ...],
  "user_preferences": ["preference 1", ...],
  "important_decisions": ["decision 1", ...]
}`;

      try {
        const aiResponse = await fetch('https://api.lovable.dev/api/ai/chat', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [{ role: 'user', content: extractionPrompt }],
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const responseContent = aiData.choices?.[0]?.message?.content || '';
          
          // Parse the JSON response
          const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const extracted = JSON.parse(jsonMatch[0]);
            
            // Save conversation summary
            const { error: summaryError } = await supabase
              .from('conversation_summaries')
              .upsert({
                conversation_id,
                user_id: user.id,
                title: extracted.title || 'Archived conversation',
                summary: extracted.summary || 'No summary available',
                key_facts: extracted.key_facts || [],
                message_count: messages.length,
                first_message_at: messages[0].created_at,
                last_message_at: messages[messages.length - 1].created_at,
              }, {
                onConflict: 'conversation_id,user_id',
              });

            if (summaryError) {
              console.error('Failed to save summary:', summaryError);
            }

            // Save individual memories
            const memories = [
              ...(extracted.key_facts || []).map((fact: string) => ({
                user_id: user.id,
                memory_type: 'fact',
                content: fact,
                context_tags: ['archived-conversation'],
                importance_score: 0.7,
                scope: 'user',
              })),
              ...(extracted.user_preferences || []).map((pref: string) => ({
                user_id: user.id,
                memory_type: 'preference',
                content: pref,
                context_tags: ['archived-conversation'],
                importance_score: 0.8,
                scope: 'user',
              })),
              ...(extracted.important_decisions || []).map((dec: string) => ({
                user_id: user.id,
                memory_type: 'decision',
                content: dec,
                context_tags: ['archived-conversation'],
                importance_score: 0.9,
                scope: 'user',
              })),
            ];

            if (memories.length > 0) {
              const { error: memoryError } = await supabase
                .from('conversation_memory')
                .insert(memories);

              if (memoryError) {
                console.error('Failed to save memories:', memoryError);
              }
            }

            console.log(`[extract-conversation-memory] Extracted ${memories.length} memories`);

            return new Response(
              JSON.stringify({
                success: true,
                memories_extracted: memories.length,
                title: extracted.title,
                summary: extracted.summary,
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        }
      } catch (aiError) {
        console.error('AI extraction failed:', aiError);
      }
    }

    // Fallback: save basic summary without AI
    const { error: summaryError } = await supabase
      .from('conversation_summaries')
      .upsert({
        conversation_id,
        user_id: user.id,
        title: `Conversation from ${new Date(messages[0].created_at).toLocaleDateString()}`,
        summary: `Archived conversation with ${messages.length} messages`,
        key_facts: [],
        message_count: messages.length,
        first_message_at: messages[0].created_at,
        last_message_at: messages[messages.length - 1].created_at,
      }, {
        onConflict: 'conversation_id,user_id',
      });

    if (summaryError) {
      console.error('Failed to save fallback summary:', summaryError);
    }

    return new Response(
      JSON.stringify({ success: true, memories_extracted: 0, fallback: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[extract-conversation-memory] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
