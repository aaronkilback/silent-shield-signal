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
  source_url: z.string().url().optional(),  // Canonical URL of the source article
  image_url: z.string().url().optional(),   // Open Graph / thumbnail image
  location: z.string().max(500).optional(),
  raw_json: z.any().optional(),
  is_test: z.boolean().optional(),
  client_id: z.string().uuid().optional(), // snake_case client ID
  clientId: z.string().uuid().optional(),  // camelCase alias (used by QA agent and frontend)
  sourceType: z.string().optional(),       // source type tag (e.g. 'qa_test')
  sourceData: z.any().optional(),          // source metadata
  skip_relevance_gate: z.boolean().optional(), // bypass AI gate when upstream keyword matching already vetted the signal
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

    const { source_key, event, text, url, source_url, image_url, location, raw_json, is_test: is_test_input, client_id, clientId: clientIdCamel, skip_relevance_gate } = validationResult.data;
    // Auto-flag any signal whose source URL points at example.com / qa.test / localhost
    // as is_test=true, regardless of caller. These domains are always test fixtures and
    // must never appear in the production live feed (operators have mistaken them for
    // real intel before — see 2026-04-30 pipeline audit).
    const effectiveSourceUrl = (source_url || url || '') as string;
    const isTestSourceUrl = /^https?:\/\/(?:[\w.-]+\.)?(?:example\.com|qa\.test|localhost)\b/i.test(effectiveSourceUrl);
    const is_test = is_test_input || isTestSourceUrl;
    const explicitClientId = client_id || clientIdCamel || null;
    
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
    // Ensure source_url is always accessible inside raw_json (UI reads from both places)
    if (source_url && !signalRaw.source_url) signalRaw = { ...signalRaw, source_url };
    
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
          model: 'gpt-4o-mini',
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

    // Fetch analyst feedback for severity calibration (few-shot injection)
    // Reads from feedback_events joined to signals — the live feedback path
    let fewShotBlock = '';
    try {
      const { data: feedbackEvents } = await supabase
        .from('feedback_events')
        .select('feedback, notes, correction, object_id')
        .eq('object_type', 'signal')
        .in('feedback', ['irrelevant', 'wrong_severity', 'confirmed'])
        .not('notes', 'is', null)
        .order('created_at', { ascending: false })
        .limit(8);

      if (feedbackEvents && feedbackEvents.length > 0) {
        // Fetch the signal titles for context
        const signalIds = feedbackEvents.map((e: any) => e.object_id).filter(Boolean);
        const { data: signalTitles } = signalIds.length > 0
          ? await supabase.from('signals').select('id, title, severity, category').in('id', signalIds)
          : { data: [] };
        const titleMap = Object.fromEntries((signalTitles || []).map((s: any) => [s.id, s]));

        const examples = feedbackEvents
          .map((ex: any) => {
            const sig = titleMap[ex.object_id];
            if (!sig) return null;
            if (ex.feedback === 'irrelevant') return `- IRRELEVANT [${sig.category}]: "${sig.title?.substring(0, 80)}"${ex.notes ? ` — ${ex.notes}` : ''}`;
            if (ex.feedback === 'wrong_severity') return `- SEVERITY CORRECTION [${sig.severity} → ${ex.correction || '?'}]: "${sig.title?.substring(0, 80)}"${ex.notes ? ` — ${ex.notes}` : ''}`;
            if (ex.feedback === 'confirmed') return `- CONFIRMED RELEVANT [${sig.category}]: "${sig.title?.substring(0, 80)}"`;
            return null;
          })
          .filter(Boolean);

        if (examples.length > 0) {
          fewShotBlock = '\n\nANALYST CALIBRATION EXAMPLES (learn from these real corrections):\n' + examples.join('\n');
        }
      }
    } catch { /* non-blocking */ }

    const classResult = await callAiGatewayJson({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a PECL (Physical, Environmental, Cyber, Legal) security intelligence classifier for a corporate protective intelligence platform.

Extract the following fields as JSON:
- normalized_text: clean, factual one-paragraph summary of the event
- entity_tags: array of named entities (people, orgs, locations, IPs, domains, project names)
- location: specific geographic location if mentioned
- category: one of — active_threat, protest, sabotage, physical_threat, trespass, surveillance, wildfire, hazmat, flood, natural_disaster, malware, phishing, intrusion, data_exfil, ddos, ransomware, regulatory, litigation, compliance, injunction, activism, social_sentiment, crime, document_upload, insider_threat, other
- severity: critical | high | medium | low (see rules below)
- confidence: 0-100
- event_date: ISO 8601 date (YYYY-MM-DD) of WHEN THE EVENT OCCURRED — extract from text clues, not crawl date
- is_historical: true if event occurred >90 days ago

SEVERITY RULES:
- critical: Immediate threat to life/safety, active sabotage in progress, ongoing breach, credible imminent attack
- high: Planned direct action within 7 days, serious legal order affecting operations, active malware campaign targeting sector
- medium: Activist monitoring, routine regulatory filing, general cyber indicator, planned protest >7 days out
- low: Historical event >90 days ago, informational/background, geopolitical context with no direct client nexus

CATEGORY GUIDANCE:
- active_threat: Use for ongoing or imminent threats requiring immediate attention (violence, active sabotage, credible attack)
- insider_threat: ONLY for individuals with a direct employment, contractor, or privileged access relationship to the client organization. Public activists, protesters, Indigenous land defenders, journalists, and named individuals WITHOUT a direct employment or access relationship to the client are NEVER insider threats — classify them as active_threat, protest, activism, or social_sentiment instead.
- social_sentiment: Use for aftermath/recovery coverage, public reactions, and ongoing media attention to a past event (e.g. shooting victim updates weeks after the incident)
- protest / activism: Use for Indigenous land defense actions, pipeline opposition, environmental campaigns, direct action by external parties

TEMPORAL RULES:
- Extract the ACTUAL event date, not publication date
- Historical signals (>90 days old) MUST be severity "low" unless actively resurging
- Past years (2019-2024) = is_historical true${fewShotBlock}

TITLE AND NORMALIZATION RULES:
- The normalized_text must be a faithful compression of what the source actually says — not an interpretation
- Never attribute a role or position to a named individual unless that role is explicitly stated in the source text
- If the source mentions a person in a different context (their new company, a past role, a passing reference), do not reframe them in any other role
- If the source is about Company A and merely mentions Person X who previously worked at Company B, the normalized_text is about Company A — not about Person X's role at Company B
- If uncertain whether a claim appears in the source, omit it from normalized_text entirely

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
      // Floor confidence for pre-vetted signals (skip_relevance_gate) — AI sometimes returns
      // near-zero decimal confidence for these, which is misleading. The gate bypass itself
      // means the upstream monitor already validated the signal.
      if (skip_relevance_gate && classification.confidence < 0.75) {
        classification.confidence = 0.80;
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

    // ═══ UNKNOWN-CATEGORY REJECTION ═══
    // The AI classifier has 25 categories including a generic "other". A `category=unknown`
    // result means the AI failed entirely or returned malformed JSON — we have no signal
    // about what this is. Default behaviour was to ingest as severity=medium/category=unknown,
    // which is the largest single source of feed noise. Reject instead. Skipped for
    // skip_relevance_gate (analyst uploads) and rules-matched signals (P1/P2 keywords already
    // give us the priority). qa_test signals are also passed through so QA can verify.
    const isQaTestForCategory = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test' || is_test === true;
    if (
      classification.category === 'unknown' &&
      !rulesResult.severity &&
      !skip_relevance_gate &&
      !isQaTestForCategory
    ) {
      console.log(`[Category Filter] Rejecting uncategorizable signal: ${signalText.substring(0, 100)}...`);
      return new Response(
        JSON.stringify({
          status: 'rejected',
          reason: 'uncategorizable',
          message: 'AI classifier could not assign a category — signal lacks structure to be actionable intelligence'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
          const { data: matchResult, error: matchErr } = await callAiGatewayJson({
            model: 'gpt-4o-mini',
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
            extraBody: { max_completion_tokens: 150 },
            functionName: 'ingest-signal',
          });

          if (!matchErr && matchResult?.client_id) {
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

    // Calculate content hash BEFORE insertion for duplicate detection.
    // Hash on source_url when available — AI paraphrases snippet text each run, so
    // text-based hashes diverge even for the same article. URL is the stable identifier.
    const encoder = new TextEncoder();
    const contentToHash = source_url ? `url:${source_url}` : signalText;
    const data = encoder.encode(contentToHash);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const contentHash = hashArray.map((b: number) => b.toString(16).padStart(2, '0')).join('');

    console.log(`Calculated content hash: ${contentHash.substring(0, 16)}... (basis: ${source_url ? 'source_url' : 'text'})`);
    
    // Check if this content was previously rejected/deleted by user
    // Skip for qa_test signals so repeated QA runs always reach the relevance gate
    const isQaTestEarly = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test';
    const { data: rejectedHash } = isQaTestEarly ? { data: null } : await supabase
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
    
    // For qa_test sources, skip near-dedup so the signal always reaches the relevance gate.
    // This allows QA tests to reliably verify both ingest and filter behaviour.
    const isQaTest = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test' || rawBody?.is_test === true || is_test === true;

    // CVE dedup: if the signal text contains a CVE ID, check if we already have a signal
    // for that CVE today. This prevents the same advisory being filed every 15 minutes.
    if (!isQaTest) {
      const cveMatch = signalText.match(/CVE-\d{4}-\d+/gi);
      const cveIds = cveMatch ? [...new Set(cveMatch.map((c: string) => c.toUpperCase()))] : [];
      if (cveIds.length > 0) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { data: existingCve } = await supabase
          .from('signals')
          .select('id, title')
          .gte('created_at', todayStart.toISOString())
          .or(cveIds.map((cve: string) => `title.ilike.%${cve}%,normalized_text.ilike.%${cve}%`).join(','))
          .limit(1);
        if (existingCve && existingCve.length > 0) {
          console.log(`[CVE-dedup] Duplicate CVE advisory blocked: ${cveIds.join(', ')} already filed as signal ${existingCve[0].id}`);
          return new Response(
            JSON.stringify({
              filtered: true,
              reason: 'duplicate_cve',
              cve_ids: cveIds,
              existing_signal_id: existingCve[0].id,
              message: `CVE advisory already ingested today: ${cveIds.join(', ')}`,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // Fast URL-based dedup: if we've already ingested this URL in the last 30 days, skip.
    // This catches repeated monitor runs returning the same article with different snippet text.
    if (source_url && !isQaTest) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: existingByUrl } = await supabase
        .from('signals')
        .select('id')
        .eq('source_url', source_url)
        .gte('created_at', thirtyDaysAgo)
        .limit(1)
        .maybeSingle();
      if (existingByUrl) {
        console.log(`[URL-dedup] Duplicate source URL blocked: ${source_url}`);
        return new Response(JSON.stringify({
          status: 'suppressed',
          reason: 'duplicate_url',
          existing_signal_id: existingByUrl.id
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Title-based dedup: if the exact same title was ingested in the last 24h, skip.
    // Catches social monitors finding the same tweet/post across repeated runs when
    // the source_url varies (search result URL vs permalink).
    if (!isQaTest && signalText) {
      const titleLine = signalText.split('\n')[0].trim().substring(0, 200);
      if (titleLine.length > 20) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: existingByTitle } = await supabase
          .from('signals')
          .select('id')
          .ilike('title', `%${titleLine.substring(0, 80)}%`)
          .gte('created_at', oneDayAgo)
          .limit(1)
          .maybeSingle();
        if (existingByTitle) {
          console.log(`[Title-dedup] Duplicate title blocked: "${titleLine.substring(0, 60)}..."`);
          return new Response(JSON.stringify({
            status: 'suppressed',
            reason: 'duplicate_title',
            existing_signal_id: existingByTitle.id
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    }

    // Check for duplicates BEFORE insertion
    // - Use normalized_text for near-duplicate detection (more stable than raw text)
    // - Scope to the matched client
    // - Enforce near-duplicate blocking at 80% over the last 30 days
    const dupCheck = isQaTest ? null : await supabase.functions.invoke('detect-duplicates', {
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
      console.log(`NEAR duplicate detected (>=80%) - returning existing signal`);
      // Return 200 with the existing signal_id so callers (e.g. QA agent) can confirm
      // the signal exists in the system rather than treating dedup as an error.
      return new Response(
        JSON.stringify({
          signal_id: top?.id,
          deduplicated: true,
          duplicate_of: top?.id,
          similarity_score: top?.similarity_score,
          lookback_days: dupCheck.data.lookback_days_used ?? 30,
          threshold: dupCheck.data.near_duplicate_threshold_used ?? 0.8,
          message: `Near-duplicate detected (similarity ${(top?.similarity_score ?? 0).toFixed(2)}). Returning existing signal.`,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
            model: 'gpt-4o-mini',
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

    // Generate a descriptive incident title from signal metadata
    const generateIncidentTitle = (sig: any, cls: any): string => {
      const categoryMap: Record<string, string> = {
        malware: 'Malware Detection',
        phishing: 'Phishing Campaign',
        intrusion: 'Network Intrusion',
        data_exfil: 'Data Exfiltration',
        ddos: 'DDoS Attack',
        ransomware: 'Ransomware Activity',
        social_engineering: 'Social Engineering',
        insider_threat: 'Insider Threat',
        physical: 'Physical Security Threat',
        fraud: 'Fraud Activity',
        extremism: 'Extremist Activity',
        protest: 'Protest Activity',
        cyber: 'Cyber Threat',
        sabotage: 'Sabotage Threat',
        espionage: 'Espionage Activity',
      };
      const cat = cls.category || sig.category || '';
      const catLabel = categoryMap[cat] ||
        (cat ? cat.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Security Incident');
      const sev = (cls.severity || sig.severity || '').toLowerCase();
      const loc = cls.location || sig.location || '';
      const entities: string[] = cls.entity_tags || sig.entity_tags || [];
      const sevPrefix = sev === 'critical' ? 'Critical ' : sev === 'high' ? 'High-Severity ' : '';

      // Prefer named entities as target descriptor, fall back to location
      const meaningful = entities.filter((e: string) => e.length > 2 && !/^\d+$/.test(e));
      const target = meaningful.length > 0 ? meaningful.slice(0, 2).join(', ') : loc;

      if (target) {
        return `${sevPrefix}${catLabel} — ${target}`.substring(0, 100);
      }

      // Fall back to first clean sentence of signal title
      const raw = sig.title || sig.normalized_text || '';
      const clean = raw.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
      const short = clean.split(/[.!?]/)[0].trim().substring(0, 60);
      if (short.length > 10) {
        return `${sevPrefix}${catLabel}: ${short}`.substring(0, 100);
      }

      return `${sevPrefix}${catLabel} Detected`.substring(0, 100);
    };

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
    
    // ===== AI RELEVANCE GATE: PECL-calibrated two-stage check =====
    // Stage 1: LLM scores relevance (0-1) + classifies connection type
    // Stage 2: Threshold check at 0.55 — below = write to filtered_signals and reject
    // Threshold history: 0.60 → 0.45 (admitted too much junk) → 0.65 (rejected legit
    // signals like Coastal GasLink blockade + Petronas Canada at score 0.60) → 0.55.
    // Empirically gpt-4o-mini scores direct-asset references at 0.55–0.70 and pure
    // noise at 0.45–0.55, so 0.55 is the cleanest separator. Bounds 0.50–0.70.
    if (skip_relevance_gate) {
      console.log(`[AI Relevance Gate] BYPASSED — upstream keyword matching already vetted this signal`);
    }
    if (clientId && !skip_relevance_gate) {
      try {
        const { data: clientForGate } = await supabase
          .from('clients')
          .select('name, industry, locations, high_value_assets')
          .eq('id', clientId)
          .single();

        // Fetch analyst learning profiles to bias the gate
        let approvedPatternBlock = '';
        let rejectedPatternBlock = '';
        let learnedThresholdAdjustment = 0;
        try {
          const { data: profiles } = await supabase
            .from('learning_profiles')
            .select('profile_type, features')
            .in('profile_type', ['approved_signal_patterns', 'rejected_signal_patterns'])
            .limit(2);

          if (profiles && profiles.length > 0) {
            const textLower = (classification.normalized_text || signalText).toLowerCase();

            for (const profile of profiles) {
              const features: Record<string, number> = profile.features || {};
              // Top keywords sorted by frequency
              const topKeywords = Object.entries(features)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 12)
                .map(([k]) => k)
                .filter(k => !k.startsWith('reason:'));

              // Check how many top keywords this signal matches
              const matchCount = topKeywords.filter(k => textLower.includes(k)).length;

              if (profile.profile_type === 'approved_signal_patterns') {
                if (topKeywords.length > 0) {
                  approvedPatternBlock = `\nPATTERNS ANALYSTS HAVE APPROVED: ${topKeywords.slice(0, 8).join(', ')}`;
                }
                // Lower threshold if signal matches approved patterns
                if (matchCount >= 2) learnedThresholdAdjustment -= 0.05;
              } else if (profile.profile_type === 'rejected_signal_patterns') {
                if (topKeywords.length > 0) {
                  rejectedPatternBlock = `\nPATTERNS ANALYSTS HAVE REJECTED: ${topKeywords.slice(0, 8).join(', ')}`;
                }
                // Raise threshold if signal matches rejected patterns
                if (matchCount >= 3) learnedThresholdAdjustment += 0.05;
              }
            }
          }
        } catch { /* non-blocking */ }

        if (clientForGate) {
          const gateResult = await callAiGatewayJson({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You are a PECL (Physical, Environmental, Cyber, Legal) signal relevance scorer for a corporate protective intelligence platform.

Score how actionable this signal is for the specific client on a 0.0–1.0 scale, and classify the primary connection type.

SCORE GUIDE:
0.8–1.0  Direct naming, active threat/legal action against this client or their assets
0.6–0.79 Strong indirect: same project, same threat actor, adjacent geography with credible spillover
0.45–0.59 Moderate: sector-wide risk, regulatory trend, protest tactics relevant to client's industry ← INGESTION FLOOR
0.2–0.44 Weak: tangential keyword match, distant geography, corporate PR, historical >6 months
0.0–0.19 No connection: wrong industry, wrong region, entertainment/sports, generic content

CONNECTION TYPES (pick one):
- direct_naming: client or asset explicitly named
- threat_actor: known threat group also targeting client's sector
- regulatory: regulation/legal ruling affecting client's industry
- geographic: incident in client's operational area
- tactical: activist/attack tactic relevant to client's threat model
- none: no meaningful connection

CATEGORICAL EXCLUSIONS — return score 0.0 regardless of location:
- Any signal about sports leagues, teams, tryouts, tournaments, or recreational activities
- Any signal about school events, graduations, concerts, festivals, or community social events
- Any signal about retail sales, restaurant openings, or local business news unrelated to energy
- Client's own positive PR, sponsorships, or community goodwill posts
- Software product announcements (non-security)
- Generic "about us" pages, merchandise listings, or job postings
Geographic location in BC or Alberta does NOT override these exclusions. If a signal matches any categorical exclusion, you MUST set score to 0.0 and primary_connection to "none".

Only score > 0.2 if there is a direct or indirect SECURITY or OPERATIONAL RISK connection beyond mere geographic proximity.
${approvedPatternBlock}${rejectedPatternBlock}

Respond with JSON: {"score": 0.0-1.0, "relevant": true/false, "primary_connection": "...", "reason": "one sentence"}`
              },
              {
                role: 'user',
                content: `CLIENT: ${clientForGate.name}
INDUSTRY: ${clientForGate.industry || 'unknown'}
LOCATIONS: ${(clientForGate.locations || []).join(', ')}
KEY ASSETS: ${(clientForGate.high_value_assets || []).join(', ')}

SIGNAL:
${(classification.normalized_text || signalText).substring(0, 1500)}

Score this signal's relevance and classify the connection.`
              }
            ],
            functionName: 'ingest-signal-relevance-gate',
            extraBody: { max_completion_tokens: 120 },
          });

          const gateScore: number = gateResult.data?.score ?? (gateResult.data?.relevant === false ? 0.1 : 0.7);
          const gateReason: string = gateResult.data?.reason || '';
          const primaryConnection: string = gateResult.data?.primary_connection || 'none';

          // Phase 3C: Per-source threshold adjustment
          // Low-credibility sources face a higher bar; proven sources get more slack.
          // Bounded ±0.15 from base (floor 0.50, ceiling 0.70) to prevent runaway suppression.
          // Also applies learned threshold adjustment from analyst feedback patterns.
          let relevanceThreshold = Math.min(0.70, Math.max(0.50, 0.55 + learnedThresholdAdjustment));
          if (learnedThresholdAdjustment !== 0) {
            console.log(`[Learning] Threshold adjusted by analyst patterns: ${learnedThresholdAdjustment > 0 ? '+' : ''}${learnedThresholdAdjustment.toFixed(2)} → ${relevanceThreshold.toFixed(2)}`);
          }
          if (source_key) {
            const { data: credScore } = await supabase
              .from('source_credibility_scores')
              .select('current_credibility, total_signals')
              .eq('source_key', source_key)
              .maybeSingle();
            // Only adjust if we have enough signal history (thin data protection)
            if (credScore?.current_credibility && (credScore.total_signals ?? 0) >= 5) {
              const adjustment = (0.65 - credScore.current_credibility) * 0.40;
              relevanceThreshold = Math.min(0.70, Math.max(0.50, 0.55 + adjustment));
              if (Math.abs(relevanceThreshold - 0.55) > 0.005) {
                console.log(`[Phase3C] ${source_key} threshold adjusted: ${relevanceThreshold.toFixed(2)} (credibility: ${credScore.current_credibility.toFixed(3)}, signals: ${credScore.total_signals})`);
              }
            }
          }

          if (gateScore < relevanceThreshold) {
            console.log(`[AI Relevance Gate] REJECTED (score ${gateScore.toFixed(2)}): ${gateReason}`);

            // Audit trail — write to filtered_signals
            supabase.from('filtered_signals').insert({
              raw_text: (classification.normalized_text || signalText).substring(0, 2000),
              source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
              source_name: source_key || signalRaw?.source_name || null,
              client_id: clientId,
              filter_reason: 'ai_relevance_gate',
              relevance_score: gateScore,
              relevance_reason: gateReason,
              primary_connection: primaryConnection,
            }).then(() => {}).catch(() => {});

            // Store hash so this content doesn't re-enter
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
                relevance_score: gateScore,
                primary_connection: primaryConnection,
                detail: gateReason,
                message: 'Signal rejected by AI relevance gate — not actionable intelligence for this client'
              }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            console.log(`[AI Relevance Gate] ACCEPTED (score ${gateScore.toFixed(2)}, connection: ${primaryConnection}): ${gateReason}`);
          }
        }
      } catch (gateError) {
        // Fail closed — if the gate fails, reject rather than admit unreviewed noise.
        // Previous behaviour was non-blocking (let the signal through), but in practice
        // gate timeouts/errors meant junk signals slipped past during AI gateway hiccups.
        // qa_test signals still pass through so smoke tests remain reliable.
        console.error('[AI Relevance Gate] Error (failing closed):', gateError);
        const isQaTestForGate = validationResult.data.sourceType === 'qa_test' || rawBody?.sourceType === 'qa_test' || is_test === true;
        if (!isQaTestForGate) {
          return new Response(
            JSON.stringify({
              status: 'rejected',
              reason: 'ai_relevance_gate_error',
              message: 'Signal rejected because the AI relevance gate could not be evaluated'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
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
      severityNum,
      source_key || null  // Pass source key so Phase 2 (source reliability) activates
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
    const signalStatus = 'new'; // low_confidence is not a valid signal_status enum value
    
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

    // ── STALENESS GATE ────────────────────────────────────────────────────────
    // Articles older than 365 days (730 for cyber/CVE) are ingested as
    // signal_type = 'historical', routed to the Historical tab, and skipped
    // for incident creation. skip_relevance_gate bypasses (analyst uploads).
    let isHistorical = triageOverride === 'historical'; // already set for >90 days
    if (eventDate && !skip_relevance_gate) {
      const eventParsed = new Date(eventDate);
      const cyberCategories = ['malware', 'phishing', 'intrusion', 'data_exfil', 'ddos', 'ransomware'];
      const isCyber = cyberCategories.includes(classification.category || '');
      const cutoffDays = isCyber ? 730 : 365;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - cutoffDays);
      if (eventParsed < cutoff) {
        const daysOld = Math.floor((Date.now() - eventParsed.getTime()) / 86400000);
        isHistorical = true;
        console.log(`[Staleness] Routing to historical — event_date ${classResult.data?.event_date} is ${daysOld} days old (limit: ${cutoffDays})`);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Compute severity_score (0-100) from text severity + relevance adjustment
    const severityScore = (() => {
      const base = classification.severity === 'critical' ? 90
                 : classification.severity === 'high'     ? 70
                 : classification.severity === 'medium'   ? 40
                 : 20; // low
      const adjustment = Math.round((relevanceResult.score - 0.5) * 20);
      return Math.max(0, Math.min(100, base + adjustment));
    })();

    // Compute quality_score (0-1) from metadata completeness
    const qualityScore = (() => {
      let q = 0;
      if (signalRaw?.url || signalRaw?.source_url || signalRaw?.link) q += 0.25;
      if ((classification.entity_tags?.length ?? 0) > 0) q += 0.25;
      if (classification.location) q += 0.25;
      if (classification.category) q += 0.125;
      if ((classification.normalized_text?.length ?? 0) > 50) q += 0.125;
      return q;
    })();

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
        severity_score: severityScore,
        quality_score: qualityScore,
        confidence: classification.confidence,
        relevance_score: relevanceResult.score,
        status: signalStatus,
        is_test: is_test || false,
        content_hash: contentHash,
        event_date: eventDate,
        triage_override: triageOverride,
        signal_type: isHistorical ? 'historical' : null,
        source_url: source_url || signalRaw?.source_url || signalRaw?.url || signalRaw?.link || null,
        image_url: image_url || signalRaw?.image_url || signalRaw?.og_image || signalRaw?.thumbnail || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw new Error(`Signal insert failed: ${insertError.message} (code: ${insertError.code}, details: ${insertError.details})`);
    }

    console.log(`Signal ingested: ${signal.id}${matchedKeywords.length > 0 ? ` (keywords: ${matchedKeywords.join(', ')})` : ''}`);

    // Fire-and-forget: generate and store content_embedding for pgvector semantic dedup.
    // Embeddings accumulate over time — detect-duplicates will use find_similar_signals_by_embedding
    // once enough signals have embeddings, giving better cross-outlet dedup than GPT-60-candidates.
    const openaiKeyForEmbed = Deno.env.get('OPENAI_API_KEY');
    if (openaiKeyForEmbed && signal?.id) {
      const embedText = (classification.normalized_text || signalText).substring(0, 8000);
      fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKeyForEmbed}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: embedText }),
      }).then((r: Response) => r.json()).then((embedData: any) => {
        const embedding = embedData.data?.[0]?.embedding;
        if (embedding) {
          supabase.from('signals')
            .update({ content_embedding: JSON.stringify(embedding) })
            .eq('id', signal.id)
            .then(() => {}, () => {});
        }
      }).catch(() => {});
    }

    // Non-blocking — anomaly scoring runs after insert
    supabase.functions.invoke('score-signal-anomaly', {
      body: {
        signal_id: signal.id,
        category: signal.category,
        severity: signal.severity,
        client_id: clientId,
        location: signal.location,
        normalized_text: signal.normalized_text,
        created_at: signal.created_at,
      }
    }).catch(err => console.error('[ingest-signal] anomaly scoring:', err));

    // Fire-and-forget speculative agent dispatch for high/critical signals
    if (classification.severity === 'critical' || classification.severity === 'high') {
      supabase.functions.invoke('speculative-dispatch', {
        body: {
          signal_id: signal.id,
          signal_text: signal.normalized_text,
          category: classification.category,
          severity: classification.severity,
          client_id: clientId,
          trigger_reason: 'auto_ingest',
        }
      }).catch(err => console.error('[ingest-signal] speculative-dispatch fire-and-forget failed:', err));
    }

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
                title: generateIncidentTitle(signal, classification),
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

      // Phase 4B: entity correlation on fast-path critical signals
      supabase.functions.invoke('correlate-entities', {
        body: { text: signal.normalized_text || signalText, sourceType: 'signal', sourceId: signal.id, autoApprove: false }
      }).catch((err: Error) => console.error('[Phase4B] Fast-path entity correlation failed:', err));
      
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
    // Do not auto-create operational incidents from cyber advisory signals.
    // These are intelligence signals, not PECL operational incidents.
    const cyberAdvisoryCategories = ['cyber', 'malware', 'data_exfil', 'intrusion', 'phishing', 'ddos', 'ransomware'];
    const cyberAdvisorySources = ['cisa', 'cccs', 'threat_intel'];
    const isCyberAdvisory =
      cyberAdvisoryCategories.includes(signal.category) ||
      cyberAdvisorySources.includes(signal.raw_json?.sourceType) ||
      cyberAdvisorySources.includes(signal.raw_json?.source_name?.toLowerCase());

    // Historical signals skip the AI decision engine entirely — no incident creation, no escalation
    if (isHistorical) {
      console.log(`[Staleness] Skipping AI decision engine for historical signal ${signal.id}`);
      return new Response(
        JSON.stringify({ success: true, signal_id: signal.id, signal_type: 'historical', message: 'Signal stored as historical intel — no incident created.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

        // AI-based incident creation is DISABLED — incidents must be created manually by analysts.
        // Auto-created incidents from wildfire/regulatory/social signals are noise, not actionable.
        // Only rules-based P1 keyword matches (active shooter, bomb, weapon, kidnap) create incidents.
        if (false && !isCyberAdvisory && !isQaTest && !isHistorical && aiDecisionResult.data?.decision?.should_create_incident) {
          const { error: incidentError } = await supabase
            .from('incidents')
            .insert({
              signal_id: signal.id,
              client_id: signal.client_id,
              priority: aiDecisionResult.data.decision.incident_priority || rulesResult.priority,
              status: 'open',
              is_test: signal.is_test || false,
              title: generateIncidentTitle(signal, classification),
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
    
    // Auto-open incident based on rules — P1 ONLY (active shooter, bomb, weapon, kidnap, credible threat).
    // P2 rules ('suspicious', 'tamper', 'intrusion') are too broad and create false incidents.
    // Analysts must create incidents manually for all other signal types.
    if (rulesResult.shouldOpenIncident && rulesResult.matchedRule === 'p1' && !isCyberAdvisory && !isQaTest) {
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

    // Phase 4B: Trigger entity correlation (async, don't wait for it)
    // Matches signal text against the entity graph — name + aliases + trigram.
    // Creates entity_mentions linking this signal to matched entities.
    // autoApprove: false means matches go to suggestions queue for analyst review.
    try {
      supabase.functions.invoke('correlate-entities', {
        body: {
          text: signal.normalized_text || signalText,
          sourceType: 'signal',
          sourceId: signal.id,
          autoApprove: false,
        }
      }).then(({ error }) => {
        if (error) console.error('[Phase4B] Entity correlation error:', error);
        else console.log('[Phase4B] Entity correlation triggered for signal:', signal.id);
      }).catch((err: Error) => console.error('[Phase4B] Entity correlation failed:', err));
    } catch (error) {
      // Non-blocking — entity tagging failure never stops signal ingestion
      console.error('[Phase4B] Failed to trigger entity correlation:', error);
    }

    // WRAITH: Signal threat DNA analysis (async, non-blocking)
    // Detects AI-generated attacks, synthetic intel, and adversarial payloads.
    // Blocked signals are soft-deleted. Suspicious signals are flagged in raw_json.
    try {
      supabase.functions.invoke('wraith-security-advisor', {
        body: {
          action: 'analyze_signal_threat_dna',
          signal_id: signal.id,
          signal_text: signal.normalized_text || signalText,
          signal_source_url: signal.source_url || undefined,
        }
      }).then(({ error }) => {
        if (error) console.error('[WRAITH] Threat DNA analysis error:', error);
        else console.log('[WRAITH] Threat DNA analysis triggered for signal:', signal.id);
      }).catch((err: Error) => console.error('[WRAITH] Threat DNA failed:', err));
    } catch (error) {
      // Non-blocking — WRAITH failure never stops signal ingestion
      console.error('[WRAITH] Failed to trigger threat DNA analysis:', error);
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
