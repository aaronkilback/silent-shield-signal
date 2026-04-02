/**
 * sweep-expert-knowledge
 *
 * Iterates all active expert profiles and fires background ingestion
 * for each one — media sources first, then topic sweep.
 * Designed to be called by cron weekly.
 */

import { createServiceClient, handleCors, successResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createServiceClient();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const body = await req.json().catch(() => ({}));
  const force = body.force ?? false;

  const { data: profiles } = await supabase
    .from('expert_profiles')
    .select('id, name, last_ingested_at, ingestion_topics')
    .eq('is_active', true);

  if (!profiles?.length) return successResponse({ message: 'No active expert profiles found' });

  // Stagger fires to avoid hammering Perplexity simultaneously
  let queued = 0;
  for (let i = 0; i < profiles.length; i++) {
    const profile = profiles[i];

    // Skip recently ingested profiles unless forced
    if (!force && profile.last_ingested_at) {
      const age = Date.now() - new Date(profile.last_ingested_at).getTime();
      const sixDays = 6 * 24 * 60 * 60 * 1000;
      if (age < sixDays) continue;
    }

    const delay = i * 3000; // 3s stagger between each expert

    // Media ingestion (YouTube, podcast, LinkedIn)
    setTimeout(() => {
      fetch(`${supabaseUrl}/functions/v1/ingest-expert-media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify({ expert_profile_id: profile.id, media_only: true, force }),
      }).catch(() => {});
    }, delay);

    // Topic sweep fires 10s after media to avoid overlap
    if (profile.ingestion_topics?.length) {
      setTimeout(() => {
        fetch(`${supabaseUrl}/functions/v1/ingest-expert-media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
          body: JSON.stringify({ expert_profile_id: profile.id, topics_only: true, force }),
        }).catch(() => {});
      }, delay + 10000);
    }

    queued++;
  }

  return successResponse({
    message: `Expert knowledge sweep initiated`,
    profiles_total: profiles.length,
    profiles_queued: queued,
    force,
  });
});
