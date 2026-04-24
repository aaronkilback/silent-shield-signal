import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { primary_signal_id, duplicate_signal_ids } = await req.json();

    if (!primary_signal_id || !duplicate_signal_ids || duplicate_signal_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'primary_signal_id and duplicate_signal_ids are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Merging ${duplicate_signal_ids.length} signals into primary ${primary_signal_id}`);

    // Get primary signal
    const { data: primarySignal, error: primaryError } = await supabase
      .from('signals')
      .select('*')
      .eq('id', primary_signal_id)
      .single();

    if (primaryError || !primarySignal) {
      return new Response(
        JSON.stringify({ error: 'Primary signal not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get duplicate signals
    const { data: duplicateSignals, error: duplicateError } = await supabase
      .from('signals')
      .select('*')
      .in('id', duplicate_signal_ids);

    if (duplicateError) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch duplicate signals' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Collect all unique sources, tags, entity IDs
    const allSources = new Set(primarySignal.sources_mentioned || []);
    const allTags = new Set([...(primarySignal.rule_tags || []), ...(primarySignal.tags || [])]);
    const allEntityIds = new Set(primarySignal.correlated_entity_ids || []);
    const mergedFromIds: string[] = [];

    for (const duplicate of duplicateSignals || []) {
      (duplicate.sources_mentioned || []).forEach((s: string) => allSources.add(s));
      (duplicate.rule_tags || []).forEach((t: string) => allTags.add(t));
      (duplicate.tags || []).forEach((t: string) => allTags.add(t));
      (duplicate.correlated_entity_ids || []).forEach((e: string) => allEntityIds.add(e));
      mergedFromIds.push(duplicate.id);
    }

    // Update primary signal with consolidated data
    const { error: updateError } = await supabase
      .from('signals')
      .update({
        sources_mentioned: Array.from(allSources),
        rule_tags: Array.from(allTags),
        correlated_entity_ids: Array.from(allEntityIds),
        metadata: {
          ...(primarySignal.metadata || {}),
          merged_from: mergedFromIds,
          merge_timestamp: new Date().toISOString(),
          merge_count: mergedFromIds.length,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', primary_signal_id);

    if (updateError) {
      console.error('Error updating primary signal:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to update primary signal' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark duplicate signals as archived/merged
    const { error: archiveError } = await supabase
      .from('signals')
      .update({
        status: 'archived',
        metadata: {
          archived_reason: 'merged_duplicate',
          merged_into: primary_signal_id,
          merge_timestamp: new Date().toISOString(),
        },
      })
      .in('id', duplicate_signal_ids);

    if (archiveError) {
      console.error('Error archiving duplicate signals:', archiveError);
      // Continue anyway - primary signal was updated
    }

    // Update entity mentions to point to primary signal
    for (const duplicateId of duplicate_signal_ids) {
      await supabase
        .from('entity_mentions')
        .update({ signal_id: primary_signal_id })
        .eq('signal_id', duplicateId);
    }

    // Update signal-document relationships
    const { data: signalDocs } = await supabase
      .from('signal_documents')
      .select('document_id')
      .in('signal_id', duplicate_signal_ids);

    if (signalDocs && signalDocs.length > 0) {
      const docIds = signalDocs.map(sd => sd.document_id);
      
      // Remove old relationships
      await supabase
        .from('signal_documents')
        .delete()
        .in('signal_id', duplicate_signal_ids);

      // Create new relationships with primary signal (avoiding duplicates)
      for (const docId of docIds) {
        await supabase
          .from('signal_documents')
          .upsert({ 
            signal_id: primary_signal_id, 
            document_id: docId 
          }, {
            onConflict: 'signal_id,document_id'
          });
      }
    }

    console.log(`Successfully merged ${duplicate_signal_ids.length} signals into ${primary_signal_id}`);

    return new Response(
      JSON.stringify({
        success: true,
        primary_signal_id,
        merged_signal_ids: duplicate_signal_ids,
        merge_count: duplicate_signal_ids.length,
        consolidated_sources: Array.from(allSources),
        consolidated_tags: Array.from(allTags),
        consolidated_entities: Array.from(allEntityIds),
        message: `Successfully merged ${duplicate_signal_ids.length} duplicate signals into primary signal`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in execute-signal-merge:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
