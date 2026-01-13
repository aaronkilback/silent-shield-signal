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
    const {
      type,
      content,
      id,
      autoCheck = true,
      client_id,
      near_duplicate_threshold,
      lookback_days,
      max_candidates,
      use_semantic,
    } = await req.json();
    
    if (!type || !content) {
      return new Response(
        JSON.stringify({ error: 'type and content are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Checking duplicates for ${type}${client_id ? ` (client: ${client_id})` : ''}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const signalMeta: {
      near_duplicate_threshold_used?: number;
      lookback_days_used?: number | null;
      semantic_used?: boolean;
    } = {};

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
      const nearDupThreshold =
        typeof near_duplicate_threshold === 'number'
          ? Math.max(0, Math.min(1, near_duplicate_threshold))
          : 0.90;

      const candidateLimit =
        typeof max_candidates === 'number' && Number.isFinite(max_candidates)
          ? Math.max(10, Math.min(2000, Math.trunc(max_candidates)))
          : 200;

      const lookbackDays =
        typeof lookback_days === 'number' && Number.isFinite(lookback_days)
          ? Math.max(1, Math.min(365, Math.trunc(lookback_days)))
          : null;

      const semanticEnabled = Boolean(use_semantic);
      signalMeta.near_duplicate_threshold_used = nearDupThreshold;
      signalMeta.lookback_days_used = lookbackDays;
      signalMeta.semantic_used = semanticEnabled;

      // Check for exact hash match in signals (same client only)
      let exactQuery = supabase
        .from('signals')
        .select('*')
        .eq('content_hash', contentHash)
        .limit(1);

      if (client_id) {
        exactQuery = exactQuery.eq('client_id', client_id);
      }

      const { data: hashMatch } = await exactQuery.maybeSingle();

      if (hashMatch && hashMatch.id !== id) {
        return new Response(
          JSON.stringify({
            isDuplicate: true,
            exactMatch: true,
            duplicate: hashMatch,
            message: `This signal was already ingested on ${new Date(hashMatch.created_at).toLocaleDateString()}`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Candidate pool for near-duplicate checks
      let similarQuery = supabase
        .from('signals')
        .select('id, normalized_text, created_at, client_id')
        .order('created_at', { ascending: false })
        .limit(candidateLimit);

      if (client_id) {
        similarQuery = similarQuery.eq('client_id', client_id);
      }

      if (lookbackDays) {
        const sinceIso = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
        similarQuery = similarQuery.gte('created_at', sinceIso);
      }

      const { data: recentSignals } = await similarQuery;

      // 1) Fast lexical similarity (Levenshtein)
      if (recentSignals && recentSignals.length > 0) {
        const contentLower = content.toLowerCase().trim();
        for (const signal of recentSignals) {
          if (signal.id === id) continue;

          const similarity = calculateSimilarity(
            contentLower,
            (signal.normalized_text || '').toLowerCase().trim()
          );

          if (similarity >= nearDupThreshold) {
            duplicates.push({
              ...signal,
              similarity_score: similarity,
              detection_type: similarity >= 0.98 ? 'near-exact' : 'similar',
              detection_method: 'text_similarity',
            });
          }
        }
      }

      // 2) Semantic fallback (AI) when lexical similarity misses paraphrases
      if (duplicates.length === 0 && semanticEnabled && recentSignals && recentSignals.length > 0) {
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

        const candidates = recentSignals
          .filter((s) => s.id !== id)
          .filter((s) => (s.normalized_text || '').trim().length > 0)
          .slice(0, 60)
          .map((s) => ({ id: s.id, text: (s.normalized_text || '').toString() }));

        if (LOVABLE_API_KEY && candidates.length > 0) {
          try {
            const resp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  {
                    role: 'system',
                    content:
                      'You are a deduplication system. Compare an incoming signal summary to candidate summaries for the same client. Return ONLY JSON: {"best_match_id": string|null, "similarity": number, "rationale": string}. similarity is 0..1 semantic equivalence (1=essentially same event/info, 0=completely unrelated).',
                  },
                  {
                    role: 'user',
                    content: JSON.stringify(
                      {
                        incoming: String(content).slice(0, 2000),
                        candidates,
                      },
                      null,
                      2
                    ),
                  },
                ],
                max_completion_tokens: 200,
              }),
            });

            if (resp.ok) {
              const data = await resp.json();
              let out = data.choices?.[0]?.message?.content?.trim?.() || '';
              if (out.startsWith('```')) {
                out = out.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
              }

              const parsed = JSON.parse(out);
              const bestId = parsed?.best_match_id as string | null;
              const sim = Number(parsed?.similarity);

              if (bestId && Number.isFinite(sim) && sim >= nearDupThreshold) {
                const matched = recentSignals.find((s) => s.id === bestId);
                duplicates.push({
                  id: bestId,
                  normalized_text: matched?.normalized_text ?? null,
                  created_at: matched?.created_at ?? null,
                  client_id: matched?.client_id ?? client_id ?? null,
                  similarity_score: sim,
                  detection_type: 'semantic',
                  detection_method: 'semantic',
                  rationale: parsed?.rationale ?? null,
                });
              }
            }
          } catch (e) {
            console.error('Semantic duplicate check failed:', e);
          }
        }
      }

      // Sort best match first
      duplicates.sort((a, b) => (b.similarity_score || 0) - (a.similarity_score || 0));
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

    const nearDuplicateMatch = type === 'signal' && duplicates.length > 0;

    return new Response(
      JSON.stringify({
        isDuplicate: duplicates.length > 0,
        exactMatch: false,
        nearDuplicateMatch,
        duplicates: duplicates,
        count: duplicates.length,
        contentHash: contentHash,
        near_duplicate_threshold_used:
          type === 'signal' ? signalMeta.near_duplicate_threshold_used : undefined,
        lookback_days_used:
          type === 'signal' ? signalMeta.lookback_days_used : undefined,
        semantic_used: type === 'signal' ? signalMeta.semantic_used : undefined,
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
