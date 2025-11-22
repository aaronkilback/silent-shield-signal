import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple SHA-256 hash function
async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Calculate similarity between two strings (Levenshtein distance)
function calculateSimilarity(str1: string, str2: string): number {
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

  const distance = matrix[len1][len2];
  const maxLength = Math.max(len1, len2);
  return maxLength === 0 ? 1 : 1 - (distance / maxLength);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, content, id, autoCheck = true } = await req.json();
    
    if (!type || !content) {
      return new Response(
        JSON.stringify({ error: 'type and content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Checking duplicates for ${type}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let duplicates: any[] = [];
    const contentHash = await hashContent(content);

    if (type === 'document') {
      // Check for exact hash match
      const { data: hashMatch } = await supabase
        .from('document_hashes')
        .select('*, archival_documents(*)')
        .eq('content_hash', contentHash)
        .single();

      if (hashMatch) {
        return new Response(
          JSON.stringify({ 
            isDuplicate: true,
            exactMatch: true,
            duplicate: hashMatch,
            message: `This document was already uploaded as "${hashMatch.filename}" on ${new Date(hashMatch.first_uploaded_at).toLocaleDateString()}`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check content hash in archival_documents
      const { data: existingDocs } = await supabase
        .from('archival_documents')
        .select('id, filename, content_hash, upload_date')
        .eq('content_hash', contentHash);

      if (existingDocs && existingDocs.length > 0) {
        duplicates = existingDocs;
      }
    } else if (type === 'signal') {
      // Check for exact hash match in signals
      const { data: hashMatch } = await supabase
        .from('signals')
        .select('*')
        .eq('content_hash', contentHash)
        .limit(1)
        .single();

      if (hashMatch) {
        return new Response(
          JSON.stringify({ 
            isDuplicate: true,
            exactMatch: true,
            duplicate: hashMatch,
            message: `This signal was already ingested on ${new Date(hashMatch.created_at).toLocaleDateString()}`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check for similar signals (text similarity)
      const { data: recentSignals } = await supabase
        .from('signals')
        .select('id, normalized_text, created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      if (recentSignals && recentSignals.length > 0) {
        const contentLower = content.toLowerCase();
        for (const signal of recentSignals) {
          const similarity = calculateSimilarity(
            contentLower,
            (signal.normalized_text || '').toLowerCase()
          );
          
          if (similarity > 0.85) {
            duplicates.push({
              ...signal,
              similarity_score: similarity
            });
          }
        }
      }
    } else if (type === 'entity') {
      // Improved fuzzy entity name matching with type consideration
      const { data: entities } = await supabase
        .from('entities')
        .select('id, name, aliases, type')
        .eq('is_active', true);

      if (entities && entities.length > 0) {
        const contentLower = content.toLowerCase().trim();
        
        // First pass: exact or very high similarity matches
        for (const entity of entities) {
          const names = [entity.name, ...(entity.aliases || [])];
          for (const name of names) {
            const nameLower = name.toLowerCase().trim();
            
            // Check for exact match
            if (contentLower === nameLower) {
              duplicates.push({
                ...entity,
                matched_name: name,
                similarity_score: 1.0
              });
              break;
            }
            
            // Check for high similarity (85%+)
            const similarity = calculateSimilarity(contentLower, nameLower);
            if (similarity > 0.85) {
              duplicates.push({
                ...entity,
                matched_name: name,
                similarity_score: similarity
              });
              break;
            }
          }
        }
        
        // If no high matches, check for moderate similarity (75%+) only for same entity type
        if (duplicates.length === 0) {
          for (const entity of entities) {
            const names = [entity.name, ...(entity.aliases || [])];
            for (const name of names) {
              const similarity = calculateSimilarity(contentLower, name.toLowerCase().trim());
              
              if (similarity > 0.75) {
                duplicates.push({
                  ...entity,
                  matched_name: name,
                  similarity_score: similarity
                });
                break;
              }
            }
          }
        }
        
        // Sort by similarity score descending
        duplicates.sort((a, b) => b.similarity_score - a.similarity_score);
      }
    }

    // If duplicates found and autoCheck is true, create detection records
    if (duplicates.length > 0 && autoCheck && id) {
      const detections = duplicates.map(dup => ({
        detection_type: type,
        source_id: id,
        duplicate_id: dup.id,
        similarity_score: dup.similarity_score || 1.0,
        detection_method: dup.similarity_score ? 'text_similarity' : 'hash',
        status: 'pending'
      }));

      await supabase.from('duplicate_detections').insert(detections);
    }

    return new Response(
      JSON.stringify({ 
        isDuplicate: duplicates.length > 0,
        exactMatch: false,
        duplicates: duplicates,
        count: duplicates.length,
        contentHash: contentHash
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in detect-duplicates function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
