import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessRequest {
  documentIds: string[];
  clearExistingSuggestions: boolean;
}

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

    let successful = 0;
    let failed = 0;

    // Clear existing suggestions if requested
    if (clearExistingSuggestions && documentIds.length > 0) {
      console.log('Clearing existing entity suggestions...');
      await supabase
        .from('entity_suggestions')
        .delete()
        .in('source_id', documentIds)
        .eq('source_type', 'archival_document');
    }

    // Process all documents
    for (const docId of documentIds) {
      try {
        console.log(`Processing document ${successful + failed + 1}/${documentIds.length}: ${docId}`);
        
        const { data, error } = await supabase.functions.invoke('process-stored-document', {
          body: { documentId: docId }
        });

        if (error || data?.error) {
          console.error(`Failed to process document ${docId}:`, error || data?.error);
          failed++;
        } else {
          successful++;
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error processing document ${docId}:`, error);
        failed++;
      }
    }

    console.log(`Batch processing complete: ${successful} successful, ${failed} failed`);

    return new Response(
      JSON.stringify({
        message: 'Processing complete',
        successful,
        failed,
        total: documentIds.length
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
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
