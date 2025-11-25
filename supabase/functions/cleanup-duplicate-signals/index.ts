import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate SHA-256 hash
async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting duplicate signal cleanup...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Get all signals without content_hash
    const { data: signals, error: fetchError } = await supabase
      .from('signals')
      .select('id, normalized_text')
      .is('content_hash', null);

    if (fetchError) {
      throw new Error(`Failed to fetch signals: ${fetchError.message}`);
    }

    console.log(`Found ${signals?.length || 0} signals without content_hash`);

    // Step 2: Calculate and update content_hash for each signal
    const hashUpdates = [];
    const hashMap = new Map<string, string[]>(); // hash -> signal IDs

    for (const signal of signals || []) {
      if (!signal.normalized_text) continue;
      
      const hash = await hashContent(signal.normalized_text);
      hashUpdates.push({ id: signal.id, hash });
      
      // Track which signals have the same hash
      if (!hashMap.has(hash)) {
        hashMap.set(hash, []);
      }
      hashMap.get(hash)!.push(signal.id);
    }

    console.log(`Calculated ${hashUpdates.length} content hashes`);

    // Step 3: Update all signals with their content_hash
    for (const update of hashUpdates) {
      await supabase
        .from('signals')
        .update({ content_hash: update.hash })
        .eq('id', update.id);
    }

    console.log('Content hashes updated successfully');

    // Step 4: Identify and remove exact duplicates (keep oldest)
    const duplicateGroups = Array.from(hashMap.entries())
      .filter(([_, ids]) => ids.length > 1);

    console.log(`Found ${duplicateGroups.length} groups of duplicate signals`);

    let deletedCount = 0;
    for (const [hash, signalIds] of duplicateGroups) {
      // Keep the first signal, delete the rest
      const toDelete = signalIds.slice(1);
      
      console.log(`Deleting ${toDelete.length} duplicates for hash ${hash.substring(0, 16)}...`);
      
      const { error: deleteError } = await supabase
        .from('signals')
        .delete()
        .in('id', toDelete);

      if (deleteError) {
        console.error(`Failed to delete duplicates: ${deleteError.message}`);
      } else {
        deletedCount += toDelete.length;
      }
    }

    console.log(`Cleanup complete: deleted ${deletedCount} duplicate signals`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: signals?.length || 0,
        duplicateGroups: duplicateGroups.length,
        deleted: deletedCount,
        message: `Successfully cleaned up ${deletedCount} duplicate signals`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in cleanup-duplicate-signals:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

