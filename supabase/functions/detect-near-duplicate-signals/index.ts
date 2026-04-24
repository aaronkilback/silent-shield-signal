import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Calculate Levenshtein distance-based similarity
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { threshold = 0.90, limit = 100, signal_id } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Query for recent signals
    let query = supabase
      .from('signals')
      .select('id, normalized_text, created_at, category, severity, client_id, sources_mentioned')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (signal_id) {
      // Find duplicates for a specific signal
      query = query.neq('id', signal_id);
    }

    const { data: signals, error } = await query;

    if (error) {
      console.error('Error fetching signals:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch signals' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!signals || signals.length === 0) {
      return new Response(
        JSON.stringify({ duplicate_clusters: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let targetSignal = null;
    if (signal_id) {
      const { data: target } = await supabase
        .from('signals')
        .select('id, normalized_text, created_at, category, severity, client_id, sources_mentioned')
        .eq('id', signal_id)
        .single();
      targetSignal = target;
    }

    // Find near-duplicates
    const clusters: any[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < signals.length; i++) {
      if (processed.has(signals[i].id)) continue;

      const compareText = targetSignal ? targetSignal.normalized_text : signals[i].normalized_text;
      const cluster = {
        primary_signal: targetSignal || signals[i],
        duplicates: [] as any[],
        similarity_scores: [] as number[],
      };

      for (let j = targetSignal ? 0 : i + 1; j < signals.length; j++) {
        if (targetSignal && signals[j].id === signal_id) continue;
        if (!targetSignal && processed.has(signals[j].id)) continue;

        const similarity = calculateSimilarity(
          compareText?.toLowerCase() || '',
          signals[j].normalized_text?.toLowerCase() || ''
        );

        if (similarity >= threshold) {
          cluster.duplicates.push(signals[j]);
          cluster.similarity_scores.push(similarity);
          processed.add(signals[j].id);
        }
      }

      if (cluster.duplicates.length > 0) {
        clusters.push(cluster);
        if (targetSignal) break; // Only one cluster needed for specific signal
      }
    }

    console.log(`Found ${clusters.length} near-duplicate clusters with threshold ${threshold}`);

    return new Response(
      JSON.stringify({
        threshold,
        total_signals_analyzed: signals.length,
        duplicate_clusters: clusters,
        cluster_count: clusters.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in detect-near-duplicate-signals:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
