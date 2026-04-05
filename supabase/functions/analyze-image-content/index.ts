import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { image_url, client_context } = await req.json();
    console.log('Analyzing image:', image_url);

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    

    // Build context-aware prompt
    let analysisPrompt = `Analyze this image for security intelligence purposes. Identify:
- Objects of security relevance (weapons, protest signs, vehicles, damaged infrastructure, logos/uniforms)
- Crowd density and activity type
- Any visible text or signage
- Environmental/location indicators
- Threat indicators or security concerns`;

    if (client_context) {
      analysisPrompt += `\n\nClient context: ${JSON.stringify(client_context)}`;
    }

    // Use Lovable AI vision model
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: analysisPrompt },
              { type: 'image_url', image_url: { url: image_url } }
            ]
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI Gateway error:', response.status, errorText);
      throw new Error('AI Gateway error');
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content;

    if (!analysis) {
      throw new Error('No analysis generated');
    }

    console.log('Image analysis complete');

    return successResponse({
      success: true,
      analysis,
      image_url,
      analyzed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in analyze-image-content:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
