import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.22.4";
import { isFalsePositiveContent } from '../_shared/keyword-matcher.ts';
import { isTestContent, scoreSignalRelevance } from '../_shared/signal-relevance-scorer.ts';
import { callAiGateway, callAiGatewayJson } from '../_shared/ai-gateway.ts';
import { logError } from '../_shared/error-logger.ts';

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

Deno.serve(async (req) => {
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
    
    // Health check endpoint for pipeline tests
    if (rawBody.health_check) {
      return new Response(
        JSON.stringify({ 
          status: 'healthy', 
          function: 'ingest-signal',
          timestamp: new Date().toISOString() 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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
    
    // CRITICAL FIX: Validate explicit client_id if provided
    let validatedExplicitClientId: string | null = null;
    if (explicitClientId) {
      const { data: clientCheck, error: clientCheckError } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', explicitClientId)
        .single();
      
      if (clientCheckError || !clientCheck) {
        console.error(`⚠ INVALID CLIENT_ID: Provided client_id ${explicitClientId} does not exist`);
        return new Response(
          JSON.stringify({ 
            error: 'Invalid client_id', 
            message: `Client with id ${explicitClientId} not found` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      validatedExplicitClientId = clientCheck.id;
      console.log(`✓ VALIDATED EXPLICIT CLIENT: ${clientCheck.name} (${clientCheck.id})`);
    }
    
    let signalText = text || JSON.stringify(event);
    
    // EARLY REJECTION: Check for false positive content patterns
    if (isFalsePositiveContent(signalText)) {
      console.log(`[FP Filter] Rejecting false positive signal: ${signalText.substring(0, 100)}...`);
      return new Response(
        JSON.stringify({ 
          status: 'rejected',
          reason: 'false_positive_pattern',
          message: 'Content matches known false positive pattern'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // EARLY REJECTION: Check for test/verification content
    if (isTestContent(signalText)) {
      console.log(`[Test Filter] Rejecting test content: ${signalText.substring(0, 100)}...`);
      return new Response(
        JSON.stringify({ 
          status: 'rejected',
          reason: 'test_content',
          message: 'Test/verification content rejected from production pipeline'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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

        // Enhanced AI analysis with better prompting (resilient)
        const analysisResult = await callAiGateway({
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
          functionName: 'ingest-signal',
          extraBody: { max_completion_tokens: 1200 },
          dlqOnFailure: true,
          dlqPayload: { url, signalText: signalText.substring(0, 500) },
        });

        const analysis = analysisResult.content || '';
        
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
    
    // Step 2: Enhance with AI classification (resilient)
    let classification = {
      normalized_text: signalText,
      entity_tags: [],
      location: signalLocation,
      category: 'unknown',
      severity: rulesResult.severity || 'medium',
      confidence: 0.5
    };

    const classResult = await callAiGatewayJson({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a security intelligence classifier. Analyze security events and extract:
- normalized_text: clean summary of the event
- entity_tags: array of entities (people, organizations, locations, IPs, domains)
- location: geographic location if mentioned
- category: type (malware, phishing, intrusion, data_exfil, protest, activism, regulatory, environmental, social_sentiment, crime, sabotage, legal, document_upload, etc)
- severity: critical, high, medium, or low
- confidence: 0-100 score
- event_date: the ISO 8601 date (YYYY-MM-DD) of WHEN THE DESCRIBED EVENT ACTUALLY OCCURRED. Look for specific dates, years, seasons, or temporal references in the text. If the text says "January 9, 2019" the event_date is "2019-01-09". If the text says "December 4th, 2023" the event_date is "2023-12-04". If the event appears to be happening now or no date is discernible, use null.
- is_historical: boolean — true if the described event occurred more than 90 days ago based on temporal clues in the text. Look for past years (2019, 2020, 2021, 2022, 2023, 2024, early 2025), phrases like "years ago", concluded campaigns, archived content.

CRITICAL TEMPORAL RULES:
- Extract the ACTUAL event date from the text, NOT the publication/crawl date.
- "January 9, 2019" means event_date: "2019-01-09", NOT "2026-01-09".
- If the event is historical (>90 days old), severity MUST be "low" regardless of how dramatic the event was.
- Historical events are NOT current threats.

Respond ONLY with valid JSON.`
        },
        { role: 'user', content: signalText }
      ],
      functionName: 'ingest-signal',
      dlqOnFailure: true,
      dlqPayload: { signalText: signalText.substring(0, 500) },
    });

    if (classResult.data) {
      classification = { ...classification, ...classResult.data };
      // Normalize confidence to 0-1 range
      if (classResult.data.confidence && classResult.data.confidence > 1) {
        classification.confidence = classResult.data.confidence / 100;
      }
      // Keep rules-based severity if matched
      if (rulesResult.severity) {
        classification.severity = rulesResult.severity;
      }
      // ═══ HISTORICAL CONTENT GUARDRAIL AT INGESTION ═══
      // If AI identifies this as historical content, force severity to low
      if (classResult.data.is_historical === true) {
        console.log(`[HISTORICAL GUARDRAIL] AI classified signal as historical — forcing severity to low`);
        if (!rulesResult.severity) {
          classification.severity = 'low';
        }
      }
    }

    // Match signal to clients using keyword and AI-powered matching
    let clientId: string | null = validatedExplicitClientId || null; // Use validated explicit client_id if provided
    let matchedKeywords: string[] = [];
    let matchConfidence: 'explicit' | 'high' | 'medium' | 'low' | 'ai' | 'none' = 'none';
    
    // If explicit client_id provided (e.g., from inject_test_signal), skip matching and use it directly
    if (validatedExplicitClientId) {
      console.log(`✓ EXPLICIT CLIENT OVERRIDE: Using validated client_id ${validatedExplicitClientId}`);
      matchedKeywords.push('explicit_client_override');
      matchConfidence = 'explicit';
    } else {
      // Only perform client matching if no explicit client_id provided
      const { data: clients } = await supabase
        .from('clients')
        .select('id, name, organization, industry, locations, high_value_assets, monitoring_keywords');
      
      if (clients && clients.length > 0) {
      const textLower = signalText.toLowerCase();
      
      // IMPROVED MATCHING: Score all clients and pick the best match
      // This prevents generic keywords from incorrectly matching before specific ones
      interface ClientScore {
        client: typeof clients[0];
        score: number;
        matchedKeywords: string[];
        matchType: 'name' | 'keyword' | 'asset' | 'location';
      }
      
      const clientScores: ClientScore[] = [];
      
      for (const client of clients) {
        let score = 0;
        const foundKeywords: string[] = [];
        let matchType: 'name' | 'keyword' | 'asset' | 'location' = 'keyword';
        
        // Check client name (highest priority - 1000 points base + length bonus)
        if (textLower.includes(client.name.toLowerCase())) {
          score += 1000 + client.name.length;
          foundKeywords.push(`client_name:${client.name}`);
          matchType = 'name';
        }
        
        // Check monitoring keywords - score by specificity (length) and count
        if (client.monitoring_keywords && Array.isArray(client.monitoring_keywords)) {
          for (const keyword of client.monitoring_keywords) {
            if (keyword && textLower.includes(keyword.toLowerCase())) {
              // Longer keywords are more specific, worth more points
              // Also count word count - multi-word phrases are more specific
              const wordCount = keyword.split(/\s+/).length;
              const keywordScore = keyword.length + (wordCount * 10);
              score += keywordScore;
              foundKeywords.push(keyword);
            }
          }
        }
        
        // Check high value assets (slightly lower priority than keywords)
        if (client.high_value_assets && Array.isArray(client.high_value_assets)) {
          for (const asset of client.high_value_assets) {
            if (asset && textLower.includes(asset.toLowerCase())) {
              const assetScore = asset.length + 5;
              score += assetScore;
              foundKeywords.push(`asset:${asset}`);
              if (matchType === 'keyword') matchType = 'asset';
            }
          }
        }
        
        // Check locations
        if (client.locations && Array.isArray(client.locations)) {
          for (const location of client.locations) {
            if (location && textLower.includes(location.toLowerCase())) {
              score += 15; // Location match bonus
              foundKeywords.push(`location:${location}`);
              if (matchType === 'keyword') matchType = 'location';
            }
          }
        }
        
        if (score > 0) {
          clientScores.push({
            client,
            score,
            matchedKeywords: foundKeywords,
            matchType
          });
        }
      }
      
      // Sort by score descending and pick the best match
      if (clientScores.length > 0) {
        clientScores.sort((a, b) => b.score - a.score);
        const bestMatch = clientScores[0];
        clientId = bestMatch.client.id;
        matchedKeywords = bestMatch.matchedKeywords;
        
        // Determine match confidence based on score and match type
        if (bestMatch.matchType === 'name' || bestMatch.score >= 1000) {
          matchConfidence = 'high';
        } else if (bestMatch.score >= 50) {
          matchConfidence = 'medium';
        } else {
          matchConfidence = 'low';
        }
        
        console.log(`✓ BEST MATCH: ${bestMatch.client.name} (score: ${bestMatch.score}, type: ${bestMatch.matchType}, confidence: ${matchConfidence})`);
        console.log(`  Matched keywords: ${matchedKeywords.join(', ')}`);
        
        // Log runner-up if there was competition
        if (clientScores.length > 1) {
          const runnerUp = clientScores[1];
          console.log(`  Runner-up: ${runnerUp.client.name} (score: ${runnerUp.score})`);
          
          // Warn if scores are close - potential misattribution risk
          if (bestMatch.score > 0 && runnerUp.score / bestMatch.score > 0.7) {
            console.warn(`⚠ CLOSE MATCH WARNING: Runner-up score is ${Math.round(runnerUp.score / bestMatch.score * 100)}% of best match. Review may be needed.`);
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
              // Validate AI-suggested client_id exists
              const aiSuggestedClient = clients.find(c => c.id === matchResult.client_id);
              if (aiSuggestedClient) {
                clientId = matchResult.client_id;
                matchedKeywords.push('ai_contextual_match');
                matchConfidence = 'ai';
                console.log(`✓ AI MATCH: Signal matched to client ${aiSuggestedClient.name}`);
              } else {
                console.warn(`⚠ AI suggested invalid client_id: ${matchResult.client_id}`);
              }
            }
          }
        } catch (error) {
          console.error('AI client matching failed:', error);
        }
      }
      
      // Log unmatched signals for audit trail
      if (!clientId) {
        console.warn(`⚠ UNMATCHED SIGNAL: No client could be matched for signal. Text preview: ${signalText.substring(0, 200)}`);
        matchConfidence = 'none';
      }
    }
    } // Close the validatedExplicitClientId else block

    // Calculate content hash BEFORE insertion for duplicate detection
    const encoder = new TextEncoder();
    const data = encoder.encode(signalText);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map((b: number) => b.toString(16).padStart(2, '0')).join('');
    
    console.log(`Calculated content hash: ${contentHash.substring(0, 16)}...`);
    
    // Check if this content was previously rejected/deleted by user
    const { data: rejectedHash } = await supabase
      .from('rejected_content_hashes')
      .select('id')
      .eq('content_hash', contentHash)
      .limit(1)
      .maybeSingle();

    if (rejectedHash) {
      console.log(`[Rejected] Signal blocked - content was previously rejected/deleted`);
      return new Response(
        JSON.stringify({
          status: 'rejected',
          reason: 'previously_rejected',
          message: 'This content was previously deleted or marked irrelevant by an analyst'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
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

    // ===== SAME-STORY FILING: Catch moderate-similarity signals (50-70%) =====
    // These aren't exact/near duplicates, but are about the SAME ongoing story.
    // File them as signal_updates on the existing signal instead of creating noise.
    if (dupCheck?.data?.duplicates && dupCheck.data.duplicates.length > 0) {
      const topMatch = dupCheck.data.duplicates[0];
      const similarity = topMatch?.similarity_score ?? 0;
      
      // 50-79% similarity range — same story, different article
      if (similarity >= 0.50 && similarity < 0.80 && topMatch?.id) {
        console.log(`[Same-Story] Moderate similarity ${(similarity * 100).toFixed(0)}% with signal ${topMatch.id} — checking if same story...`);
        
        try {
          // Quick AI check: is this genuinely new intelligence or a rehash?
          const existingTitle = topMatch.title || '';
          const newTitle = (classification.normalized_text || signalText).substring(0, 300);
          
          const sameStoryCheck = await callAiGatewayJson({
            model: 'google/gemini-2.5-flash-lite',
            messages: [
              {
                role: 'system',
                content: 'You determine if two intelligence signals are about the same ongoing story/event. Return JSON with: {"same_story": boolean, "has_new_intel": boolean, "reason": "brief explanation"}. "same_story" means they describe the same event, policy, or situation. "has_new_intel" means the new signal contains genuinely new facts, developments, or outcomes not present in the existing one.'
              },
              {
                role: 'user',
                content: `EXISTING SIGNAL: "${existingTitle}"\n\nNEW SIGNAL: "${newTitle}"\n\nAre these about the same story? Does the new one add genuinely new intelligence?`
              }
            ],
            functionName: 'ingest-signal-same-story-check',
          });

          const sameStoryResult = sameStoryCheck as any;
          
          if (sameStoryResult?.same_story === true && sameStoryResult?.has_new_intel !== true) {
            console.log(`[Same-Story] FILING as update on ${topMatch.id}: ${sameStoryResult.reason}`);
            
            // Generate content hash for the update
            const updateHashData = new TextEncoder().encode(`same-story|${topMatch.id}|${contentHash}`);
            const updateHashBuffer = await crypto.subtle.digest('SHA-256', updateHashData);
            const updateHash = Array.from(new Uint8Array(updateHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
            
            // Check if this update already exists
            const { data: existingUpdate } = await supabase
              .from('signal_updates')
              .select('id')
              .eq('content_hash', updateHash)
              .maybeSingle();
            
            if (!existingUpdate) {
              await supabase.from('signal_updates').insert({
                signal_id: topMatch.id,
                content: (classification.normalized_text || signalText).substring(0, 2000),
                source_name: 'same-story-filing',
                content_hash: updateHash,
                metadata: {
                  filed_reason: sameStoryResult.reason,
                  similarity_score: similarity,
                  original_content_hash: contentHash,
                  same_story_check: true,
                },
              });
            }
            
            // Block the content hash so it doesn't come back
            await supabase.from('rejected_content_hashes').upsert({
              content_hash: contentHash,
              client_id: clientId,
              reason: 'same_story_filed',
              original_signal_title: newTitle.substring(0, 200),
            }, { onConflict: 'content_hash,client_id', ignoreDuplicates: true });
            
            return new Response(
              JSON.stringify({
                status: 'filed_as_update',
                filed_on: topMatch.id,
                similarity_score: similarity,
                reason: sameStoryResult.reason,
                message: 'Signal filed as update on existing signal (same story, no new intelligence)',
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            console.log(`[Same-Story] NEW intelligence detected — creating as new signal. Reason: ${sameStoryResult?.reason || 'has new intel'}`);
          }
        } catch (sameStoryErr) {
          console.warn(`[Same-Story] AI check failed, proceeding with new signal:`, sameStoryErr);
          // Fail open — create the signal rather than risk losing new intel
        }
      }
    }

    // Generate title from normalized_text (first sentence or first 100 chars)
    const generateTitle = (text: string): string => {
      if (!text || text.length === 0) return 'Signal - ' + new Date().toISOString().slice(0, 16);
      
      // Find first sentence end
      const sentenceEndMatch = text.match(/[.!?]/);
      const firstSentenceEnd = sentenceEndMatch ? (sentenceEndMatch.index ?? 99) + 1 : 100;
      
      // Take first sentence or first 100 chars, whichever is shorter
      const titleLength = Math.min(firstSentenceEnd, 100);
      let title = text.substring(0, titleLength).trim();
      
      // Add ellipsis if truncated mid-sentence
      if (titleLength === 100 && text.length > 100) {
        title = title.replace(/\s+\S*$/, '') + '...';
      }
      
      return title || 'Signal - ' + new Date().toISOString().slice(0, 16);
    };
    
    const signalTitle = generateTitle(classification.normalized_text || signalText);
    
    // ===== AI RELEVANCE GATE: Fast LLM check for client-specific relevance =====
    // This catches what keyword matching misses: geographic irrelevance, corporate PR,
    // historical content, and tangentially-related signals.
    if (clientId) {
      try {
        const { data: clientForGate } = await supabase
          .from('clients')
          .select('name, industry, locations, high_value_assets')
          .eq('id', clientId)
          .single();

        if (clientForGate) {
          const gateResult = await callAiGatewayJson({
            model: 'google/gemini-2.5-flash-lite',
            messages: [
              {
                role: 'system',
                content: `You are a signal relevance filter for a corporate security intelligence platform. Your ONLY job is to determine if a signal is ACTIONABLE INTELLIGENCE worth showing to an analyst.

REJECT signals that are:
1. GEOGRAPHICALLY IRRELEVANT: About events/protests/incidents in regions unrelated to the client's operations (e.g., Paris attacks, Australian protests, Standing Rock when client operates in BC/Alberta)
2. CORPORATE PR / POSITIVE CONTENT: The client's own press releases, social media promotions, sponsorship announcements, community goodwill posts
3. HISTORICAL: Events from more than 6 months ago (old protests, historical incidents) with no current relevance
4. TANGENTIALLY RELATED: Mentions a keyword (e.g., "pipeline", "LNG") but is about a completely unrelated industry or context (e.g., software data pipelines, plumbing). Note: Other major pipeline projects (Keystone XL, Trans Mountain, DAPL, etc.) ARE relevant if they involve protests, regulatory precedents, or activist tactics that could affect the client's operations or set industry precedent
5. LOW-VALUE NOISE: Generic environmental org "about us" pages, merch listings, unrelated entertainment, sports content
6. NO THREAT/RISK VALUE: Content that describes no threat, risk, legal action, protest, sabotage, or operational concern

ACCEPT signals that are:
- Direct threats, protests, or sabotage targeting the client's specific assets
- Legal/regulatory actions affecting the client's operations
- Activist campaigns specifically targeting the client or their projects
- Security incidents in the client's operational area
- Supply chain or partner risks directly impacting the client

Respond with JSON: {"relevant": true/false, "reason": "one sentence explanation"}`
              },
              {
                role: 'user',
                content: `CLIENT: ${clientForGate.name}
INDUSTRY: ${clientForGate.industry || 'unknown'}
LOCATIONS: ${(clientForGate.locations || []).join(', ')}
KEY ASSETS: ${(clientForGate.high_value_assets || []).join(', ')}

SIGNAL TO EVALUATE:
${(classification.normalized_text || signalText).substring(0, 1500)}

Is this signal actionable intelligence for this specific client?`
              }
            ],
            functionName: 'ingest-signal-relevance-gate',
            extraBody: { max_completion_tokens: 100 },
          });

          if (gateResult.data && gateResult.data.relevant === false) {
            console.log(`[AI Relevance Gate] REJECTED: ${gateResult.data.reason}`);
            
            // Store the hash so it doesn't come back
            const encoder2 = new TextEncoder();
            const data2 = encoder2.encode(classification.normalized_text || signalText);
            const hashBuffer2 = await crypto.subtle.digest('SHA-256', data2);
            const hashArray2 = Array.from(new Uint8Array(hashBuffer2));
            const rejectedHash2 = hashArray2.map((b: number) => b.toString(16).padStart(2, '0')).join('');
            
            await supabase.from('rejected_content_hashes').insert({
              content_hash: rejectedHash2,
              client_id: clientId,
              reason: 'ai_relevance_gate',
              original_signal_title: signalTitle.substring(0, 200)
            }).then(() => {}).catch(() => {});

            return new Response(
              JSON.stringify({
                status: 'rejected',
                reason: 'ai_relevance_gate',
                detail: gateResult.data.reason,
                message: 'Signal rejected by AI relevance gate - not actionable intelligence for this client'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            console.log(`[AI Relevance Gate] ACCEPTED: ${gateResult.data?.reason || 'relevant'}`);
          }
        }
      } catch (gateError) {
        // Non-blocking - if the gate fails, let the signal through
        console.error('[AI Relevance Gate] Error (non-blocking):', gateError);
      }
    }

    // ===== RELEVANCE SCORING: Use learned patterns to gate noise =====
    const severityNum = classification.severity === 'critical' ? 100 :
                        classification.severity === 'high' ? 75 :
                        classification.severity === 'medium' ? 50 :
                        classification.severity === 'low' ? 20 : 50;
    
    const relevanceResult = await scoreSignalRelevance(
      supabase,
      classification.normalized_text || signalText,
      classification.category || null,
      severityNum
    );
    
    console.log(`[Relevance] Score: ${relevanceResult.score.toFixed(2)}, Recommendation: ${relevanceResult.recommendation}, Patterns: ${relevanceResult.matchedPatterns.join(', ')}`);
    
    // Suppress signals that are clearly noise
    if (relevanceResult.recommendation === 'suppress') {
      console.log(`[Relevance] SUPPRESSING signal: ${relevanceResult.reason}`);
      return new Response(
        JSON.stringify({ 
          status: 'suppressed',
          reason: relevanceResult.reason,
          relevance_score: relevanceResult.score,
          matched_patterns: relevanceResult.matchedPatterns,
          message: 'Signal suppressed by relevance filter based on learned patterns'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Determine status based on relevance
    const signalStatus = relevanceResult.recommendation === 'low_confidence' 
      ? 'low_confidence' 
      : 'new';
    
    // Extract event_date: AI-extracted date takes priority over raw metadata
    let eventDate: string | null = null;
    let triageOverride: string | null = null;
    
    // Priority 1: AI-extracted event_date (from text analysis — most accurate)
    if (classResult.data?.event_date) {
      try {
        const parsed = new Date(classResult.data.event_date);
        if (!isNaN(parsed.getTime())) {
          eventDate = parsed.toISOString();
          console.log(`[EventDate] AI-extracted event_date: ${eventDate}`);
          
          // Auto-triage historical signals
          const ninetyDaysAgo = new Date();
          ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
          if (parsed < ninetyDaysAgo) {
            triageOverride = 'historical';
            console.log(`[EventDate] Signal is historical (${classResult.data.event_date}) — auto-triaging to historical tab`);
          }
        }
      } catch { /* ignore */ }
    }
    
    // Priority 2: Raw metadata pubDate (fallback, often just the crawl date)
    if (!eventDate) {
      const rawPubDate = signalRaw?.pubDate || signalRaw?.published_date || signalRaw?.published || signalRaw?.date;
      if (rawPubDate) {
        try {
          const parsed = new Date(rawPubDate);
          if (!isNaN(parsed.getTime())) {
            eventDate = parsed.toISOString();
          }
        } catch { /* ignore */ }
      }
    }

    // Insert signal WITH content_hash and title from the start
    // Include match metadata for audit trail and potential re-assignment
    const { data: signal, error: insertError } = await supabase
      .from('signals')
      .insert({
        source_id: sourceId,
        client_id: clientId,
        title: signalTitle,
        raw_json: {
          ...signalRaw,
          matched_keywords: matchedKeywords.length > 0 ? matchedKeywords : undefined,
          match_confidence: matchConfidence,
          match_timestamp: new Date().toISOString(),
          relevance_score: relevanceResult.score,
          relevance_patterns: relevanceResult.matchedPatterns,
          relevance_recommendation: relevanceResult.recommendation
        },
        normalized_text: classification.normalized_text,
        entity_tags: classification.entity_tags,
        location: classification.location,
        category: classification.category,
        severity: classification.severity,
        confidence: classification.confidence,
        relevance_score: relevanceResult.score,
        status: signalStatus,
        is_test: is_test || false,
        content_hash: contentHash,
        event_date: eventDate,
        triage_override: triageOverride
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
    
    // Use intelligent entity correlation system (async, non-blocking)
    supabase.functions.invoke('correlate-entities', {
      body: {
        text: signalText,
        sourceType: 'signal',
        sourceId: signal.id,
        autoApprove: false
      }
    }).catch(err => console.error('Entity correlation error:', err));
    
    // ===== EXPERT KNOWLEDGE ENRICHMENT (async, non-blocking) =====
    // Match incoming signal against learned expert knowledge for contextual intelligence
    (async () => {
      try {
        const signalCategory = classification.category || '';
        const signalSeverity = classification.severity || 'medium';
        
        // Map signal category to expert knowledge domain
        const domainMap: Record<string, string> = {
          malware: 'cyber', phishing: 'cyber', intrusion: 'cyber', data_exfil: 'cyber',
          ransomware: 'cyber', data_exposure: 'cyber', cyber: 'cyber',
          protest: 'geopolitical', civil_unrest: 'geopolitical', regulatory: 'compliance',
          theft: 'physical_security', sabotage: 'physical_security', violence: 'physical_security',
          surveillance: 'physical_security', trespass: 'physical_security',
          threat: 'threat_intelligence', emergency: 'crisis_management',
          wildfire: 'crisis_management', weather: 'crisis_management', earthquake: 'crisis_management',
          travel: 'travel_security', executive: 'executive_protection',
        };
        
        const mappedDomain = domainMap[signalCategory] || null;
        
        // Build search keywords from signal text (top 8 meaningful words)
        const stopWords = new Set(['the','a','an','is','are','was','were','be','been','has','have','had','do','does','did','will','would','could','should','may','might','shall','can','for','and','but','or','not','no','this','that','these','those','from','with','into','about','after','before','during','between','through','above','below','under','over','such','than','too','very','just','also','more','most','some','any','each','every','all','both','few','many','much','other','another','new','old','first','last','long','great','little','own','same','big','high','small','large','next','early','young','important','few','public','bad','good']);
        const keywords = (classification.normalized_text || signalText)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3 && !stopWords.has(w))
          .slice(0, 8);
        
        if (keywords.length < 2) return; // Not enough signal content to match
        
        // Query expert knowledge for matching entries
        let query = supabase
          .from('expert_knowledge')
          .select('id, domain, subdomain, knowledge_type, title, content, applicability_tags, confidence_score')
          .eq('is_active', true)
          .gte('confidence_score', 0.7)
          .order('confidence_score', { ascending: false })
          .limit(5);
        
        // Filter by domain if we can map it
        if (mappedDomain) {
          query = query.eq('domain', mappedDomain);
        }
        
        // Use OR conditions on keywords for relevance matching
        const orConditions = keywords
          .slice(0, 4)
          .map(k => `title.ilike.%${k}%,content.ilike.%${k}%,applicability_tags.cs.{${k}}`)
          .join(',');
        query = query.or(orConditions);
        
        const { data: matchedKnowledge, error: knowledgeError } = await query;
        
        if (knowledgeError) {
          console.error('[Knowledge Enrichment] Query error:', knowledgeError);
          return;
        }
        
        if (!matchedKnowledge || matchedKnowledge.length === 0) {
          console.log(`[Knowledge Enrichment] No matches for signal ${signal.id} (domain: ${mappedDomain || 'any'})`);
          return;
        }
        
        // Build expert context payload
        const expertContext = {
          matched_at: new Date().toISOString(),
          domain: mappedDomain,
          matches: matchedKnowledge.map(k => ({
            id: k.id,
            title: k.title,
            domain: k.domain,
            subdomain: k.subdomain,
            knowledge_type: k.knowledge_type,
            confidence: k.confidence_score,
            // Include actionable excerpt (first 300 chars of content)
            excerpt: k.content.substring(0, 300),
            tags: k.applicability_tags,
          })),
          total_matches: matchedKnowledge.length,
          enrichment_keywords: keywords.slice(0, 4),
        };
        
        // Update signal with expert context
        await supabase
          .from('signals')
          .update({ expert_context: expertContext })
          .eq('id', signal.id);
        
        console.log(`[Knowledge Enrichment] ✅ Signal ${signal.id} enriched with ${matchedKnowledge.length} expert knowledge entries (domain: ${mappedDomain || 'cross-domain'})`);
        
        // For high-severity signals, also trigger reactive learning if no matches found in the mapped domain
        if ((signalSeverity === 'critical' || signalSeverity === 'high') && matchedKnowledge.length < 2) {
          console.log(`[Knowledge Enrichment] Knowledge gap detected for ${signalSeverity} signal — triggering reactive learning`);
          supabase.functions.invoke('agent-self-learning', {
            body: {
              mode: 'reactive',
              topic: `${signalCategory} security threat: ${(classification.normalized_text || signalText).substring(0, 200)}`,
              context: `High-severity signal detected with insufficient expert knowledge coverage in domain "${mappedDomain || 'unknown'}"`,
              agent_call_sign: mappedDomain === 'cyber' ? 'NEO' : mappedDomain === 'physical_security' ? 'ARGUS' : mappedDomain === 'geopolitical' ? 'MERIDIAN' : 'AEGIS-CMD',
            }
          }).catch(err => console.error('[Knowledge Enrichment] Reactive learning error:', err));
        }
      } catch (enrichError) {
        console.error('[Knowledge Enrichment] Error (non-blocking):', enrichError);
      }
    })();
    
    // ===== CRITICAL SIGNAL FAST-PATH (P0 Priority) =====
    // For P1/Critical signals: Bypass queue, parallel execution for sub-10s latency
    const isCriticalFastPath = 
      rulesResult.priority === 'p1' || 
      rulesResult.severity === 'critical' ||
      classification.severity === 'critical';
    
    if (isCriticalFastPath) {
      console.log('🚨 CRITICAL FAST-PATH ACTIVATED for signal:', signal.id);
      const fastPathStartTime = Date.now();
      
      // Build critical signal payload
      const criticalSignalPayload = {
        id: signal.id,
        normalized_text: signal.normalized_text,
        source: signal.source_id,
        category: classification.category || rulesResult.matchedRule,
        severity: 'critical',
        status: 'critical_processing',
        client_id: clientId,
        match_confidence: 1.0,
        detected_at: signal.detected_at || new Date().toISOString(),
        rule_matched: rulesResult.matchedRule,
        keyword_matched: rulesResult.matchedKeyword,
      };
      
      // PARALLEL EXECUTION: AI Decision + Webhook + Alert in parallel
      const [aiResult, webhookResult, alertResult] = await Promise.allSettled([
        // 1. AI Decision Engine with force_ai for immediate deep analysis
        supabase.functions.invoke('ai-decision-engine', {
          body: {
            signal_id: signal.id,
            force_ai: true
          }
        }),
        
        // 2. Webhook Dispatcher for external system integration
        supabase.functions.invoke('webhook-dispatcher', {
          body: {
            event_type: 'signal.p1_critical',
            signal: criticalSignalPayload,
          }
        }),
        
        // 3. Create immediate P1 incident for alert-delivery
        (async () => {
          // Check if incident exists
          const { data: existingIncident } = await supabase
            .from('incidents')
            .select('id')
            .eq('signal_id', signal.id)
            .maybeSingle();
          
          if (!existingIncident) {
            const { data: newIncident, error: incidentError } = await supabase
              .from('incidents')
              .insert({
                signal_id: signal.id,
                client_id: clientId,
                priority: 'p1',
                status: 'open',
                severity_level: 'P1',
                is_test: signal.is_test || false,
                title: `🚨 CRITICAL: ${signal.normalized_text?.substring(0, 80)}`,
                summary: `Fast-path critical signal detected. Rule: ${rulesResult.matchedRule || 'AI-classified'}. Keyword: ${rulesResult.matchedKeyword || 'N/A'}`,
                sla_targets_json: { mttd: 5, mttr: 30 },
                timeline_json: [{
                  timestamp: new Date().toISOString(),
                  action: 'critical_fast_path',
                  details: `Critical signal detected via fast-path. Processing time target: <10s`
                }]
              })
              .select('id')
              .single();
            
            if (incidentError) {
              console.error('Fast-path incident creation error:', incidentError);
              return { error: incidentError };
            }
            
            // Create immediate alert for delivery
            if (newIncident) {
              // Insert email alert
              await supabase.from('alerts').insert({
                incident_id: newIncident.id,
                channel: 'email',
                recipient: 'critical-alerts@fortress.ai', // Configurable
                status: 'pending',
                response_json: {
                  subject: `🚨 P1 CRITICAL: ${signal.normalized_text?.substring(0, 50)}`,
                  body: signal.normalized_text,
                  threat_level: 'critical',
                  location: signal.location || 'Unknown',
                  reasoning: `Fast-path detection: ${rulesResult.matchedKeyword || 'AI-classified critical threat'}`,
                  containment_actions: [
                    'Verify threat validity immediately',
                    'Notify client security team',
                    'Prepare incident response resources'
                  ],
                  priority: 'immediate'
                }
              });
              
              // Trigger email alert delivery immediately
              supabase.functions.invoke('alert-delivery', {
                body: { priority: 'immediate' }
              }).catch(err => console.error('Alert delivery error:', err));
              
              // === SECURE MESSAGING FAST-PATH ===
              // Parallel delivery to Teams/Slack/SMS for P1 critical alerts
              supabase.functions.invoke('alert-delivery-secure', {
                body: {
                  incident_id: newIncident.id,
                  signal_id: signal.id,
                  priority: 'p1',
                  title: signal.normalized_text?.substring(0, 100) || 'Critical Security Alert',
                  summary: signal.normalized_text || 'Critical threat detected via fast-path processing',
                  threat_level: 'critical',
                  location: signal.location || 'Unknown',
                  client_id: clientId,
                  client_name: null, // Will be resolved in alert-delivery-secure
                  recommended_actions: [
                    'Verify threat validity immediately',
                    'Notify client security team',
                    'Activate incident response protocol',
                    'Document all actions taken'
                  ],
                  channels: ['teams', 'slack', 'sms'] // All secure channels
                }
              }).catch(err => console.error('Secure alert delivery error:', err));
            }
            
            return { incident_id: newIncident?.id };
          }
          return { existing_incident: existingIncident.id };
        })()
      ]);
      
      const fastPathDuration = Date.now() - fastPathStartTime;
      console.log(`✅ CRITICAL FAST-PATH COMPLETE in ${fastPathDuration}ms`);
      console.log('  AI Result:', aiResult.status === 'fulfilled' ? 'success' : aiResult.reason);
      console.log('  Webhook Result:', webhookResult.status === 'fulfilled' ? 'success' : webhookResult.reason);
      console.log('  Alert Result:', alertResult.status === 'fulfilled' ? 'success' : alertResult.reason);
      
      // Update signal with fast-path metadata
      await supabase
        .from('signals')
        .update({
          status: 'critical_processed',
          raw_json: {
            ...signalRaw,
            fast_path_activated: true,
            fast_path_duration_ms: fastPathDuration,
            fast_path_timestamp: new Date().toISOString()
          }
        })
        .eq('id', signal.id);
      
      // Return immediately with fast-path confirmation
      return new Response(
        JSON.stringify({ 
          signal_id: signal.id,
          status: 'critical_processed',
          fast_path: true,
          processing_time_ms: fastPathDuration,
          message: `Critical signal processed via fast-path in ${fastPathDuration}ms`,
          results: {
            ai_decision: aiResult.status,
            webhook_dispatch: webhookResult.status,
            alert_creation: alertResult.status
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // ===== STANDARD PATH (Non-Critical Signals) =====
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

    // ===== WEBHOOK TRIGGERS =====
    // Trigger webhooks for critical/high severity signals or client matches
    try {
      const shouldTriggerWebhook = 
        (classification.severity === 'critical' || classification.severity === 'high') ||
        (clientId && matchConfidence !== 'none');
      
      if (shouldTriggerWebhook) {
        const eventType = (classification.severity === 'critical' || classification.severity === 'high')
          ? 'signal.critical_high'
          : 'signal.client_match';
        
        console.log(`Triggering webhook for event: ${eventType}`);
        
        // Build signal payload for webhook
        const webhookSignal = {
          id: signal.id,
          normalized_text: signal.normalized_text,
          source: signal.source_id,
          category: classification.category,
          severity: classification.severity,
          status: signal.status,
          client_id: clientId,
          match_confidence: matchConfidence === 'high' ? 0.9 : 
                           matchConfidence === 'medium' ? 0.7 : 
                           matchConfidence === 'low' ? 0.5 :
                           matchConfidence === 'ai' ? 0.6 :
                           matchConfidence === 'explicit' ? 1.0 : 0,
          detected_at: signal.detected_at || new Date().toISOString(),
        };
        
        // Dispatch webhook asynchronously
        supabase.functions.invoke('webhook-dispatcher', {
          body: {
            event_type: eventType,
            signal: webhookSignal,
          }
        }).then(({ data, error }) => {
          if (error) {
            console.error('Webhook dispatch error:', error);
          } else {
            console.log('Webhook dispatch result:', data);
          }
        }).catch(err => {
          console.error('Webhook dispatch failed:', err);
        });
      }
    } catch (webhookError) {
      console.error('Error triggering webhooks:', webhookError);
      // Don't fail the main request if webhook triggering fails
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
