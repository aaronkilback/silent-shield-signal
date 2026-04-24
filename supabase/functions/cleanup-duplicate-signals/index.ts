import { createClient } from "npm:@supabase/supabase-js@2";

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

// Calculate text similarity using Levenshtein distance
function calculateSimilarity(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  
  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;
  
  const maxLen = Math.max(len1, len2);
  const distance = levenshteinDistance(str1, str2);
  return 1 - (distance / maxLen);
}

function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[len1][len2];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting duplicate signal cleanup with near-duplicate detection...');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Get all signals without content_hash and update them
    const { data: signalsWithoutHash, error: fetchError } = await supabase
      .from('signals')
      .select('id, normalized_text')
      .is('content_hash', null);

    if (fetchError) {
      throw new Error(`Failed to fetch signals: ${fetchError.message}`);
    }

    console.log(`Found ${signalsWithoutHash?.length || 0} signals without content_hash`);

    for (const signal of signalsWithoutHash || []) {
      if (!signal.normalized_text) continue;
      const hash = await hashContent(signal.normalized_text);
      await supabase
        .from('signals')
        .update({ content_hash: hash })
        .eq('id', signal.id);
    }

    console.log('Content hashes updated successfully');

    // Step 2: Get all signals grouped by client for near-duplicate detection
    const { data: allSignals, error: signalsError } = await supabase
      .from('signals')
      .select('id, normalized_text, content_hash, client_id, created_at')
      .order('created_at', { ascending: true });

    if (signalsError) {
      throw new Error(`Failed to fetch signals: ${signalsError.message}`);
    }

    console.log(`Processing ${allSignals?.length || 0} signals for near-duplicates`);

    // Group signals by client
    const clientSignals = new Map<string, any[]>();
    for (const signal of allSignals || []) {
      const clientId = signal.client_id || 'no-client';
      if (!clientSignals.has(clientId)) {
        clientSignals.set(clientId, []);
      }
      clientSignals.get(clientId)!.push(signal);
    }

    let deletedCount = 0;
    const duplicateGroups: string[] = [];

    // Process each client's signals
    for (const [clientId, signals] of clientSignals.entries()) {
      console.log(`Processing ${signals.length} signals for client ${clientId}`);
      
      const processed = new Set<string>();
      
      for (let i = 0; i < signals.length; i++) {
        const signal1 = signals[i];
        if (!signal1.normalized_text || processed.has(signal1.id)) continue;
        
        const toDelete: string[] = [];
        processed.add(signal1.id);
        
        for (let j = i + 1; j < signals.length; j++) {
          const signal2 = signals[j];
          if (!signal2.normalized_text || processed.has(signal2.id)) continue;
          
          // Check exact hash match
          if (signal1.content_hash && signal1.content_hash === signal2.content_hash) {
            toDelete.push(signal2.id);
            processed.add(signal2.id);
            continue;
          }
          
          // Check near-duplicate (>90% similarity)
          const similarity = calculateSimilarity(
            signal1.normalized_text.toLowerCase().trim(),
            signal2.normalized_text.toLowerCase().trim()
          );
          
          if (similarity > 0.90) {
            console.log(`Found near-duplicate: ${similarity.toFixed(2)} similarity`);
            toDelete.push(signal2.id);
            processed.add(signal2.id);
          }
        }
        
        if (toDelete.length > 0) {
          duplicateGroups.push(`${signal1.id} (kept ${toDelete.length} duplicates)`);
          
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
      }
    }

    console.log(`Cleanup complete: deleted ${deletedCount} duplicate/near-duplicate signals`);

    return new Response(
      JSON.stringify({
        success: true,
        hashesUpdated: signalsWithoutHash?.length || 0,
        duplicateGroups: duplicateGroups.length,
        deleted: deletedCount,
        message: `Successfully cleaned up ${deletedCount} duplicate and near-duplicate signals`
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
