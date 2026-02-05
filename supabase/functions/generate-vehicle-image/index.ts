import { handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { prompt } = await req.json();
    
    if (!prompt) {
      return errorResponse('Prompt is required', 400);
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('[VehicleImage] LOVABLE_API_KEY not configured');
      return errorResponse('AI service not configured', 500);
    }

    console.log('[VehicleImage] Generating vehicle image with prompt:', prompt.substring(0, 100));

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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
            content: `Generate a realistic, high-quality image of a vehicle. ${prompt}. The image should be clear, professional, and show the vehicle from a front-angled perspective in good lighting.`
          }
        ],
        modalities: ['image', 'text']
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[VehicleImage] AI Gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return errorResponse('Rate limit exceeded. Please try again later.', 429);
      }
      
      if (response.status === 402) {
        return errorResponse('Payment required. Please add credits.', 402);
      }
      
      throw new Error(`AI Gateway error: ${response.status}`);
    }

    const data = await response.json();
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      throw new Error('No image generated in response');
    }

    console.log('[VehicleImage] Vehicle image generated successfully');

    return successResponse({ imageUrl });

  } catch (error) {
    console.error('[VehicleImage] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
