import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

    console.log(`[MemoryExtract] Extracting memories from conversation: ${conversation_id}`);

    const { data: messages, error: messagesError } = await supabase
      .from('ai_assistant_messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversation_id)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    if (messagesError) {
      console.error('[MemoryExtract] Failed to fetch messages:', messagesError);
      throw messagesError;
    }

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, memories_extracted: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const conversationText = messages
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    try {
      const extractionPrompt = `Analyze this conversation and extract key facts, decisions, and preferences:

${conversationText.substring(0, 8000)}

Return JSON:
{
  "title": "Brief title",
  "summary": "2-3 sentence summary",
  "key_facts": ["fact 1", ...],
  "user_preferences": ["preference 1", ...],
  "important_decisions": ["decision 1", ...]
}`;

      const aiResult = await callAiGateway({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: extractionPrompt }],
        functionName: 'extract-conversation-memory',
        dlqOnFailure: false,
      });

      const responseContent = aiResult.content || '';
      
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        
        await supabase
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
          }, { onConflict: 'conversation_id,user_id' });

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
          await supabase.from('conversation_memory').insert(memories);
        }

        console.log(`[MemoryExtract] Extracted ${memories.length} memories`);

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
    } catch (aiError) {
      console.error('[MemoryExtract] AI extraction failed:', aiError);
    }

    // Fallback without AI
    await supabase
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
      }, { onConflict: 'conversation_id,user_id' });

    return new Response(
      JSON.stringify({ success: true, memories_extracted: 0, fallback: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[MemoryExtract] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
