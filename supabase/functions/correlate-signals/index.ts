import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const { signal_id, time_window_hours = 24 } = await req.json();

    if (!signal_id) {
      return errorResponse('signal_id is required', 400);
    }

    console.log(`[correlate-signals] Correlating signal ${signal_id}, window: ${time_window_hours}h`);

    // Get the new signal
    const { data: newSignal, error: signalError } = await supabase
      .from('signals')
      .select('*')
      .eq('id', signal_id)
      .single();

    if (signalError || !newSignal) {
      return errorResponse('Signal not found', 404);
    }

    // Skip if already correlated
    if (newSignal.correlation_group_id) {
      console.log('[correlate-signals] Already correlated, skipping');
      return successResponse({ message: 'Signal already correlated', correlated: false });
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 1: EMBEDDING PRE-FILTER (pgvector cosine similarity)
    // Reduces candidates from 100s to ~30, cutting AI costs ~80%
    // ═══════════════════════════════════════════════════════════

    let candidateSignals: any[] = [];
    let usedEmbeddingFilter = false;

    if (newSignal.content_embedding) {
      console.log('[correlate-signals] Using embedding pre-filter');

      const { data: embeddingMatches, error: embError } = await supabase
        .rpc('find_similar_signals_by_embedding', {
          p_embedding: newSignal.content_embedding,
          p_time_window_hours: time_window_hours,
          p_similarity_threshold: 0.72, // slightly below AI threshold to avoid missing edge cases
          p_max_results: 30,
          p_exclude_signal_id: signal_id,
        });

      if (!embError && embeddingMatches && embeddingMatches.length > 0) {
        candidateSignals = embeddingMatches;
        usedEmbeddingFilter = true;
        console.log(`[correlate-signals] Embedding pre-filter: ${embeddingMatches.length} candidates (vs fetching all recent)`);
      } else {
        if (embError) console.error('[correlate-signals] Embedding pre-filter error:', embError);
        console.log('[correlate-signals] Embedding pre-filter returned no results, falling back to full scan');
      }
    } else {
      console.log('[correlate-signals] No embedding on signal, using full scan');
    }

    // Fallback: fetch all recent signals if embedding pre-filter unavailable
    if (candidateSignals.length === 0) {
      const timeWindowAgo = new Date(Date.now() - time_window_hours * 60 * 60 * 1000).toISOString();
      const { data: recentSignals } = await supabase
        .from('signals')
        .select('id, normalized_text, category, severity, location, confidence, source_id, created_at, correlation_group_id, is_primary_signal')
        .gte('created_at', timeWindowAgo)
        .neq('id', signal_id)
        .order('created_at', { ascending: false })
        .limit(100);

      candidateSignals = recentSignals || [];
    }

    if (candidateSignals.length === 0) {
      console.log('[correlate-signals] No candidates to correlate with');
      return successResponse({ message: 'No recent signals found', correlated: false });
    }

    console.log(`[correlate-signals] Checking ${candidateSignals.length} candidates via AI (embedding_filtered: ${usedEmbeddingFilter})`);

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: AI SEMANTIC CORRELATION (on reduced candidate set)
    // ═══════════════════════════════════════════════════════════

    const embeddingHint = usedEmbeddingFilter
      ? '\nNote: These candidates were pre-filtered by vector similarity — most should be relevant. Focus on confirming semantic match.'
      : '';

    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a security signal correlation analyzer. Compare signals to determine if they describe the same event or related events.

Signals should be correlated if they:
- Describe the same incident/event (e.g., same protest, same breach, same threat)
- Have similar location and timeframe
- Share key entities or indicators
- Are different perspectives of the same situation

Respond with JSON array of objects containing signal_id and similarity_score (0-100).
Only include signals with similarity >= 70.

Format: [{"signal_id": "uuid", "similarity_score": 85, "reason": "brief explanation"}]${embeddingHint}`
        },
        {
          role: 'user',
          content: `NEW SIGNAL:
Text: ${newSignal.normalized_text}
Category: ${newSignal.category}
Severity: ${newSignal.severity}
Location: ${newSignal.location || 'unknown'}

CANDIDATE SIGNALS:
${candidateSignals.map((s: any, i: number) => `
${i + 1}. ID: ${s.id}
   Text: ${(s.normalized_text || '').substring(0, 300)}
   Category: ${s.category}
   Severity: ${s.severity}
   Location: ${s.location || 'unknown'}${s.similarity ? `\n   Embedding Similarity: ${(s.similarity * 100).toFixed(0)}%` : ''}
`).join('\n')}

Which signals describe the same or highly related event? Return similarity scores >= 70 only.`
        }
      ],
      functionName: 'correlate-signals',
      extraBody: { response_format: { type: 'json_object' } },
    });

    let similarSignals: Array<{ signal_id: string; similarity_score: number; reason: string }> = [];

    if (!aiResult.error && aiResult.content) {
      try {
        let jsonStr = aiResult.content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        const parsed = JSON.parse(jsonStr);
        // Handle both array and object with array property
        similarSignals = Array.isArray(parsed) ? parsed : (parsed.signals || parsed.results || parsed.similar_signals || []);
        console.log(`[correlate-signals] AI found ${similarSignals.length} similar signals`);
      } catch (e) {
        console.error('[correlate-signals] Failed to parse AI response:', e);
      }
    }

    if (similarSignals.length === 0) {
      return successResponse({ message: 'No similar signals found', correlated: false, candidates_checked: candidateSignals.length, embedding_filtered: usedEmbeddingFilter });
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: CREATE/UPDATE CORRELATION GROUP
    // ═══════════════════════════════════════════════════════════

    const similarSignalIds = similarSignals.map(s => s.signal_id);
    const { data: matchedSignals } = await supabase
      .from('signals')
      .select('*, sources(name)')
      .in('id', similarSignalIds);

    if (!matchedSignals || matchedSignals.length === 0) {
      return successResponse({ message: 'No matched signals in database', correlated: false });
    }

    const existingGroupSignal = matchedSignals.find(s => s.correlation_group_id);
    let correlationGroupId: string;
    let isNewGroup = false;

    if (existingGroupSignal) {
      correlationGroupId = existingGroupSignal.correlation_group_id;
      console.log('[correlate-signals] Adding to existing group:', correlationGroupId);

      const allGroupSignals = [...matchedSignals.filter(s => s.correlation_group_id === correlationGroupId), newSignal];
      const avgConfidence = allGroupSignals.reduce((sum, s) => sum + (s.confidence || 0), 0) / allGroupSignals.length;
      const sources = [...new Set(allGroupSignals.map(s => ({ id: s.source_id, name: s.sources?.name || 'Unknown' })))];

      await supabase
        .from('signal_correlation_groups')
        .update({ signal_count: allGroupSignals.length, avg_confidence: avgConfidence, sources_json: sources, updated_at: new Date().toISOString() })
        .eq('id', correlationGroupId);
    } else {
      isNewGroup = true;
      const allSignals = [...matchedSignals, newSignal];
      const avgConfidence = allSignals.reduce((sum, s) => sum + (s.confidence || 0), 0) / allSignals.length;

      const { data: newSignalSource } = await supabase.from('sources').select('name').eq('id', newSignal.source_id).single();
      const sources = [...new Set(allSignals.map(s => ({ id: s.source_id, name: s.sources?.name || newSignalSource?.name || 'Unknown' })))];

      const { data: newGroup, error: groupError } = await supabase
        .from('signal_correlation_groups')
        .insert({
          primary_signal_id: newSignal.id,
          category: newSignal.category,
          severity: newSignal.severity,
          location: newSignal.location,
          normalized_text: newSignal.normalized_text,
          signal_count: allSignals.length,
          avg_confidence: avgConfidence,
          sources_json: sources,
        })
        .select()
        .single();

      if (groupError || !newGroup) {
        return errorResponse('Failed to create correlation group', 500);
      }

      correlationGroupId = newGroup.id;
      console.log('[correlate-signals] Created new group:', correlationGroupId);

      await supabase
        .from('signals')
        .update({ correlation_group_id: correlationGroupId, correlated_count: allSignals.length })
        .in('id', similarSignalIds);
    }

    const avgSimilarity = similarSignals.reduce((sum, s) => sum + s.similarity_score, 0) / similarSignals.length;
    const boostedConfidence = Math.min(1, (newSignal.confidence || 0.5) * (1 + similarSignals.length * 0.1));

    await supabase
      .from('signals')
      .update({
        correlation_group_id: correlationGroupId,
        is_primary_signal: isNewGroup,
        correlated_count: similarSignals.length + 1,
        correlation_confidence: avgSimilarity / 100,
        confidence: boostedConfidence,
      })
      .eq('id', signal_id);

    console.log(`[correlate-signals] Done. Group: ${correlationGroupId}, Matched: ${similarSignals.length}, Confidence: ${boostedConfidence.toFixed(2)}, Embedding filtered: ${usedEmbeddingFilter}`);

    return successResponse({
      success: true,
      correlated: true,
      correlation_group_id: correlationGroupId,
      matched_signals: similarSignals.length,
      new_confidence: boostedConfidence,
      embedding_filtered: usedEmbeddingFilter,
      candidates_checked: candidateSignals.length,
      similarity_scores: similarSignals,
    });

  } catch (error) {
    console.error('[correlate-signals] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
