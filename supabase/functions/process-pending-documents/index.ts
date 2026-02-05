import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    console.log('Fetching pending documents...');

    // Get all pending documents
    const { data: pendingDocs, error: fetchError } = await supabase
      .from('ingested_documents')
      .select('id, title, created_at')
      .eq('processing_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

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
        
        const { error: invokeError } = await supabase.functions.invoke(
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

    return successResponse({
      success: true,
      total: pendingDocs?.length || 0,
      processed,
      failed
    });

  } catch (error) {
    console.error('Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
