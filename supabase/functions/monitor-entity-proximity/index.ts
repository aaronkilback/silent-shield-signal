import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { correlateSignalEntities } from '../_shared/correlate-signal-entities.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Threat keywords to search for
const THREAT_KEYWORDS = [
  'protest', 'demonstration', 'riot', 'violence', 'threat', 'shooting',
  'attack', 'bomb', 'suspicious', 'emergency', 'evacuation', 'lockdown',
  'security alert', 'active shooter', 'fire', 'accident', 'hazard'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting entity proximity monitoring...');

    // Get all entities with active monitoring enabled
    const { data: entities, error: entitiesError } = await supabase
      .from('entities')
      .select('*')
      .eq('active_monitoring_enabled', true)
      .eq('is_active', true)
      .not('current_location', 'is', null);

    if (entitiesError) {
      console.error('Error fetching entities:', entitiesError);
      throw entitiesError;
    }

    if (!entities || entities.length === 0) {
      console.log('No entities with active monitoring found');
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No entities with active monitoring enabled',
          entities_scanned: 0,
          signals_created: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${entities.length} entities to monitor`);
    
    let totalSignals = 0;
    const searchApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const searchEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');

    if (!searchApiKey || !searchEngineId) {
      console.error('Google Search API credentials not configured');
      return new Response(
        JSON.stringify({ error: 'Search API not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Monitor each entity
    for (const entity of entities) {
      console.log(`Monitoring entity: ${entity.name} at ${entity.current_location}`);
      
      try {
        // Build search query: entity name + location + threat keywords
        const threatQuery = THREAT_KEYWORDS.slice(0, 5).join(' OR ');
        const searchQuery = `"${entity.name}" "${entity.current_location}" (${threatQuery})`;
        
        console.log(`Search query: ${searchQuery}`);
        
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${searchApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=5&dateRestrict=d1`;
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        
        const searchResponse = await fetch(searchUrl, {
          signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        if (!searchResponse.ok) {
          console.error(`Search API error for ${entity.name}:`, searchResponse.status);
          continue;
        }

        const searchData = await searchResponse.json();
        const items = searchData.items || [];
        
        console.log(`Found ${items.length} results for ${entity.name}`);

        // Process each result
        for (const item of items) {
          const title = item.title || '';
          const snippet = item.snippet || '';
          const link = item.link || '';
          const fullText = `${title} ${snippet}`.toLowerCase();

          // Check for threat keywords
          const matchedKeywords = THREAT_KEYWORDS.filter(keyword => 
            fullText.includes(keyword.toLowerCase())
          );

          if (matchedKeywords.length === 0) continue;

          // Determine severity based on keywords
          const criticalKeywords = ['shooting', 'attack', 'bomb', 'active shooter', 'riot'];
          const highKeywords = ['threat', 'violence', 'emergency', 'evacuation', 'lockdown'];
          
          let severity = 'medium';
          let priority = 'p3';
          let shouldCreateIncident = false;

          if (matchedKeywords.some(k => criticalKeywords.includes(k))) {
            severity = 'critical';
            priority = 'p1';
            shouldCreateIncident = true;
          } else if (matchedKeywords.some(k => highKeywords.includes(k))) {
            severity = 'high';
            priority = 'p2';
            shouldCreateIncident = true;
          }

          console.log(`Creating signal for ${entity.name}: ${severity} - ${matchedKeywords.join(', ')}`);

          // Create signal
          const signalText = `ENTITY PROXIMITY ALERT: ${entity.name} is near a potential threat in ${entity.current_location}.\n\nThreat Type: ${matchedKeywords.join(', ')}\n\nDetails: ${title}\n${snippet}\n\nSource: ${link}`;

          const { data: signal, error: signalError } = await supabase
            .from('signals')
            .insert({
              normalized_text: signalText,
              severity: severity,
              category: 'entity_proximity',
              location: entity.current_location,
              entity_tags: [entity.name],
              confidence: 0.85,
              raw_json: {
                entity_id: entity.id,
                entity_name: entity.name,
                matched_keywords: matchedKeywords,
                search_result: item,
                monitoring_radius_km: entity.monitoring_radius_km
              }
            })
            .select()
            .single();

          if (signalError) {
            console.error('Error creating signal:', signalError);
            continue;
          }

          totalSignals++;
          
          // Correlate entities from proximity alert
          await correlateSignalEntities({
            supabase,
            signalText,
            clientId: entity.id,
            additionalContext: `${title}. ${snippet}`
          });

          // Create entity mention
          await supabase
            .from('entity_mentions')
            .insert({
              entity_id: entity.id,
              signal_id: signal.id,
              context: snippet.substring(0, 500),
              confidence: 0.85,
              detected_at: new Date().toISOString()
            });

          // Create incident if needed
          if (shouldCreateIncident) {
            console.log(`Creating ${priority} incident for ${entity.name}`);
            
            await supabase
              .from('incidents')
              .insert({
                signal_id: signal.id,
                priority: priority,
                status: 'open',
                opened_at: new Date().toISOString()
              });
          }

          // Notify users
          const { data: userRoles } = await supabase
            .from('user_roles')
            .select('user_id')
            .in('role', ['analyst', 'admin']);

          if (userRoles && userRoles.length > 0) {
            const notifications = userRoles.map(ur => ({
              entity_id: entity.id,
              mention_id: signal.id,
              user_id: ur.user_id,
              is_read: false
            }));

            await supabase
              .from('entity_notifications')
              .insert(notifications);
          }
        }

        // Small delay between entities to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        console.error(`Error monitoring entity ${entity.name}:`, error);
        continue;
      }
    }

    console.log(`Entity proximity monitoring completed. Created ${totalSignals} signals.`);

    return new Response(
      JSON.stringify({ 
        success: true,
        entities_scanned: entities.length,
        signals_created: totalSignals
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Entity proximity monitoring error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});