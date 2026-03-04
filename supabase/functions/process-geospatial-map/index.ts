import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

interface ProcessRequest {
  mapId: string;
  storagePath: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();

  try {
    const { mapId, storagePath }: ProcessRequest = await req.json();

    if (!mapId || !storagePath) {
      return errorResponse('Missing mapId or storagePath', 400);
    }

    // Update status to processing
    await supabase
      .from('geospatial_maps')
      .update({ processing_status: 'processing' })
      .eq('id', mapId);

    // Background processing using waitUntil
    const backgroundTask = async () => {
      try {
        // Get signed URL for the file
        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from('geospatial-maps')
          .createSignedUrl(storagePath, 3600);

        if (signedUrlError || !signedUrlData?.signedUrl) {
          throw new Error(`Failed to get signed URL: ${signedUrlError?.message}`);
        }

        const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';

        // Use AI to extract asset information from the map
        const extractionPrompt = `You are analyzing a georeferenced PDF map of Petronas Canada assets. 
Extract ALL identifiable assets, facilities, roads, pipelines, and infrastructure from this map.

For each asset, provide:
1. asset_name: The name or identifier visible on the map
2. asset_type: Type (e.g., "well site", "pipeline", "road", "facility", "compressor station", etc.)
3. latitude: If coordinates are visible or can be inferred
4. longitude: If coordinates are visible or can be inferred  
5. location_description: Descriptive location (e.g., "NE of Grande Prairie", "along Highway 40")
6. region: General region or area name

Return as JSON array of assets. Be thorough - extract every identifiable feature.`;

        const aiResult = await callAiGateway({
          model: 'gemini-2.5-pro',
          messages: [
            { role: 'user', content: extractionPrompt }
          ],
          functionName: 'process-geospatial-map',
          extraBody: {
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: extractionPrompt },
                  { type: 'image_url', image_url: { url: signedUrlData.signedUrl } }
                ]
              }
            ],
            response_format: { type: 'json_object' }
          },
        });

        if (aiResult.error) {
          // Fallback: create placeholder entry for manual processing
          console.log('AI extraction unavailable, creating placeholder for manual entry');
          
          await supabase
            .from('petronas_assets')
            .insert({
              asset_name: 'Petronas Canada Road Network',
              asset_type: 'road_network',
              location_description: 'Extracted from uploaded map - requires manual coordinate entry',
              region: 'Alberta/BC',
              source_document_id: mapId,
              metadata: { 
                source_file: storagePath,
                requires_manual_processing: true,
                uploaded_at: new Date().toISOString()
              }
            });

          await supabase
            .from('geospatial_maps')
            .update({ 
              processing_status: 'manual_required',
              extracted_assets_count: 1,
              error_message: 'AI extraction unavailable - placeholder created for manual processing'
            })
            .eq('id', mapId);

          return;
        }

        const extractedContent = aiResult.content || '{"assets":[]}';
        
        let assets: any[] = [];
        try {
          const parsed = JSON.parse(extractedContent);
          assets = parsed.assets || parsed || [];
        } catch {
          console.error('Failed to parse AI response');
        }

        // Insert extracted assets
        if (assets.length > 0) {
          const assetsToInsert = assets.map((asset: any) => ({
            asset_name: asset.asset_name || asset.name || 'Unknown Asset',
            asset_type: asset.asset_type || asset.type || 'unknown',
            latitude: asset.latitude ? parseFloat(asset.latitude) : null,
            longitude: asset.longitude ? parseFloat(asset.longitude) : null,
            location_description: asset.location_description || asset.location || null,
            region: asset.region || 'Alberta/BC',
            source_document_id: mapId,
            metadata: { extracted_data: asset }
          }));

          await supabase
            .from('petronas_assets')
            .insert(assetsToInsert);
        }

        // Update map record with success
        await supabase
          .from('geospatial_maps')
          .update({ 
            processing_status: 'complete',
            extracted_assets_count: assets.length
          })
          .eq('id', mapId);

      } catch (error) {
        console.error('Background processing error:', error);
        await supabase
          .from('geospatial_maps')
          .update({ 
            processing_status: 'error',
            error_message: error instanceof Error ? error.message : 'Processing failed'
          })
          .eq('id', mapId);
      }
    };

    // Use EdgeRuntime.waitUntil for background processing
    // @ts-ignore - EdgeRuntime is available in Supabase Edge Functions
    if (typeof globalThis.EdgeRuntime !== 'undefined' && globalThis.EdgeRuntime.waitUntil) {
      // @ts-ignore
      globalThis.EdgeRuntime.waitUntil(backgroundTask());
    } else {
      // Fallback: run inline
      await backgroundTask();
    }

    return successResponse({ 
      success: true, 
      message: 'Processing started',
      mapId 
    });

  } catch (error) {
    console.error('Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Processing failed', 500);
  }
});
