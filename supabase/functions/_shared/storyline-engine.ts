/**
 * Signal Storyline Clustering Engine
 * 
 * Groups related signals into persistent narrative "storylines" using
 * AI-powered semantic similarity. When a new signal arrives, it's checked
 * against active storylines — if it matches, it's filed under the existing
 * storyline. If it's genuinely new, a new storyline is created.
 * 
 * This goes deeper than the same-story gate in ingest-signal by creating
 * persistent, evolving narrative threads.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGatewayJson } from "./ai-gateway.ts";

interface StorylineMatch {
  storylineId: string;
  title: string;
  similarity: number;
  isNewDevelopment: boolean;
  role: 'member' | 'update' | 'contradiction';
}

interface StorylineResult {
  action: 'joined_existing' | 'created_new' | 'no_match';
  storylineId: string | null;
  storylineTitle: string | null;
  similarity: number;
  isNewDevelopment: boolean;
}

/**
 * Classify a signal into an existing storyline or create a new one.
 */
export async function classifySignalIntoStoryline(
  supabase: ReturnType<typeof createClient>,
  signal: {
    id: string;
    normalized_text: string;
    category?: string;
    entity_tags?: string[];
    location?: string;
    client_id?: string;
  }
): Promise<StorylineResult> {
  const startTime = Date.now();

  try {
    // 1. Fetch active storylines for this client (or global)
    let query = supabase
      .from('signal_storylines')
      .select('id, title, summary, category, key_entities, key_locations, signal_count, last_updated_at')
      .in('status', ['active', 'dormant'])
      .order('last_updated_at', { ascending: false })
      .limit(30);

    if (signal.client_id) {
      query = query.eq('client_id', signal.client_id);
    }

    const { data: storylines, error: slError } = await query;

    if (slError || !storylines || storylines.length === 0) {
      // No existing storylines — create a new one
      return await createNewStoryline(supabase, signal);
    }

    // 2. Use AI to find the best matching storyline
    const storylineSummaries = storylines.map((s, i) => 
      `[${i}] "${s.title}" (${s.signal_count} signals, last updated ${s.last_updated_at})\n   Summary: ${s.summary || 'N/A'}\n   Entities: ${s.key_entities?.join(', ') || 'N/A'}\n   Locations: ${s.key_locations?.join(', ') || 'N/A'}`
    ).join('\n\n');

    const classificationResult = await callAiGatewayJson<{
      best_match_index: number | null;
      similarity: number;
      is_same_story: boolean;
      is_new_development: boolean;
      is_contradiction: boolean;
      reasoning: string;
    }>({
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        {
          role: 'system',
          content: `You classify intelligence signals into existing narrative storylines.

Return JSON:
{
  "best_match_index": number | null,  // index of best matching storyline, null if no match
  "similarity": 0.0-1.0,             // semantic similarity to best match
  "is_same_story": boolean,          // true if signal is about the same ongoing narrative
  "is_new_development": boolean,     // true if signal adds genuinely new information
  "is_contradiction": boolean,       // true if signal contradicts the storyline's narrative
  "reasoning": string                // brief explanation
}

RULES:
- "same_story" means the signal covers the same event/policy/actor/situation
- A new article about the same government policy = same story
- A similar but unrelated event in a different region = NOT same story
- similarity > 0.6 and is_same_story = true → should join existing storyline
- If no storyline matches, set best_match_index to null`
        },
        {
          role: 'user',
          content: `NEW SIGNAL:\n"${signal.normalized_text}"\nCategory: ${signal.category || 'unknown'}\nEntities: ${signal.entity_tags?.join(', ') || 'none'}\nLocation: ${signal.location || 'unknown'}\n\nEXISTING STORYLINES:\n${storylineSummaries}`
        }
      ],
      functionName: 'storyline-classifier',
      skipGuardrails: true,
    });

    if (!classificationResult.data || classificationResult.data.best_match_index === null || !classificationResult.data.is_same_story) {
      // No match — create new storyline
      return await createNewStoryline(supabase, signal);
    }

    const match = classificationResult.data;
    const matchedStoryline = storylines[match.best_match_index];

    if (!matchedStoryline || match.similarity < 0.5) {
      return await createNewStoryline(supabase, signal);
    }

    // 3. Add signal to existing storyline
    const role = match.is_contradiction ? 'contradiction' : match.is_new_development ? 'update' : 'member';

    await supabase.from('signal_storyline_members').upsert({
      storyline_id: matchedStoryline.id,
      signal_id: signal.id,
      similarity_score: match.similarity,
      role,
      added_by: 'storyline-engine',
    }, { onConflict: 'storyline_id,signal_id' });

    // Update storyline metadata
    const updatedEntities = new Set([...(matchedStoryline.key_entities || []), ...(signal.entity_tags || [])]);
    const updatedLocations = new Set([...(matchedStoryline.key_locations || []), ...(signal.location ? [signal.location] : [])]);

    await supabase.from('signal_storylines').update({
      signal_count: (matchedStoryline.signal_count || 1) + 1,
      last_updated_at: new Date().toISOString(),
      key_entities: Array.from(updatedEntities).slice(0, 20),
      key_locations: Array.from(updatedLocations).slice(0, 10),
      status: 'active', // reactivate dormant storylines
      updated_at: new Date().toISOString(),
    }).eq('id', matchedStoryline.id);

    console.log(`[Storyline] Signal ${signal.id} joined storyline "${matchedStoryline.title}" (similarity: ${match.similarity}, role: ${role}) in ${Date.now() - startTime}ms`);

    return {
      action: 'joined_existing',
      storylineId: matchedStoryline.id,
      storylineTitle: matchedStoryline.title,
      similarity: match.similarity,
      isNewDevelopment: match.is_new_development,
    };

  } catch (err) {
    console.error(`[Storyline] Error classifying signal ${signal.id}:`, err);
    return { action: 'no_match', storylineId: null, storylineTitle: null, similarity: 0, isNewDevelopment: false };
  }
}

/**
 * Create a new storyline from a signal.
 */
async function createNewStoryline(
  supabase: ReturnType<typeof createClient>,
  signal: { id: string; normalized_text: string; category?: string; entity_tags?: string[]; location?: string; client_id?: string }
): Promise<StorylineResult> {
  // Generate a concise title via AI
  const titleResult = await callAiGatewayJson<{ title: string; summary: string }>({
    model: 'google/gemini-2.5-flash-lite',
    messages: [
      { role: 'system', content: 'Generate a concise storyline title (max 10 words) and one-sentence summary for this intelligence signal. Return JSON: { "title": "...", "summary": "..." }' },
      { role: 'user', content: signal.normalized_text.substring(0, 500) }
    ],
    functionName: 'storyline-title-generator',
    skipGuardrails: true,
  });

  const title = titleResult.data?.title || signal.normalized_text.substring(0, 80);
  const summary = titleResult.data?.summary || signal.normalized_text.substring(0, 200);

  const { data: storyline, error } = await supabase.from('signal_storylines').insert({
    title,
    summary,
    category: signal.category,
    key_entities: signal.entity_tags || [],
    key_locations: signal.location ? [signal.location] : [],
    client_id: signal.client_id,
    signal_count: 1,
    first_seen_at: new Date().toISOString(),
    last_updated_at: new Date().toISOString(),
  }).select('id').single();

  if (error || !storyline) {
    console.error('[Storyline] Failed to create storyline:', error);
    return { action: 'no_match', storylineId: null, storylineTitle: null, similarity: 0, isNewDevelopment: false };
  }

  // Add signal as origin member
  await supabase.from('signal_storyline_members').insert({
    storyline_id: storyline.id,
    signal_id: signal.id,
    similarity_score: 1.0,
    role: 'origin',
    added_by: 'storyline-engine',
  });

  console.log(`[Storyline] Created new storyline "${title}" for signal ${signal.id}`);

  return {
    action: 'created_new',
    storylineId: storyline.id,
    storylineTitle: title,
    similarity: 1.0,
    isNewDevelopment: true,
  };
}

/**
 * Mark storylines with no activity in 14 days as dormant.
 */
export async function markDormantStorylines(
  supabase: ReturnType<typeof createClient>
): Promise<number> {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const { data, error } = await supabase
    .from('signal_storylines')
    .update({ status: 'dormant', updated_at: new Date().toISOString() })
    .eq('status', 'active')
    .lt('last_updated_at', fourteenDaysAgo.toISOString())
    .select('id');

  if (error) console.error('[Storyline] Error marking dormant:', error);
  return data?.length || 0;
}
