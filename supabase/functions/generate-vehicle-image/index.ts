import { handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { prompt } = await req.json();
    
    if (!prompt) {
      return errorResponse('Prompt is required', 400);
    }

    console.log('[VehicleImage] Generating vehicle image with prompt:', prompt.substring(0, 100));

    const result = await callAiGateway({
      model: 'google/gemini-2.5-flash-image-preview',
      messages: [
        {
          role: 'user',
          content: `Generate a realistic, high-quality image of a vehicle. ${prompt}. The image should be clear, professional, and show the vehicle from a front-angled perspective in good lighting.`
        }
      ],
      functionName: 'generate-vehicle-image',
      extraBody: { modalities: ['image', 'text'] },
      retries: 1,
    });

    if (result.error) {
      if (result.error.includes('429')) {
        return errorResponse('Rate limit exceeded. Please try again later.', 429);
      }
      if (result.error.includes('402')) {
        return errorResponse('Payment required. Please add credits.', 402);
      }
      throw new Error(result.error);
    }

    const imageUrl = result.raw?.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!imageUrl) {
      throw new Error('No image generated in response');
    }

    console.log('[VehicleImage] Vehicle image generated successfully');

    return successResponse({ imageUrl });

  } catch (error) {
    console.error('[VehicleImage] Error:', error);
    await logError(error, { functionName: 'generate-vehicle-image', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
