import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const googleApiKey = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const googleEngineId = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!googleApiKey || !googleEngineId) {
      throw new Error('Google Search API not configured');
    }

    if (!lovableApiKey) {
      throw new Error('Lovable AI not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json().catch(() => ({}));
    const entityId = body.entity_id;

    if (!entityId) {
      return new Response(
        JSON.stringify({ error: 'entity_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the entity
    const { data: entity, error: entityError } = await supabase
      .from('entities')
      .select('*')
      .eq('id', entityId)
      .single();

    if (entityError || !entity) {
      throw new Error('Entity not found');
    }

    console.log(`Performing OSINT web search for: ${entity.name}`);
    
    // Extract additional search parameters from entity details
    const attributes = entity.attributes || {};
    const contactInfo = attributes.contact_info || {};
    const socialMedia = contactInfo.social_media || {};
    const location = entity.current_location || '';
    const associations = entity.associations || [];
    const threatIndicators = entity.threat_indicators || [];

    let contentCreated = 0;
    let signalsCreated = 0;

    // Helper function to extract meaningful keywords from entity name
    const extractKeywords = (name: string): string[] => {
      // Common words to exclude from searches
      const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'in', 'on', 'at', 'to', 'with', 'by']);
      return name
        .split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word.toLowerCase()))
        .slice(0, 5); // Limit to 5 keywords
    };

    const keywords = extractKeywords(entity.name);
    const keywordQuery = keywords.join(' ');
    
    // Build comprehensive search queries using flexible matching
    const searchQueries: string[] = [];
    
    // For short names, use exact matching
    if (entity.name.split(/\s+/).length <= 3) {
      searchQueries.push(`"${entity.name}"`);
      searchQueries.push(`"${entity.name}" news`);
    } else {
      // For longer names, use flexible matching with keywords
      searchQueries.push(keywordQuery); // Unquoted keyword search
      searchQueries.push(`${keywordQuery} news`);
      
      // Try first few words as potential organization short name
      const shortName = entity.name.split(/\s+/).slice(0, 4).join(' ');
      if (shortName !== entity.name) {
        searchQueries.push(`"${shortName}"`);
      }
    }

    // Always try the full name without quotes as a broad search
    searchQueries.push(entity.name);

    // Add location-based searches if available
    if (location) {
      searchQueries.push(`${keywordQuery} ${location}`);
      if (entity.name.split(/\s+/).length <= 3) {
        searchQueries.push(`"${entity.name}" "${location}"`);
      }
    }

    // Add social media searches with handles if available
    if (socialMedia.facebook) {
      searchQueries.push(`site:facebook.com "${socialMedia.facebook}"`);
      searchQueries.push(`site:facebook.com ${keywordQuery}`);
    } else {
      searchQueries.push(`site:facebook.com ${keywordQuery}`);
    }

    if (socialMedia.linkedin) {
      searchQueries.push(`site:linkedin.com "${socialMedia.linkedin}"`);
      searchQueries.push(`site:linkedin.com ${keywordQuery}`);
    } else {
      searchQueries.push(`site:linkedin.com ${keywordQuery}`);
    }

    if (socialMedia.twitter) {
      searchQueries.push(`site:twitter.com "${socialMedia.twitter}"`);
      searchQueries.push(`site:x.com "${socialMedia.twitter}"`);
    }

    if (socialMedia.instagram) {
      searchQueries.push(`site:instagram.com "${socialMedia.instagram}"`);
    }

    // Add email and phone searches if available
    if (contactInfo.email && Array.isArray(contactInfo.email)) {
      contactInfo.email.forEach((email: string) => {
        if (email) searchQueries.push(`"${email}"`);
      });
    }

    if (contactInfo.phone && Array.isArray(contactInfo.phone)) {
      contactInfo.phone.forEach((phone: string) => {
        if (phone) searchQueries.push(`"${phone}"`);
      });
    }

    // Add aliases to searches - use flexible matching for long aliases
    if (entity.aliases && entity.aliases.length > 0) {
      entity.aliases.slice(0, 3).forEach((alias: string) => {
        if (alias.split(/\s+/).length <= 3) {
          searchQueries.push(`"${alias}"`);
          if (location) {
            searchQueries.push(`"${alias}" "${location}"`);
          }
        } else {
          const aliasKeywords = extractKeywords(alias).join(' ');
          searchQueries.push(aliasKeywords);
        }
      });
    }

    // Add association-based searches
    if (associations.length > 0) {
      associations.slice(0, 2).forEach((assoc: string) => {
        searchQueries.push(`${keywordQuery} "${assoc}"`);
      });
    }

    // Add threat indicator searches for security context
    if (threatIndicators.length > 0) {
      threatIndicators.slice(0, 2).forEach((indicator: string) => {
        searchQueries.push(`${keywordQuery} "${indicator}"`);
      });
    }

    // Add entity type specific searches
    if (entity.type === 'person') {
      searchQueries.push(`"${entity.name}" profile`);
      searchQueries.push(`"${entity.name}" biography`);
    } else if (entity.type === 'organization') {
      searchQueries.push(`${keywordQuery} organization`);
      searchQueries.push(`${keywordQuery} group`);
      // Try common variations
      searchQueries.push(`${keywordQuery} BC`); // British Columbia context
      searchQueries.push(`${keywordQuery} Canada`);
    }

    console.log(`Generated ${searchQueries.length} targeted search queries using entity details`);

    for (const query of searchQueries) {
      try {
        console.log(`Searching: ${query}`);
        
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${googleEngineId}&q=${encodeURIComponent(query)}&num=10`;
        const searchResponse = await fetch(searchUrl);
        
        if (!searchResponse.ok) {
          console.error(`Search failed for "${query}":`, searchResponse.status);
          continue;
        }

        const searchData = await searchResponse.json();
        const items = searchData.items || [];

        console.log(`Found ${items.length} results for "${query}"`);

        for (const item of items) {
          const url = item.link;
          const title = item.title;
          const snippet = item.snippet || '';

          // Use AI to analyze relevance
          const analysisResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                {
                  role: 'system',
                  content: 'You are a security intelligence analyst. Analyze web search results for relevance and extract key information about entities, risks, and security concerns.'
                },
                {
                  role: 'user',
                  content: `Analyze this search result for entity "${entity.name}":

Title: ${title}
URL: ${url}
Snippet: ${snippet}

Is this result relevant to the entity? Extract:
1. Relevance score (0-1)
2. Key information about the entity
3. Any security concerns, risks, or threats
4. Sentiment (positive/negative/neutral)
5. Brief summary

Respond with structured data.`
                }
              ],
              tools: [
                {
                  type: 'function',
                  function: {
                    name: 'analyze_result',
                    description: 'Analyze search result relevance and extract information',
                    parameters: {
                      type: 'object',
                      properties: {
                        relevance_score: { type: 'number', description: 'Relevance score 0-1' },
                        is_relevant: { type: 'boolean' },
                        summary: { type: 'string' },
                        sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
                        security_concerns: { type: 'array', items: { type: 'string' } },
                        key_information: { type: 'string' },
                        create_signal: { type: 'boolean', description: 'Should a security signal be created?' },
                        signal_severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] }
                      },
                      required: ['relevance_score', 'is_relevant', 'summary', 'sentiment']
                    }
                  }
                }
              ],
              tool_choice: { type: 'function', function: { name: 'analyze_result' } }
            }),
          });

          if (!analysisResponse.ok) {
            console.error('AI analysis failed:', analysisResponse.status);
            continue;
          }

          const analysisData = await analysisResponse.json();
          const toolCall = analysisData.choices?.[0]?.message?.tool_calls?.[0];
          
          if (!toolCall) continue;

          const analysis = JSON.parse(toolCall.function.arguments);

          // Only process relevant results
          if (!analysis.is_relevant || analysis.relevance_score < 0.5) {
            console.log(`Skipping irrelevant result: ${title}`);
            continue;
          }

          console.log(`Found relevant content: ${title} (relevance: ${analysis.relevance_score})`);

          // Create entity content record
          // Convert relevance_score from 0-1 float to 0-100 integer
          const relevanceInt = Math.round((analysis.relevance_score || 0) * 100);
          
          const { error: contentError } = await supabase
            .from('entity_content')
            .insert({
              entity_id: entityId,
              url,
              title,
              excerpt: snippet,
              content_text: `${title}\n\n${snippet}\n\nKey Information: ${analysis.key_information || 'N/A'}`,
              content_type: url.includes('facebook.com') ? 'social_media' : 
                           url.includes('linkedin.com') ? 'social_media' :
                           url.includes('twitter.com') ? 'social_media' : 'web',
              source: new URL(url).hostname,
              relevance_score: relevanceInt,
              sentiment: analysis.sentiment,
              published_date: new Date().toISOString()
            });

          if (contentError) {
            console.error('Error creating entity content:', contentError);
          } else {
            contentCreated++;
          }

          // Create signal if security concern identified
          if (analysis.create_signal && analysis.security_concerns && analysis.security_concerns.length > 0) {
            const { data: signalData, error: signalError } = await supabase
              .from('signals')
              .insert({
                title: `Security Intelligence: ${entity.name}`,
                description: analysis.summary,
                normalized_text: `${analysis.key_information}\n\nConcerns: ${analysis.security_concerns.join(', ')}`,
                signal_type: 'osint',
                severity_score: analysis.signal_severity === 'critical' ? 0.9 :
                               analysis.signal_severity === 'high' ? 0.75 :
                               analysis.signal_severity === 'medium' ? 0.5 : 0.3,
                source_url: url,
                status: 'new',
                relevance_score: analysis.relevance_score
              })
              .select('id')
              .single();

            if (signalError) {
              console.error('Error creating signal:', signalError);
            } else {
              signalsCreated++;
              
              // Create entity mention with proper signal_id
              await supabase.from('entity_mentions').insert({
                entity_id: entityId,
                signal_id: signalData?.id,
                confidence: analysis.relevance_score,
                context: snippet
              });
            }
          }
        }

        // Rate limiting - wait between searches
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing query "${query}":`, error);
        continue;
      }
    }

    // Update entity scan timestamp
    await supabase
      .from('entities')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', entityId);

    console.log(`OSINT web search complete. Created ${contentCreated} content items and ${signalsCreated} signals`);

    return new Response(
      JSON.stringify({ 
        success: true,
        entity: entity.name,
        content_created: contentCreated,
        signals_created: signalsCreated
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('OSINT web search error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
