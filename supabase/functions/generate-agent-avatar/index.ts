import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { agent_id, agent_name, persona, specialty } = await req.json();

    if (!agent_id || !agent_name) {
      return new Response(
        JSON.stringify({ error: 'agent_id and agent_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `Professional portrait photograph of a sophisticated intelligence agent or security professional named "${agent_name}". 
${persona ? `Character traits: ${persona.substring(0, 200)}` : ''}
${specialty ? `Expertise: ${specialty.substring(0, 100)}` : ''}
Style: Cinematic, dramatic lighting, dark moody background, professional attire (suit or tactical gear), confident expression, spy thriller aesthetic. 
High quality, photorealistic, sharp focus on face, subtle shadows, mysterious atmosphere.
Portrait orientation, head and shoulders composition.`;

    console.log(`Generating avatar for agent: ${agent_name}`);

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash-image-preview',
      messages: [{ role: 'user', content: prompt }],
      functionName: 'generate-agent-avatar',
      extraBody: { modalities: ['image', 'text'] },
      dlqOnFailure: true,
      dlqPayload: { agent_id, agent_name },
    });

    if (aiResult.error) {
      throw new Error(aiResult.error);
    }

    const imageData = aiResult.raw?.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageData) {
      throw new Error('No image generated from AI');
    }

    const base64Match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Invalid image data format');
    }

    const imageFormat = base64Match[1];
    const base64Data = base64Match[2];
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const fileName = `${agent_id}/avatar-${Date.now()}.${imageFormat}`;
    
    const { error: uploadError } = await supabase.storage
      .from('agent-avatars')
      .upload(fileName, imageBytes, { contentType: `image/${imageFormat}`, upsert: true });

    if (uploadError) throw new Error(`Failed to upload avatar: ${uploadError.message}`);

    const { data: publicUrlData } = supabase.storage.from('agent-avatars').getPublicUrl(fileName);
    const avatarUrl = publicUrlData.publicUrl;

    const { error: updateError } = await supabase
      .from('ai_agents')
      .update({ avatar_image: avatarUrl, updated_at: new Date().toISOString() })
      .eq('id', agent_id);

    if (updateError) throw new Error(`Failed to update agent: ${updateError.message}`);

    console.log(`Avatar generated successfully for ${agent_name}: ${avatarUrl}`);

    return new Response(
      JSON.stringify({ success: true, avatar_url: avatarUrl, message: `Avatar generated for ${agent_name}` }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error generating avatar:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});