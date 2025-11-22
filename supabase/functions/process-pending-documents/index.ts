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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Fetching pending documents...');

    // Get all pending documents
    const { data: pendingDocs, error: fetchError } = await supabaseClient
      .from('ingested_documents')
      .select('id, title, created_at')
      .eq('processing_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50); // Process in batches

    if (fetchError) {
      throw fetchError;
    }

    console.log(`Found ${pendingDocs?.length || 0} pending documents`);

    let processed = 0;
    let failed = 0;

    // Process each document
    for (const doc of pendingDocs || []) {
      try {
        console.log(`Processing document: ${doc.title}`);
        
        const { error: invokeError } = await supabaseClient.functions.invoke(
          'process-intelligence-document',
          {
            body: { documentId: doc.id }
          }
        );

        if (invokeError) {
          console.error(`Failed to process ${doc.id}:`, invokeError);
          failed++;
        } else {
          processed++;
        }

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error processing document ${doc.id}:`, error);
        failed++;
      }
    }

    console.log(`Batch complete: ${processed} processed, ${failed} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        total: pendingDocs?.length || 0,
        processed,
        failed
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
