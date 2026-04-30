import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { enqueueJob } from "../_shared/queue.ts";

// Access EdgeRuntime from global scope
declare const EdgeRuntime: any;

interface ProcessRequest {
  documentIds: string[];
  clearExistingSuggestions: boolean;
}

// Handle function shutdown gracefully
addEventListener('beforeunload', (ev) => {
  console.log('Function shutdown due to:', (ev as any).detail?.reason);
});

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

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

    // Trigger individual processing jobs without waiting
    const processDocuments = async () => {
      console.log('Triggering parallel processing jobs for all documents...');
      
      const promises = documentIds.map(async (docId, index) => {
        try {
          console.log(`Enqueueing processing job ${index + 1}/${documentIds.length}: ${docId}`);
          // Durable queue — was fire-and-forget invoke.
          await enqueueJob(supabase, {
            type: 'process-stored-document',
            payload: { documentId: docId },
            idempotencyKey: `process-stored-document:${docId}`,
          }).catch(err => console.error(`Failed to enqueue processing for ${docId}:`, err));
        } catch (error) {
          console.error(`Error enqueueing processing for ${docId}:`, error);
        }
      });
      
      await Promise.all(promises);
      console.log(`Triggered ${documentIds.length} processing jobs`);
    };

    // Start background processing without blocking response
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(processDocuments());
    } else {
      // Fallback: run inline but don't await
      processDocuments().catch(err => console.error('Background processing error:', err));
    }

    // Return immediately
    return new Response(
      JSON.stringify({
        message: 'Batch processing started',
        totalDocuments: documentIds.length,
        status: 'processing'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 202
      }
    );

  } catch (error: any) {
    console.error('Error in batch processing:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
