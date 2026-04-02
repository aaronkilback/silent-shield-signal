import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

// Simple SHA-256 hash function
async function hashContent(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Calculate similarity between two strings (Levenshtein distance)
function calculateLevenshteinSimilarity(str1: string, str2: string): number {
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

// Normalize entity name for comparison
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Remove common prefixes
    .replace(/^(the|a|an)\s+/i, '')
    // Remove common suffixes for organizations
    .replace(/\s+(inc|llc|ltd|corp|corporation|company|co|limited|group|foundation|association|society|organization|org)\.?$/i, '')
    // Remove punctuation
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()'"]/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract key words from a name for matching
function extractKeywords(name: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'at', 'to', 'with', 'by']);
  return normalizeName(name)
    .split(' ')
    .filter(word => word.length > 2 && !stopWords.has(word));
}

// Calculate Jaccard similarity between two sets of words
function jaccardSimilarity(words1: string[], words2: string[]): number {
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// Calculate word overlap ratio (useful for subset matching)
function wordOverlapRatio(words1: string[], words2: string[]): number {
  const set1 = new Set(words1);
  const set2 = new Set(words2);
  const intersection = [...set1].filter(x => set2.has(x)).length;
  const smaller = Math.min(set1.size, set2.size);
  return smaller === 0 ? 0 : intersection / smaller;
}

// Advanced entity name similarity calculation
function calculateEntitySimilarity(name1: string, name2: string): { score: number; method: string } {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);
  
  // Exact normalized match
  if (norm1 === norm2) {
    return { score: 1.0, method: 'exact_normalized' };
  }
  
  // Check if one contains the other (handles abbreviations vs full names)
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length >= norm2.length ? norm1 : norm2;
    const containmentScore = 0.85 + (0.15 * shorter.length / longer.length);
    return { score: containmentScore, method: 'containment' };
  }
  
  // Keyword-based matching
  const keywords1 = extractKeywords(name1);
  const keywords2 = extractKeywords(name2);
  
  if (keywords1.length > 0 && keywords2.length > 0) {
    const jaccard = jaccardSimilarity(keywords1, keywords2);
    const overlap = wordOverlapRatio(keywords1, keywords2);
    
    // If high word overlap, this is likely the same entity
    if (overlap >= 0.8) {
      return { score: 0.75 + (overlap * 0.2), method: 'keyword_overlap' };
    }
    
    // Good Jaccard similarity
    if (jaccard >= 0.5) {
      return { score: 0.6 + (jaccard * 0.35), method: 'jaccard' };
    }
  }
  
  // Fall back to Levenshtein for shorter names or as final check
  const levenshtein = calculateLevenshteinSimilarity(norm1, norm2);
  return { score: levenshtein, method: 'levenshtein' };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

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
      return errorResponse('type and content are required', 400);
    }

    console.log(`Checking duplicates for ${type}${client_id ? ` (client: ${client_id})` : ''}`);

    const supabase = createServiceClient();

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

          const similarity = calculateLevenshteinSimilarity(
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
        const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

        const candidates = recentSignals
          .filter((s) => s.id !== id)
          .filter((s) => (s.normalized_text || '').trim().length > 0)
          .slice(0, 60)
          .map((s) => ({ id: s.id, text: (s.normalized_text || '').toString() }));

        if (GEMINI_API_KEY && candidates.length > 0) {
          try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
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
      // Improved fuzzy entity name matching with advanced algorithms
      const { data: entities } = await supabase
        .from('entities')
        .select('id, name, aliases, type, description')
        .eq('is_active', true);

      if (entities && entities.length > 0) {
        const inputNormalized = normalizeName(content);
        const inputKeywords = extractKeywords(content);
        
        for (const entity of entities) {
          const names = [entity.name, ...(entity.aliases || [])];
          let bestMatch = { score: 0, name: '', method: '' };
          
          for (const name of names) {
            const { score, method } = calculateEntitySimilarity(content, name);
            if (score > bestMatch.score) {
              bestMatch = { score, name, method };
            }
          }
          
          // Threshold based on matching method
          // More lenient thresholds for better methods
          const threshold = bestMatch.method === 'exact_normalized' ? 0.95 :
                           bestMatch.method === 'containment' ? 0.70 :
                           bestMatch.method === 'keyword_overlap' ? 0.65 :
                           bestMatch.method === 'jaccard' ? 0.60 :
                           0.75; // levenshtein
          
          if (bestMatch.score >= threshold) {
            duplicates.push({
              ...entity,
              matched_name: bestMatch.name,
              similarity_score: bestMatch.score,
              match_method: bestMatch.method
            });
          }
        }
        
        // Sort by similarity score descending
        duplicates.sort((a, b) => b.similarity_score - a.similarity_score);
        
        // Limit to top 10 matches
        duplicates = duplicates.slice(0, 10);
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

    return successResponse({
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
    });
  } catch (error) {
    console.error('Error in detect-duplicates function:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
