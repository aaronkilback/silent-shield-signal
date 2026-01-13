import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const SignalInputSchema = z.object({
  source_key: z.string().optional(),
  event: z.any().optional(),
  text: z.string().min(1).max(5000000).optional(), // Increased to 5MB for large documents
  url: z.string().url().optional(),
  location: z.string().max(500).optional(),
  raw_json: z.any().optional(),
  is_test: z.boolean().optional(),
  client_id: z.string().uuid().optional() // CRITICAL FIX: Accept explicit client_id for test signals
}).refine(data => data.text || data.event || data.url, {
  message: "Either 'text', 'event', or 'url' must be provided"
});

// Rules-based classification (rules.yaml equivalent)
const RULES = {
  p1: {
    keywords: ['credible threat', 'weapon', 'kidnap', 'active shooter', 'bomb'],
    severity: 'critical',
    priority: 'p1',
    shouldOpenIncident: true
  },
  p2: {
    keywords: ['suspicious', 'prowler', 'tamper', 'breach attempt', 'intrusion'],
    severity: 'high',
    priority: 'p2',
    shouldOpenIncident: true
  }
};

function applyRules(text: string) {
  const lowerText = text.toLowerCase();
  
  // Check P1 rules first
  for (const keyword of RULES.p1.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p1.severity,
        priority: RULES.p1.priority,
        shouldOpenIncident: RULES.p1.shouldOpenIncident,
        matchedRule: 'p1',
        matchedKeyword: keyword
      };
    }
  }
  
  // Check P2 rules
  for (const keyword of RULES.p2.keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return {
        severity: RULES.p2.severity,
        priority: RULES.p2.priority,
        shouldOpenIncident: RULES.p2.shouldOpenIncident,
        matchedRule: 'p2',
        matchedKeyword: keyword
      };
    }
  }
  
  return {
    severity: null,
    priority: null,
    shouldOpenIncident: false,
    matchedRule: null,
    matchedKeyword: null
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Validate input
    const rawBody = await req.json();
    const validationResult = SignalInputSchema.safeParse(rawBody);
    
    if (!validationResult.success) {
      console.error('Validation error:', validationResult.error);
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validationResult.error.errors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { source_key, event, text, url, location, raw_json, is_test, client_id: explicitClientId } = validationResult.data;
    
    let signalText = text || JSON.stringify(event);
    let signalLocation = location || null;
    let signalRaw = raw_json || event || { text: signalText };
    
    // If URL is provided, fetch and analyze the website
    if (url) {
      console.log('Fetching website content from:', url);
      
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        
        const websiteResponse = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; SOCBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        if (!websiteResponse.ok) {
          throw new Error(`Failed to fetch website: ${websiteResponse.status}`);
        }

        const html = await websiteResponse.text();
        
        // Improved content extraction
        let textContent = html
          // Remove scripts, styles, and comments
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          // Remove navigation, headers, footers
          .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
          .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
          .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
          // Extract main content preferentially
          .replace(/<(main|article)[^>]*>([\s\S]*?)<\/(main|article)>/gi, (match, tag, content) => {
            return '\n\n' + content + '\n\n';
          });
        
        // Now strip remaining HTML and clean up
        textContent = textContent
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&[^;]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        // Take more content for better analysis
        const contentForAnalysis = textContent.substring(0, 8000);

        console.log(`Extracted ${contentForAnalysis.length} characters from website`);

        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        
        // Enhanced AI analysis with better prompting
        const analysisResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${LOVABLE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `You are a corporate security intelligence analyst specializing in threat assessment. Analyze web content for security-relevant information including:
- Direct threats or security incidents
- Activist campaigns or protests targeting corporations
- Legal disputes or regulatory actions
- Operational disruptions or risks
- Reputation threats or negative publicity
- Supply chain or infrastructure vulnerabilities

Provide a structured, actionable summary focused on business impact.`
              },
              {
                role: 'user',
                content: `Analyze this content from ${url}

CONTENT:
${contentForAnalysis}

Provide a clear summary including:
1. KEY FINDINGS: What security-relevant events or threats are described?
2. AFFECTED PARTIES: Which companies, organizations, or projects are mentioned or impacted?
3. THREAT LEVEL: Rate as CRITICAL, HIGH, MEDIUM, or LOW
4. BUSINESS IMPACT: What are the potential operational, legal, or reputational consequences?
5. ACTIONABLE INTEL: What specific details (dates, locations, actors, tactics) are relevant for security teams?

Be specific and concise. Focus on facts, not speculation.`
              }
            ],
            max_completion_tokens: 1200
          }),
        });

        const analysisData = await analysisResponse.json();
        const analysis = analysisData.choices?.[0]?.message?.content || '';
        
        signalText = `Website Analysis - ${url}\n\n${analysis}`;
        signalLocation = url;
        signalRaw = {
          url,
          analysis,
          snippet: textContent.substring(0, 500),
          scannedAt: new Date().toISOString()
        };

        console.log('Website analysis complete:', analysis.substring(0, 200));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error fetching/analyzing website:', error);
        signalText = `Failed to scan website ${url}: ${errorMessage}`;
        signalRaw = { url, error: errorMessage };
      }
    }
    
    console.log('Ingesting signal:', signalText.substring(0, 100));

    let sourceId = null;
    
    // If source_key provided, validate source
    if (source_key) {
      const { data: source, error: sourceError } = await supabase
        .from('sources')
        .select('id, is_active')
        .eq('name', source_key)
        .single();

      if (sourceError || !source) {
        console.error('Source not found:', source_key);
        return new Response(
          JSON.stringify({ error: 'Source not found or inactive' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!source.is_active) {
        return new Response(
          JSON.stringify({ error: 'Source is not active' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      sourceId = source.id;
    }

    // Step 1: Apply rules-based classification
    const rulesResult = applyRules(signalText);
    console.log('Rules matched:', rulesResult);
    
    // Step 2: Enhance with AI classification
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a security intelligence classifier. Analyze security events and extract:
- normalized_text: clean summary
- entity_tags: array of entities (IPs, domains, usernames)
- location: geographic location if mentioned
- category: type (malware, phishing, intrusion, data_exfil, etc)
- severity: critical, high, medium, or low
- confidence: 0-100 score
Respond ONLY with valid JSON.`
          },
          {
            role: 'user',
            content: signalText
          }
        ],
      }),
    });

    let classification = {
      normalized_text: signalText,
      entity_tags: [],
      location: signalLocation,
      category: 'unknown',
      severity: rulesResult.severity || 'medium',
      confidence: 0.5
    };

    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content;
      if (aiContent) {
        try {
          // Strip markdown code blocks if present
          let jsonStr = aiContent.trim();
          if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          }
          
          const parsed = JSON.parse(jsonStr);
          classification = { ...classification, ...parsed };
          // Normalize confidence to 0-1 range
          if (parsed.confidence && parsed.confidence > 1) {
            classification.confidence = parsed.confidence / 100;
          }
          // Keep rules-based severity if matched
          if (rulesResult.severity) {
            classification.severity = rulesResult.severity;
          }
        } catch (e) {
          console.error('Failed to parse AI response:', e);
        }
      }
    }

    // Match signal to clients using keyword and AI-powered matching
    let clientId: string | null = explicitClientId || null; // CRITICAL FIX: Use explicit client_id if provided
    let matchedKeywords: string[] = [];
    
    // If explicit client_id provided (e.g., from inject_test_signal), skip matching and use it directly
    if (explicitClientId) {
      console.log(`✓ EXPLICIT CLIENT OVERRIDE: Using provided client_id ${explicitClientId}`);
      matchedKeywords.push('explicit_client_override');
    } else {
      // Only perform client matching if no explicit client_id provided
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name, organization, industry, locations, high_value_assets, monitoring_keywords');
      
      if (clients && clients.length > 0) {
      const textLower = signalText.toLowerCase();
      
      // CRITICAL: First check explicit keyword matches
      for (const client of clients) {
        // Check client name
        if (textLower.includes(client.name.toLowerCase())) {
          clientId = client.id;
          matchedKeywords.push(`client_name:${client.name}`);
          console.log(`✓ KEYWORD MATCH via client name: ${client.name}`);
          break;
        }
        
        // Check monitoring keywords
        if (client.monitoring_keywords && Array.isArray(client.monitoring_keywords)) {
          const foundKeywords = client.monitoring_keywords.filter((keyword: string) => 
            textLower.includes(keyword.toLowerCase())
          );
          
          if (foundKeywords.length > 0) {
            clientId = client.id;
            matchedKeywords = foundKeywords;
            console.log(`✓ KEYWORD MATCH for ${client.name}: ${foundKeywords.join(', ')}`);
            break;
          }
        }
      }
      
      // If no keyword match, try AI matching as fallback
      if (!clientId) {
        console.log('No keyword match found, trying AI matching...');
        
        const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
        
        // Build client context for AI matching
        const clientsContext = clients.map(c => ({
          id: c.id,
          name: c.name,
          organization: c.organization,
          industry: c.industry,
          locations: c.locations,
          assets: c.high_value_assets,
          keywords: c.monitoring_keywords
        }));
        
        try {
          const matchResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${LOVABLE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                {
                  role: 'system',
                  content: `You are a client matching specialist. Match security signals to clients based on:
- Direct mentions of client names or organizations
- Monitoring keywords configured for each client
- Industry relevance (e.g., pipeline activism → energy companies)
- Geographic overlap (locations mentioned)
- Asset relevance (e.g., "CGL" or "Coastal GasLink" → pipeline assets)
- Project connections (e.g., LNG projects → energy sector)

Respond with ONLY a JSON object: {"client_id": "uuid-here"} or {"client_id": null} if no match.`
                },
                {
                  role: 'user',
                  content: `Signal content:\n${signalText.substring(0, 2000)}\n\nAvailable clients:\n${JSON.stringify(clientsContext, null, 2)}\n\nWhich client does this signal relate to?`
                }
              ],
              max_completion_tokens: 150
            }),
          });

          if (matchResponse.ok) {
            const matchData = await matchResponse.json();
            let matchContent = matchData.choices?.[0]?.message?.content || '';
            
            // Strip markdown if present
            if (matchContent.startsWith('```')) {
              matchContent = matchContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
            }
            
            const matchResult = JSON.parse(matchContent);
            if (matchResult.client_id) {
              clientId = matchResult.client_id;
              const matchedClient = clients.find(c => c.id === clientId);
              matchedKeywords.push('ai_contextual_match');
              console.log(`Signal matched to client via AI: ${matchedClient?.name}`);
            }
          }
        } catch (error) {
          console.error('AI client matching failed:', error);
        }
      }
    }
    } // Close the explicitClientId else block

    // Calculate content hash BEFORE insertion for duplicate detection
    const encoder = new TextEncoder();
    const data = encoder.encode(signalText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map((b: number) => b.toString(16).padStart(2, '0')).join('');
    
    console.log(`Calculated content hash: ${contentHash.substring(0, 16)}...`);
    
    // Check for duplicates BEFORE insertion
    // - Use normalized_text for near-duplicate detection (more stable than raw text)
    // - Scope to the matched client
    // - Enforce near-duplicate blocking at 80% over the last 30 days
    const dupCheck = await supabase.functions.invoke('detect-duplicates', {
      body: {
        type: 'signal',
        content: (classification.normalized_text || signalText).toString(),
        client_id: clientId || undefined,
        near_duplicate_threshold: 0.8,
        lookback_days: 30,
        use_semantic: true,
        autoCheck: false, // Don't create detection records yet since signal doesn't exist
      },
    });

    if (dupCheck?.data?.isDuplicate && dupCheck?.data?.exactMatch) {
      console.log(`EXACT duplicate detected - blocking signal creation`);
      return new Response(
        JSON.stringify({
          error: 'Duplicate signal detected and blocked',
          duplicate_of: dupCheck.data.duplicate?.id,
          message: dupCheck.data.message,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (dupCheck?.data?.nearDuplicateMatch && (dupCheck?.data?.duplicates || []).length > 0) {
      const top = dupCheck.data.duplicates[0];
      console.log(`NEAR duplicate detected (>=80%) - blocking signal creation`);
      return new Response(
        JSON.stringify({
          error: 'Near-duplicate signal detected and blocked',
          duplicate_of: top?.id,
          similarity_score: top?.similarity_score,
          lookback_days: dupCheck.data.lookback_days_used ?? 30,
          threshold: dupCheck.data.near_duplicate_threshold_used ?? 0.8,
          duplicates: dupCheck.data.duplicates,
          message: `Near-duplicate detected (similarity ${(top?.similarity_score ?? 0).toFixed(2)}). Signal creation blocked.`,
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert signal WITH content_hash from the start
    const { data: signal, error: insertError } = await supabase
      .from('signals')
      .insert({
        source_id: sourceId,
        client_id: clientId,
        raw_json: {
          ...signalRaw,
          matched_keywords: matchedKeywords.length > 0 ? matchedKeywords : undefined
        },
        normalized_text: classification.normalized_text,
        entity_tags: classification.entity_tags,
        location: classification.location,
        category: classification.category,
        severity: classification.severity,
        confidence: classification.confidence,
        status: 'new',
        is_test: is_test || false,
        content_hash: contentHash  // CRITICAL: Include hash in initial insert
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    console.log(`Signal ingested: ${signal.id}${matchedKeywords.length > 0 ? ` (keywords: ${matchedKeywords.join(', ')})` : ''}`);

    // Now create duplicate detection records if any near-duplicates found
    if (dupCheck?.data?.duplicates && dupCheck.data.duplicates.length > 0) {
      console.log(`Found ${dupCheck.data.duplicates.length} near-duplicate signals`);
      try {
        const detections = dupCheck.data.duplicates.map((dup: any) => ({
          detection_type: 'signal',
          source_id: signal.id,
          duplicate_id: dup.id,
          similarity_score: dup.similarity_score || 1.0,
          detection_method: dup.similarity_score ? 'text_similarity' : 'hash',
          status: 'pending'
        }));
        await supabase.from('duplicate_detections').insert(detections);
      } catch (detectionError) {
        console.error('Failed to create duplicate detection records:', detectionError);
        // Don't fail the whole request if detection records fail
      }
    }
    
    // Use intelligent entity correlation system
    await supabase.functions.invoke('correlate-entities', {
      body: {
        text: signalText,
        sourceType: 'signal',
        sourceId: signal.id,
        autoApprove: false
      }
    });
    
    // Apply AI decision engine for rule-based categorization and analysis
    console.log('Invoking AI decision engine for signal categorization...');
    try {
      const aiDecisionResult = await supabase.functions.invoke('ai-decision-engine', {
        body: {
          signal_id: signal.id,
          force_ai: rulesResult.priority === 'p1' || rulesResult.priority === 'p2'
        }
      });
      
      if (aiDecisionResult.error) {
        console.error('AI decision engine error:', aiDecisionResult.error);
      } else {
        console.log('AI decision engine result:', aiDecisionResult.data);
        
        // Check if AI decision recommends incident creation
        if (aiDecisionResult.data?.decision?.should_create_incident) {
          const { error: incidentError } = await supabase
            .from('incidents')
            .insert({
              signal_id: signal.id,
              client_id: signal.client_id,
              priority: aiDecisionResult.data.decision.incident_priority || rulesResult.priority,
              status: 'open',
              is_test: signal.is_test || false,
              title: `AI-Escalated: ${signal.title || signal.normalized_text?.substring(0, 100)}`,
              summary: aiDecisionResult.data.decision.reasoning,
              sla_targets_json: { 
                mttd: 10, 
                mttr: aiDecisionResult.data.decision.incident_priority === 'p1' ? 60 : 120 
              },
              timeline_json: [{
                timestamp: new Date().toISOString(),
                action: 'incident_opened',
                details: `Auto-opened by AI Decision Engine: ${aiDecisionResult.data.decision.threat_level} threat`
              }]
            });
          
          if (incidentError) {
            console.error('Error creating incident:', incidentError);
          } else {
            console.log('Incident auto-opened by AI decision for signal:', signal.id);
          }
        }
      }
    } catch (error) {
      console.error('Failed to invoke AI decision engine:', error);
      // Don't fail the main request if AI decision fails
    }
    
    // Auto-open incident based on rules (fallback if AI didn't create one)
    if (rulesResult.shouldOpenIncident) {
      // Check if incident was already created by AI
      const { data: existingIncident } = await supabase
        .from('incidents')
        .select('id')
        .eq('signal_id', signal.id)
        .single();
      
      if (!existingIncident) {
        const { error: incidentError } = await supabase
          .from('incidents')
          .insert({
            signal_id: signal.id,
            client_id: signal.client_id,
            priority: rulesResult.priority,
            status: 'open',
            is_test: signal.is_test || false,
            sla_targets_json: { 
              mttd: 10, 
              mttr: rulesResult.priority === 'p1' ? 60 : 120 
            },
            timeline_json: [{
              timestamp: new Date().toISOString(),
              action: 'incident_opened',
              details: `Auto-opened by rule: ${rulesResult.matchedRule} (${rulesResult.matchedKeyword})`
            }]
          });
        
        if (incidentError) {
          console.error('Error creating incident:', incidentError);
        } else {
          console.log('Incident auto-opened for signal:', signal.id);
        }
      }
    }

    // Trigger signal correlation (async, don't wait for it)
    try {
      console.log('Triggering signal correlation...');
      supabase.functions.invoke('correlate-signals', {
        body: { signal_id: signal.id }
      }).then(({ data, error }) => {
        if (error) {
          console.error('Correlation error:', error);
        } else {
          console.log('Correlation result:', data);
        }
      });
    } catch (error) {
      console.error('Failed to trigger correlation:', error);
      // Don't fail the main request if correlation fails
    }

    // Enqueue signal for batch processing instead of immediate processing
    // This is more scalable and prevents memory issues
    try {
      const priority = rulesResult.priority === 'p1' ? 1 :
                      rulesResult.priority === 'p2' ? 2 : 5;
      
      const { error: queueError } = await supabase.rpc('enqueue_signal_processing', {
        signal_id: signal.id,
        priority_level: priority
      });

      if (queueError) {
        console.error('Error enqueuing signal:', queueError);
        // Don't fail the main request if queuing fails
      } else {
        console.log(`Signal ${signal.id} enqueued for processing with priority ${priority}`);
      }
    } catch (error) {
      console.error('Failed to enqueue signal:', error);
      // Don't fail the main request if queuing fails
    }

    return new Response(
      JSON.stringify({ 
        signal_id: signal.id,
        status: 'enqueued',
        message: 'Signal enqueued for batch processing'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in ingest-signal:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
