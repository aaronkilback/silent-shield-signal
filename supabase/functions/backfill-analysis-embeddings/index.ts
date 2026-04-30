/**
 * One-shot backfill of embeddings for signal_agent_analyses rows that
 * existed before the embedding column was added (2026-04-30 capability
 * uplift). Runs in batches, processes a few rows per invocation, returns
 * a summary. Re-invoke until "remaining": 0.
 *
 * Not scheduled — intentionally manual since this is one-time. After every
 * row has an embedding, the retrieve_similar_past_decisions tool's vector
 * path covers everything.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { embedText } from "../_shared/embed.ts";

const BATCH_SIZE = 25;

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const supabase = createServiceClient();
  try {
    const { data: rows, error: fetchError } = await supabase
      .from('signal_agent_analyses')
      .select('id, analysis')
      .is('embedding', null)
      .not('analysis', 'is', null)
      .limit(BATCH_SIZE);
    if (fetchError) throw fetchError;
    if (!rows || rows.length === 0) {
      return successResponse({ processed: 0, remaining: 0, message: 'All rows already have embeddings.' });
    }
    let success = 0;
    let failed = 0;
    for (const row of rows) {
      const vec = await embedText((row as any).analysis || '');
      if (!vec) { failed++; continue; }
      const { error: updateError } = await supabase
        .from('signal_agent_analyses')
        .update({ embedding: vec })
        .eq('id', (row as any).id);
      if (updateError) { failed++; console.warn('Update failed:', updateError.message); }
      else success++;
    }
    // Count remaining for client visibility
    const { count: remaining } = await supabase
      .from('signal_agent_analyses')
      .select('id', { count: 'exact', head: true })
      .is('embedding', null);

    return successResponse({ processed: rows.length, success, failed, remaining: remaining ?? 0 });
  } catch (error) {
    console.error('[backfill-analysis-embeddings] Fatal:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
