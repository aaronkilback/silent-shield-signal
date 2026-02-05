import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { primary_signal_id, duplicate_signal_ids, similarity_scores, rationale } = await req.json();

    if (!primary_signal_id || !duplicate_signal_ids || duplicate_signal_ids.length === 0) {
      return errorResponse('primary_signal_id and duplicate_signal_ids are required', 400);
    }

    const supabase = createServiceClient();

    console.log(`Creating merge proposal for primary signal ${primary_signal_id} with ${duplicate_signal_ids.length} duplicates`);

    // Verify signals exist
    const { data: primarySignal, error: primaryError } = await supabase
      .from('signals')
      .select('id, normalized_text, category, severity, created_at')
      .eq('id', primary_signal_id)
      .single();

    if (primaryError || !primarySignal) {
      return errorResponse('Primary signal not found', 404);
    }

    const { data: duplicateSignals, error: duplicateError } = await supabase
      .from('signals')
      .select('id, normalized_text, category, severity, created_at')
      .in('id', duplicate_signal_ids);

    if (duplicateError || !duplicateSignals || duplicateSignals.length === 0) {
      return errorResponse('Duplicate signals not found', 404);
    }

    // Create merge proposal
    const { data: proposal, error: insertError } = await supabase
      .from('signal_merge_proposals')
      .insert({
        primary_signal_id,
        duplicate_signal_ids,
        similarity_scores: similarity_scores || [],
        status: 'pending',
        proposed_by: 'ai_assistant',
        merge_rationale: rationale || 'AI-detected near-duplicate signals with high similarity',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating merge proposal:', insertError);
      return errorResponse(`Failed to create merge proposal: ${insertError.message}`, 500);
    }

    console.log(`Created merge proposal ${proposal.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        proposal_id: proposal.id,
        primary_signal: {
          id: primarySignal.id,
          text: primarySignal.normalized_text?.substring(0, 200),
          category: primarySignal.category,
          severity: primarySignal.severity,
        },
        duplicates: duplicateSignals.map((s, idx) => ({
          id: s.id,
          text: s.normalized_text?.substring(0, 200),
          category: s.category,
          severity: s.severity,
          similarity: similarity_scores?.[idx] || 0,
        })),
        status: 'pending',
        message: `Merge proposal created successfully. Awaiting human review.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in propose-signal-merge:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
