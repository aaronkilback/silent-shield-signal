import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { primary_signal_id, duplicate_signal_ids, similarity_scores, rationale } = await req.json();

    if (!primary_signal_id || !duplicate_signal_ids || duplicate_signal_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'primary_signal_id and duplicate_signal_ids are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Creating merge proposal for primary signal ${primary_signal_id} with ${duplicate_signal_ids.length} duplicates`);

    // Verify signals exist
    const { data: primarySignal, error: primaryError } = await supabase
      .from('signals')
      .select('id, normalized_text, category, severity, created_at')
      .eq('id', primary_signal_id)
      .single();

    if (primaryError || !primarySignal) {
      return new Response(
        JSON.stringify({ error: 'Primary signal not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: duplicateSignals, error: duplicateError } = await supabase
      .from('signals')
      .select('id, normalized_text, category, severity, created_at')
      .in('id', duplicate_signal_ids);

    if (duplicateError || !duplicateSignals || duplicateSignals.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Duplicate signals not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'Failed to create merge proposal', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
