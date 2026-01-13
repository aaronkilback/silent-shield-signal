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
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { agent_id, agent_name, persona, specialty } = await req.json();

    if (!agent_id || !agent_name) {
      return new Response(
        JSON.stringify({ error: 'agent_id and agent_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build a descriptive prompt for the agent avatar
    const prompt = `Professional portrait photograph of a sophisticated intelligence agent or security professional named "${agent_name}". 
${persona ? `Character traits: ${persona.substring(0, 200)}` : ''}
${specialty ? `Expertise: ${specialty.substring(0, 100)}` : ''}
Style: Cinematic, dramatic lighting, dark moody background, professional attire (suit or tactical gear), confident expression, spy thriller aesthetic. 
High quality, photorealistic, sharp focus on face, subtle shadows, mysterious atmosphere.
Portrait orientation, head and shoulders composition.`;

    console.log(`Generating avatar for agent: ${agent_name}`);

    // Call Lovable AI Gateway for image generation
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image-preview',
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        modalities: ['image', 'text'],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI Gateway error:', errorText);
      throw new Error(`AI Gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const imageData = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageData) {
      throw new Error('No image generated from AI');
    }

    // Extract base64 data
    const base64Match = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Invalid image data format');
    }

    const imageFormat = base64Match[1];
    const base64Data = base64Match[2];
    const imageBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    // Upload to Supabase Storage
    const fileName = `${agent_id}/avatar-${Date.now()}.${imageFormat}`;
    
    const { error: uploadError } = await supabase.storage
      .from('agent-avatars')
      .upload(fileName, imageBytes, {
        contentType: `image/${imageFormat}`,
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw new Error(`Failed to upload avatar: ${uploadError.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('agent-avatars')
      .getPublicUrl(fileName);

    const avatarUrl = publicUrlData.publicUrl;

    // Update agent record with new avatar
    const { error: updateError } = await supabase
      .from('ai_agents')
      .update({ 
        avatar_image: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', agent_id);

    if (updateError) {
      console.error('Error updating agent:', updateError);
      throw new Error(`Failed to update agent: ${updateError.message}`);
    }

    console.log(`Avatar generated successfully for ${agent_name}: ${avatarUrl}`);

    return new Response(
      JSON.stringify({
        success: true,
        avatar_url: avatarUrl,
        message: `Avatar generated for ${agent_name}`,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
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