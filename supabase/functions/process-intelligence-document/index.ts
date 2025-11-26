import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Processing document: ${documentId}`);

    // Update status
    await supabase
      .from('ingested_documents')
      .update({ processing_status: 'processing' })
      .eq('id', documentId);

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from('ingested_documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      throw new Error('Document not found');
    }

    // Fetch existing entities for context
    const { data: existingEntities } = await supabase
      .from('entities')
      .select('id, name, type, aliases, entity_status')
      .eq('is_active', true)
      .limit(200);

    const entityContext = (existingEntities || [])
      .filter(e => e.entity_status !== 'rejected')
      .map(e => `${e.name} (${e.type})${e.aliases?.length ? ` aka ${e.aliases.join(', ')}` : ''}`)
      .join('\n');

    // Fetch all active clients and their keywords
    const { data: clients } = await supabase
      .from('clients')
      .select('id, name, monitoring_keywords, competitor_names, high_value_assets')
      .eq('status', 'active');

    // Match document against client keywords
    function matchClientKeywords(text: string, clients: any[]) {
      const lowerText = text.toLowerCase();
      const matches: Array<{ clientId: string; clientName: string; matchedKeywords: string[] }> = [];
      
      for (const client of clients || []) {
        const matchedKeywords: string[] = [];
        const allKeywords = [
          ...(client.monitoring_keywords || []),
          ...(client.competitor_names || []),
          ...(client.high_value_assets || [])
        ];
        
        for (const keyword of allKeywords) {
          if (lowerText.includes(keyword.toLowerCase())) {
            matchedKeywords.push(keyword);
          }
        }
        
        if (matchedKeywords.length > 0) {
          matches.push({
            clientId: client.id,
            clientName: client.name,
            matchedKeywords
          });
        }
      }
      
      return matches;
    }

    const clientMatches = matchClientKeywords(document.raw_text || '', clients || []);
    
    // Skip processing if no client keywords match
    if (clientMatches.length === 0) {
      console.log('No client keyword matches found, skipping document');
      await supabase
        .from('ingested_documents')
        .update({
          processing_status: 'completed',
          processed_at: new Date().toISOString(),
          error_message: 'No client keyword matches'
        })
        .eq('id', documentId);
      
      return new Response(
        JSON.stringify({
          success: true,
          results: { message: 'No client keyword matches', skipped: true }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Matched ${clientMatches.length} client(s):`, clientMatches.map(m => m.clientName).join(', '));

    // Fetch learning profiles
    const { data: approvedPatterns } = await supabase
      .from('learning_profiles')
      .select('features')
      .eq('profile_type', 'approved_signal_patterns')
      .limit(1)
      .single();

    const { data: rejectedPatterns } = await supabase
      .from('learning_profiles')
      .select('features')
      .eq('profile_type', 'rejected_signal_patterns')
      .limit(1)
      .single();

    const learningContext = `
APPROVED PATTERNS (prioritize these):
${JSON.stringify(approvedPatterns?.features || {}, null, 2)}

REJECTED PATTERNS (avoid these):
${JSON.stringify(rejectedPatterns?.features || {}, null, 2)}
`;

    // Call AI for extraction
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          {
            role: 'system',
            content: `You are an expert security intelligence analyst extracting actionable intelligence from documents.

KNOWN ENTITIES:
${entityContext}

${learningContext}

Extract:
1. ENTITIES - Named people, organizations, locations, assets, infrastructure
   
   PEOPLE TO CAPTURE:
   - Political figures: Prime Ministers, Ministers, MPs, government officials (with titles)
   - Corporate executives: CEOs, Presidents, Directors (with titles)
   - Journalists, reporters, authors
   - Community leaders, activists
   - **ACTIVISTS & ORGANIZERS**: Named individuals described as activists, organizers, protesters, campaigners
   - **RESEARCHERS & ACADEMICS**: Scientists, PhDs, researchers with their credentials (PhD, MD, etc.)
   - **LEADERSHIP TITLES**: Anyone with President, Director, Spokesperson, Leader, Chief, Principal Scientist titles
   - Examples: Kelsey BILSBACK (PhD, Principal Scientist), Sebastian ROWLAND (PhD, Scientist), Dr. Melissa LEM (CAPE President)
   - **CRITICAL**: Always include their full title/credentials AND organizational affiliation
   - Format: "Name (Credentials, Title, Organization)"
   
   ORGANIZATIONS TO CAPTURE:
   - CRITICAL: Media organizations (The Narwhal, CBC News, Reuters, local newspapers, online publications)
   - Government agencies and offices (Major Projects Office, ministries, departments)
   - Companies and corporations
   - NGOs, activist groups, community organizations
   - **INDIGENOUS GROUPS**: First Nations, Indigenous activists groups, traditional territories
   - Examples: Lax'yip Firekeepers, Gitanyow activists, Gitxsan activists
   - **ADVOCACY GROUPS**: Professional associations, environmental groups, health organizations
   - Examples: Canadian Association of Physicians for the Environment (CAPE), Dogwood BC, PSE Healthy Energy
   - **OPPOSITION GROUPS**: Anti-industry campaigns, protesters, environmental coalitions
   - Examples: Sierra Club, Greenpeace, local protest groups
   - Any organization mentioned as "led by", "organized by", "represented by", "partnered with"
   
   INFRASTRUCTURE/PROJECTS:
   - LNG facilities, pipelines, transmission lines
   - Energy projects, resource extraction sites
   - Major infrastructure projects

2. SIGNALS - Identify ALL security, reputational, regulatory, and environmental concerns
   
   OPPOSITION & CRITICISM (HIGH PRIORITY):
   - Look for: "condemn", "criticize", "oppose", "opponents", "protest", "backlash", "controversy"
   - Fast-tracking of controversial projects
   - **PROTEST ACTIONS**: Road blocks, demonstrations, press conferences against projects
   - Community opposition to industrial projects
   - Environmental group criticism
   - Indigenous opposition or concerns
   - **ALLEGATIONS**: "environmental racism", "foreign companies benefit", "colonial", anti-national interest claims
   - Social media campaigns and amplification of opposition
   
   MEDIA COVERAGE PATTERNS:
   - Negative headlines about your client or projects
   - Investigative journalism pieces
   - Exposés of environmental damage
   - Critical opinion pieces
   - Social media controversies
   - **EVENTS & WEBINARS**: Anti-industry events, advocacy webinars, protest press conferences
   - Coordinated campaigns across multiple platforms
   
   ENVIRONMENTAL & HEALTH:
   - Pollution, emissions, flaring complaints
   - **HEALTH RESEARCH**: Studies linking industrial activity to health impacts
   - **SPECIFIC CLAIMS**: Methane emissions health impacts, LNG flaring health concerns
   - Research presentations, webinars, academic studies critical of projects
   - Health concerns from industrial activity
   - Environmental damage allegations
   - Wildlife impacts, climate concerns
   - Any "health initiative" or research program targeting your operations
   
   REGULATORY & POLITICAL:
   - Government fast-tracking or approval shortcuts
   - Regulatory investigations
   - Legal challenges, lawsuits
   - Policy changes affecting operations
   
   SEVERITY GUIDANCE:
   - CRITICAL (90-100): Major scandal, significant legal action, severe environmental damage
   - HIGH (70-89): Widespread negative coverage, strong opposition, regulatory violations
   - MEDIUM (40-69): Moderate criticism, emerging concerns, local complaints
   - LOW (20-39): Minor mentions, general commentary

3. ENTITY MENTIONS - Where entities appear in the document

CRITICAL: Be aggressive in detecting opposition, criticism, and controversy. These are HIGH-VALUE signals even if not traditional security threats.

EXTRACTION THOROUGHNESS:
- Extract EVERY named person with their full credentials and organizational affiliations
- Don't skip over academic titles (PhD, MD), professional titles (Scientist, Researcher), or leadership positions
- When organizations have initiatives or programs mentioned, extract those as separate entities
- Health claims, research findings, and scientific criticism are ALWAYS high-priority signals
- Webinars, conferences, and research presentations opposing your operations are signals
- Look for connections: if Person A from Organization B presents Research C at Event D, extract all four entities and create a signal`
          },
          {
            role: 'user',
            content: `Analyze this document and extract intelligence:

TITLE: ${document.title}
TEXT: ${document.raw_text}

Extract all entities, signals, and their relationships.`
          }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "extract_intelligence",
              description: "Extract entities, signals, and mentions from document",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "asset", "project", "route", "research_initiative"]
                        },
                        confidence: { type: "number", minimum: 0, maximum: 1 },
                        matched_entity_id: { type: "string" },
                        mention_text: { type: "string" },
                        position_start: { type: "integer" }
                      },
                      required: ["name", "type", "confidence"]
                    }
                  },
                  signals: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        signal_type: { 
                          type: "string",
                          enum: ["theft", "protest", "threat", "surveillance", "sabotage", "violence", "cyber", "data_exposure", "wildlife", "wildfire", "weather", "health", "regulatory", "legal", "operational", "media", "reputational", "environmental", "community_impact"]
                        },
                        severity_score: { type: "integer", minimum: 0, maximum: 100 },
                        relevance_score: { type: "number", minimum: 0, maximum: 1 },
                        related_entity_names: { type: "array", items: { type: "string" } },
                        location: { type: "string" }
                      },
                      required: ["title", "description", "signal_type", "severity_score"]
                    }
                  }
                },
                required: ["entities", "signals"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_intelligence" } }
      }),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const intelligence = JSON.parse(toolCall.function.arguments);

    const results = {
      entities_extracted: 0,
      entities_confirmed: 0,
      signals_created: 0,
      mentions_created: 0
    };

    // Process entities
    for (const entity of intelligence.entities || []) {
      if (entity.confidence < 0.6) continue;

      let entityId = entity.matched_entity_id;
      
      // Try to find existing entity
      if (!entityId) {
        const { data: existing } = await supabase
          .from('entities')
          .select('id, confidence_score')
          .ilike('name', entity.name)
          .eq('type', entity.type)
          .single();

        if (existing) {
          entityId = existing.id;
          // Update confidence
          await supabase
            .from('entities')
            .update({ 
              confidence_score: Math.min((existing.confidence_score + entity.confidence) / 2, 1),
              entity_status: 'confirmed'
            })
            .eq('id', entityId);
          
          results.entities_confirmed++;
        }
      }

      // Create new entity if not found
      if (!entityId) {
        const { data: newEntity, error: entityError } = await supabase
          .from('entities')
          .insert({
            name: entity.name,
            type: entity.type,
            confidence_score: entity.confidence,
            entity_status: 'suggested',
            is_active: true
          })
          .select('id')
          .single();

        if (!entityError && newEntity) {
          entityId = newEntity.id;
          results.entities_extracted++;
        }
      }

      // Create mention
      if (entityId) {
        await supabase
          .from('document_entity_mentions')
          .insert({
            entity_id: entityId,
            document_id: documentId,
            mention_text: entity.mention_text || entity.name,
            position_start: entity.position_start || 0,
            confidence: entity.confidence
          })
          .then(() => results.mentions_created++);
      }
    }

    // Process signals - create one per matched client
    for (const signal of intelligence.signals || []) {
      // FIX 3: Generate content hash based on SOURCE URL + signal content for better deduplication
      // This ensures the same RSS article always produces the same hash regardless of AI phrasing variations
      const sourceUrl = document.metadata?.url || '';
      const contentToHash = `${sourceUrl}|${signal.title || ''}|${signal.description || ''}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(contentToHash);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const contentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Create signal for each matched client
      for (const clientMatch of clientMatches) {
        // Check for existing signal with same content hash (within 30 days instead of 7)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { data: existingSignal } = await supabase
          .from('signals')
          .select('id')
          .eq('content_hash', contentHash)
          .eq('client_id', clientMatch.clientId)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .single();

        if (existingSignal) {
          console.log(`Skipping duplicate signal for client ${clientMatch.clientName}: ${signal.title}`);
          continue; // Skip this duplicate
        }
        
        // Additional near-duplicate check: look for similar normalized_text in recent signals
        const { data: recentSignals } = await supabase
          .from('signals')
          .select('id, normalized_text')
          .eq('client_id', clientMatch.clientId)
          .gte('created_at', thirtyDaysAgo.toISOString())
          .limit(50);
        
        // Simple similarity check - if any recent signal contains 80% of the same words, skip
        if (recentSignals && recentSignals.length > 0) {
          const signalWords = new Set(signal.description.toLowerCase().split(/\s+/));
          for (const existing of recentSignals) {
            if (!existing.normalized_text) continue;
            const existingWords = new Set(existing.normalized_text.toLowerCase().split(/\s+/));
            const intersection = new Set([...signalWords].filter(w => existingWords.has(w)));
            const similarity = intersection.size / Math.min(signalWords.size, existingWords.size);
            
            if (similarity > 0.8) {
              console.log(`Skipping near-duplicate signal (${(similarity * 100).toFixed(0)}% similar): ${signal.title}`);
              continue;
            }
          }
        }

        const { data: newSignal, error: signalError } = await supabase
          .from('signals')
          .insert({
            title: signal.title,
            description: signal.description,
            signal_type: signal.signal_type,
            severity_score: signal.severity_score,
            relevance_score: signal.relevance_score || 0.7,
            normalized_text: signal.description,
            content_hash: contentHash,
            severity: signal.severity_score >= 80 ? 'critical' : 
                      signal.severity_score >= 50 ? 'high' : 
                      signal.severity_score >= 20 ? 'medium' : 'low',
            location: signal.location,
            status: 'new',
            is_test: false,
            client_id: clientMatch.clientId,
            raw_json: {
              matched_keywords: clientMatch.matchedKeywords,
              client_name: clientMatch.clientName,
              source_metadata: document.metadata
            }
          })
          .select('id')
          .single();

        if (!signalError && newSignal) {
          results.signals_created++;

          // Link signal to document
          await supabase
            .from('signal_documents')
            .insert({
              signal_id: newSignal.id,
              document_id: documentId
            });

          // Link signal to entities
          if (signal.related_entity_names) {
            for (const entityName of signal.related_entity_names) {
              const { data: entity } = await supabase
                .from('entities')
                .select('id')
                .ilike('name', entityName)
                .single();

              if (entity) {
                await supabase.from('entity_mentions').insert({
                  entity_id: entity.id,
                  signal_id: newSignal.id,
                  confidence: 0.8
                });
              }
            }
          }

          // Check for auto-escalation
          if (signal.severity_score >= 80) {
            await supabase.functions.invoke('check-incident-escalation', {
              body: { signalId: newSignal.id }
            });
          }
        }
      }
    }

    // Mark document as processed
    await supabase
      .from('ingested_documents')
      .update({
        processing_status: 'completed',
        processed_at: new Date().toISOString()
      })
      .eq('id', documentId);

    console.log('Processing complete:', results);

    return new Response(
      JSON.stringify({
        success: true,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error processing document:', error);
    
    // Mark as failed
    if (req.json && (await req.json()).documentId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      await supabase
        .from('ingested_documents')
        .update({
          processing_status: 'failed',
          error_message: error instanceof Error ? error.message : 'Unknown error'
        })
        .eq('id', (await req.json()).documentId);
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});