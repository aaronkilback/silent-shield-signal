import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// Access EdgeRuntime from global scope
declare const EdgeRuntime: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessRequest {
  documentIds: string[];
  clearExistingSuggestions: boolean;
}

// Handle function shutdown gracefully
addEventListener('beforeunload', (ev) => {
  console.log('Function shutdown due to:', (ev as any).detail?.reason);
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { documentIds, clearExistingSuggestions }: ProcessRequest = await req.json();

    console.log(`Starting batch processing of ${documentIds.length} documents`);

    // Clear existing suggestions if requested
    if (clearExistingSuggestions && documentIds.length > 0) {
      console.log('Clearing existing entity suggestions...');
      await supabase
        .from('entity_suggestions')
        .delete()
        .in('source_id', documentIds)
        .eq('source_type', 'archival_document');
    }

    // Process documents in background to avoid timeout
    const processDocuments = async () => {
      let successful = 0;
      let failed = 0;

      for (const docId of documentIds) {
        try {
          console.log(`Processing document ${successful + failed + 1}/${documentIds.length}: ${docId}`);
          
          // Use stored document processor (downloads files and extracts text)
          const { data, error } = await supabase.functions.invoke('process-stored-document', {
            body: { documentId: docId }
          });

          if (error || data?.error) {
            console.error(`Failed to process document ${docId}:`, error || data?.error);
            failed++;
          } else {
            successful++;
          }

          // Small delay between requests to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Error processing document ${docId}:`, error);
          failed++;
        }
      }

      console.log(`Batch processing complete: ${successful} successful, ${failed} failed`);
    };

    // Start background processing without blocking response
    EdgeRuntime.waitUntil(processDocuments());

    // Return immediately
    return new Response(
      JSON.stringify({
        message: 'Batch processing started',
        totalDocuments: documentIds.length,
        status: 'processing'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 202 // Accepted - processing in background
      }
    );

  } catch (error: any) {
    console.error('Error in batch processing:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
