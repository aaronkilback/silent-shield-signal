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

    // First, create ingested_documents records from archival_documents
    for (const docId of documentIds) {
      try {
        // Get archival document
        const { data: archivalDoc } = await supabase
          .from('archival_documents')
          .select('*')
          .eq('id', docId)
          .single();

        if (!archivalDoc) {
          console.error(`Archival document not found: ${docId}`);
          continue;
        }

        // Download and extract text content
        const { data: fileData } = await supabase.storage
          .from('archival-documents')
          .download(archivalDoc.storage_path);

        if (!fileData) {
          console.error(`Could not download file: ${archivalDoc.filename}`);
          continue;
        }

        // For PDFs, we'll store a reference and let the processor handle extraction
        // Create ingested_document record
        const { data: ingestedDoc, error: insertError } = await supabase
          .from('ingested_documents')
          .insert({
            title: archivalDoc.filename,
            raw_text: archivalDoc.content_text || '',
            content_hash: archivalDoc.content_hash,
            processing_status: 'pending',
            metadata: {
              archival_document_id: archivalDoc.id,
              storage_path: archivalDoc.storage_path,
              file_type: archivalDoc.file_type
            }
          })
          .select()
          .single();

        if (insertError || !ingestedDoc) {
          console.error(`Failed to create ingested document for ${docId}:`, insertError);
          continue;
        }

        console.log(`Created ingested document ${ingestedDoc.id} for archival doc ${docId}`);

      } catch (error) {
        console.error(`Error preparing document ${docId}:`, error);
      }
    }

    // Now get all pending ingested documents for this batch
    const { data: ingestedDocs } = await supabase
      .from('ingested_documents')
      .select('id, metadata')
      .eq('processing_status', 'pending')
      .in('metadata->>archival_document_id', documentIds);

    const ingestedDocIds = ingestedDocs?.map(d => d.id) || [];

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

    // Process documents in background to avoid timeout
    const processDocuments = async () => {
      let successful = 0;
      let failed = 0;

      for (const docId of ingestedDocIds) {
        try {
          console.log(`Processing document ${successful + failed + 1}/${ingestedDocIds.length}: ${docId}`);
          
          // Use intelligence document processor for aggressive extraction
          const { data, error } = await supabase.functions.invoke('process-intelligence-document', {
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
        totalDocuments: ingestedDocIds.length,
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
