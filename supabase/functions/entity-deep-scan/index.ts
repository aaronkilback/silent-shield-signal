import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay helper for rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry logic
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt}/${maxRetries}`);
        await delay(waitTime);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`);
      if (attempt < maxRetries) {
        await delay(1000 * attempt);
      }
    }
  }
  throw lastError || new Error('All retries failed');
}

interface DeepScanResult {
  category: string;
  type: string;
  label: string;
  value: string;
  source: string;
  confidence: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'info';
  commentary?: string;
  url?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Deadline: stop launching new phases after 110s so we always finish before Supabase's 150s limit
  const DEADLINE = Date.now() + 110_000;
  const budgetOk = () => Date.now() < DEADLINE;

  // Collect results outside try so the catch can return partial results
  const results: DeepScanResult[] = [];
  let entity: Record<string, any> | null = null;
  let entity_id = '';

  try {
    const body = await req.json();

    // Health check endpoint for pipeline tests
    if (body.health_check) {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          function: 'entity-deep-scan',
          timestamp: new Date().toISOString()
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    entity_id = body.entity_id;

    if (!entity_id) {
      throw new Error('entity_id is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch entity details
    const { data: entityData, error: entityError } = await supabase
      .from('entities')
      .select('*')
      .eq('id', entity_id)
      .single();

    if (entityError || !entityData) {
      const dbErr = entityError?.message || entityError?.code || 'no data returned';
      throw new Error(`Entity not found (id=${entity_id}, db_error=${dbErr})`);
    }
    entity = entityData;

    console.log(`Starting deep scan for entity: ${entity.name} (${entity.type})`);
    const GOOGLE_API_KEY = Deno.env.get('GOOGLE_SEARCH_API_KEY');
    const GOOGLE_CX = Deno.env.get('GOOGLE_SEARCH_ENGINE_ID');
    const HIBP_API_KEY = Deno.env.get('HIBP_API_KEY');
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

    // Get entity attributes for additional context
    const attributes = (entity.attributes as Record<string, unknown>) || {};
    const contactInfo = (attributes.contact_info as Record<string, unknown>) || {};
    const emails = (contactInfo.email as string[]) || [];
    const socialMedia = (contactInfo.social_media as Record<string, string>) || {};

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: DARK WEB & BREACH INTELLIGENCE
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Check for data breaches via HIBP (for person/email entities or entities with email)
    if (HIBP_API_KEY && (entity.type === 'email' || entity.type === 'person' || emails.length > 0)) {
      const emailsToCheck = entity.type === 'email' ? [entity.name] : emails;
      
      for (const email of emailsToCheck) {
        console.log(`Checking HIBP breaches for: ${email}`);
        try {
          // Breach check
          const breachResponse = await fetchWithRetry(
            `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
            {
              headers: {
                'hibp-api-key': HIBP_API_KEY,
                'User-Agent': 'Fortress-Security-Platform'
              }
            }
          );
          
          if (breachResponse.ok) {
            const breaches = await breachResponse.json();
            for (const breach of breaches) {
              const isRecent = new Date(breach.BreachDate) > new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
              results.push({
                category: 'breach',
                type: 'data_breach',
                label: `🔓 Data Breach: ${breach.Name}`,
                value: `${email} compromised in ${breach.Name} breach (${breach.BreachDate})`,
                source: 'Have I Been Pwned',
                confidence: 95,
                riskLevel: isRecent ? 'critical' : 'high',
                commentary: `Exposed data: ${breach.DataClasses?.join(', ')}. ${breach.Description?.slice(0, 200)}...`
              });
            }
          } else if (breachResponse.status === 404) {
            results.push({
              category: 'breach',
              type: 'no_breach',
              label: `✅ No Known Breaches: ${email}`,
              value: 'Email not found in known breach databases',
              source: 'Have I Been Pwned',
              confidence: 85,
              riskLevel: 'info',
              commentary: 'No breaches currently detected. Continue monitoring as new breaches are regularly discovered.'
            });
          }
          await delay(1000); // HIBP rate limit

          // Paste check
          const pasteResponse = await fetchWithRetry(
            `https://haveibeenpwned.com/api/v3/pasteaccount/${encodeURIComponent(email)}`,
            {
              headers: {
                'hibp-api-key': HIBP_API_KEY,
                'User-Agent': 'Fortress-Security-Platform'
              }
            }
          );

          if (pasteResponse.ok) {
            const pastes = await pasteResponse.json();
            if (pastes.length > 0) {
              results.push({
                category: 'breach',
                type: 'paste_exposure',
                label: `📋 Paste Site Exposure`,
                value: `${email} found in ${pastes.length} paste site(s)`,
                source: 'Have I Been Pwned',
                confidence: 90,
                riskLevel: 'high',
                commentary: `Found on ${pastes.map((p: { Source: string }) => p.Source).join(', ')}. Pastes often contain leaked credentials.`
              });
            }
          }
          await delay(500);
        } catch (e) {
          console.error(`HIBP check failed for ${email}:`, e);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: DARK WEB & UNDERGROUND MENTIONS (Perplexity Sonar)
    // ═══════════════════════════════════════════════════════════════════════════

    if (PERPLEXITY_API_KEY && budgetOk()) {
      try {
        console.log(`[DEEP-SCAN] Phase 2: Dark web & underground mentions for ${entity.name}`);
        const darkWebQuery = `Search for any mentions of "${entity.name}" on dark web monitoring sources, Pastebin, leak sites, doxing forums, or hacker forums. Has this entity been doxxed, had their data leaked, or been mentioned in underground channels? Search for: "${entity.name}" site:pastebin.com OR dox OR leaked credentials OR data breach OR dark web`;

        const darkWebResponse = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              { role: 'user', content: darkWebQuery }
            ],
            max_tokens: 800
          })
        });

        if (darkWebResponse.ok) {
          const darkWebData = await darkWebResponse.json();
          const darkWebContent: string = darkWebData.choices?.[0]?.message?.content || '';
          const darkWebLower = darkWebContent.toLowerCase();
          const NEGATIVE_INDICATORS = [
            'no recent', 'no specific', 'no information about', 'no information regarding',
            'do not contain', 'does not contain', 'no relevant', 'no evidence of',
            'no reports of', 'no mentions of', 'no data about', 'no significant',
            'could not find', 'unable to find', 'nothing found', 'no results',
            'there is no information', 'there are no reports', 'no news about',
            'no public discussions', 'no social media', 'not found any',
            'no threats', 'no incidents', 'no breaches',
            'i cannot identify', 'cannot identify any', 'i could not find', 'i did not find',
            'there are no specific', 'there is no specific', 'no direct',
            'not aware of any', 'i cannot find any information', 'i was unable to find',
            'no relevant information', 'no specific information',
            'there doesn\'t appear to be', 'there does not appear to be',
            'i found no evidence', 'no evidence of', 'no indication of', 'no mention of',
            'no actionable', 'no matching',
          ];
          const isNegative = NEGATIVE_INDICATORS.some(p => darkWebLower.includes(p));

          if (!isNegative && darkWebContent.length >= 100) {
            const hasCritical = /dox|doxxed|leaked credentials|data breach|dark web|pastebin|hacker forum|exposed/i.test(darkWebContent);
            const citations: string[] = darkWebData.citations || [];
            results.push({
              category: 'dark_web',
              type: hasCritical ? 'dark_web_mention' : 'exposure_mention',
              label: hasCritical ? 'Dark Web / Underground Mention Detected' : 'Potential Exposure Mention',
              value: darkWebContent.substring(0, 500),
              source: citations[0] || 'Perplexity Sonar (Dark Web Intelligence)',
              confidence: 70,
              riskLevel: hasCritical ? 'critical' : 'high',
              url: citations[0] || undefined,
              commentary: `Perplexity Sonar dark web scan. ${citations.length > 0 ? `Sources: ${citations.slice(0, 3).join(', ')}` : 'No direct source URLs available.'}`
            });
          } else {
            console.log(`[DEEP-SCAN] Phase 2: No dark web findings for ${entity.name}`);
          }
        }
      } catch (e) {
        console.error('[DEEP-SCAN] Phase 2 dark web error:', e);
      }
      await delay(500);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3: SOCIAL MEDIA & DIGITAL FOOTPRINT (Perplexity Sonar)
    // ═══════════════════════════════════════════════════════════════════════════

    if (PERPLEXITY_API_KEY && budgetOk()) {
      try {
        console.log(`[DEEP-SCAN] Phase 3: Social media footprint for ${entity.name}`);
        const socialQuery = `Find the social media presence and digital footprint of "${entity.name}". Search across Twitter/X, LinkedIn, Facebook, Instagram, YouTube, Reddit, and TikTok. What accounts exist, what are they posting about, and are there any concerning posts, threats, or reputational issues?`;

        const socialResponse = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              { role: 'user', content: socialQuery }
            ],
            max_tokens: 800
          })
        });

        if (socialResponse.ok) {
          const socialData = await socialResponse.json();
          const socialContent: string = socialData.choices?.[0]?.message?.content || '';
          const socialLower = socialContent.toLowerCase();
          const NEGATIVE_INDICATORS_2 = [
            'no recent', 'no specific', 'no information about', 'no information regarding',
            'do not contain', 'does not contain', 'no relevant', 'no evidence of',
            'no reports of', 'no mentions of', 'no data about', 'no significant',
            'could not find', 'unable to find', 'nothing found', 'no results',
            'there is no information', 'there are no reports',
            'no public discussions', 'no social media', 'not found any',
            'i cannot identify', 'cannot identify any', 'i could not find', 'i did not find',
            'not aware of any', 'i cannot find any information', 'i was unable to find',
            'no relevant information', 'no specific information',
            'there doesn\'t appear to be', 'there does not appear to be',
            'i found no evidence', 'no evidence of', 'no indication of', 'no mention of',
          ];
          const isNegative2 = NEGATIVE_INDICATORS_2.some(p => socialLower.includes(p));

          if (!isNegative2 && socialContent.length >= 100) {
            const hasConcern = /threat|concern|controversial|controversial|harassment|reputational|negative|scandal|misconduct/i.test(socialContent);
            const citations2: string[] = socialData.citations || [];
            results.push({
              category: 'digital_footprint',
              type: 'social_media',
              label: hasConcern ? 'Social Media: Concerning Content Detected' : 'Social Media Presence Found',
              value: socialContent.substring(0, 500),
              source: citations2[0] || 'Perplexity Sonar (Social Media Intelligence)',
              confidence: 72,
              riskLevel: hasConcern ? 'medium' : 'low',
              url: citations2[0] || undefined,
              commentary: `Perplexity Sonar social media scan across Twitter/X, LinkedIn, Facebook, Instagram, YouTube, Reddit, TikTok. ${citations2.length > 0 ? `Sources: ${citations2.slice(0, 3).join(', ')}` : 'No direct source URLs available.'}`
            });
          } else {
            console.log(`[DEEP-SCAN] Phase 3: No significant social media findings for ${entity.name}`);
          }
        }
      } catch (e) {
        console.error('[DEEP-SCAN] Phase 3 social media error:', e);
      }
      await delay(500);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 4: NEWS & MEDIA INTELLIGENCE (Perplexity Sonar)
    // ═══════════════════════════════════════════════════════════════════════════

    if (PERPLEXITY_API_KEY && budgetOk()) {
      try {
        console.log(`[DEEP-SCAN] Phase 4: News & media intelligence for ${entity.name}`);
        const newsQuery = `Search for recent news and media coverage of "${entity.name}". Include: mainstream news, local news, industry publications. Focus on: controversies, legal issues, arrests, investigations, sanctions, misconduct, lawsuits, and any negative coverage. Also note significant positive coverage.`;

        const newsResponse = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              { role: 'user', content: newsQuery }
            ],
            max_tokens: 800
          })
        });

        if (newsResponse.ok) {
          const newsData = await newsResponse.json();
          const newsContent: string = newsData.choices?.[0]?.message?.content || '';
          const newsLower = newsContent.toLowerCase();
          const NEGATIVE_INDICATORS_3 = [
            'no recent', 'no specific', 'no information about', 'no information regarding',
            'do not contain', 'does not contain', 'no relevant', 'no evidence of',
            'no reports of', 'no mentions of', 'no data about', 'no significant',
            'could not find', 'unable to find', 'nothing found', 'no results',
            'there is no information', 'there are no reports', 'no news about',
            'i cannot identify', 'cannot identify any', 'i could not find', 'i did not find',
            'not aware of any', 'i cannot find any information', 'i was unable to find',
            'no relevant information', 'no specific information',
            'there doesn\'t appear to be', 'there does not appear to be',
            'i found no evidence', 'no evidence of', 'no indication of', 'no mention of',
          ];
          const isNegative3 = NEGATIVE_INDICATORS_3.some(p => newsLower.includes(p));

          if (!isNegative3 && newsContent.length >= 100) {
            const isAdverse = /arrest|scandal|lawsuit|investigation|charged|controversy|misconduct|sanction|legal issue/i.test(newsContent);
            const citations3: string[] = newsData.citations || [];
            results.push({
              category: 'news',
              type: isAdverse ? 'adverse_media' : 'media_mention',
              label: isAdverse ? 'Adverse Media Coverage Detected' : 'News & Media Coverage Found',
              value: newsContent.substring(0, 500),
              source: citations3[0] || 'Perplexity Sonar (News Intelligence)',
              confidence: 72,
              riskLevel: isAdverse ? 'high' : 'low',
              url: citations3[0] || undefined,
              commentary: `Perplexity Sonar news scan across mainstream, local, and industry publications. ${citations3.length > 0 ? `Sources: ${citations3.slice(0, 3).join(', ')}` : 'No direct source URLs available.'}`
            });
          } else {
            console.log(`[DEEP-SCAN] Phase 4: No significant news findings for ${entity.name}`);
          }
        }
      } catch (e) {
        console.error('[DEEP-SCAN] Phase 4 news error:', e);
      }
      await delay(500);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5: RELATIONSHIP & NETWORK ANALYSIS (AI-Powered)
    // ═══════════════════════════════════════════════════════════════════════════
    
    if ((GEMINI_API_KEY || PERPLEXITY_API_KEY) && budgetOk()) {
      try {
        let analysisPrompt = `Analyze the entity "${entity.name}" (${entity.type}). `;
        if (entity.description) analysisPrompt += `Description: ${entity.description}. `;
        if (entity.aliases?.length) analysisPrompt += `Also known as: ${entity.aliases.join(', ')}. `;
        if (entity.current_location) analysisPrompt += `Location: ${entity.current_location}. `;
        
        analysisPrompt += `Identify and return in JSON format:
        1. Known associates, partners, or related entities
        2. Organizational affiliations
        3. Any known controversies or legal issues
        4. Threat indicators or security concerns
        5. Key relationships with other individuals or organizations
        
        Return as JSON array with objects containing: name, relationship_type, description, risk_level (critical/high/medium/low), confidence (0-100)`;

        const apiUrl = PERPLEXITY_API_KEY ? 'https://api.perplexity.ai/chat/completions' : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
        const apiKey = PERPLEXITY_API_KEY || GEMINI_API_KEY;
        const model = PERPLEXITY_API_KEY ? 'sonar' : 'gemini-2.5-flash';

        const aiResponse = await fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are a security intelligence analyst. Return only valid JSON.' },
              { role: 'user', content: analysisPrompt }
            ],
            max_tokens: 1000
          })
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          
          // Try to parse JSON from response
          const jsonMatch = content.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            try {
              const relationships = JSON.parse(jsonMatch[0]);
              for (const rel of relationships) {
                if (rel.name && rel.relationship_type) {
                  results.push({
                    category: 'relationship',
                    type: 'ai_discovered_relationship',
                    label: `🔗 ${rel.relationship_type}: ${rel.name}`,
                    value: rel.description || 'Relationship identified through AI analysis',
                    source: 'AI Intelligence Analysis',
                    confidence: rel.confidence || 65,
                    riskLevel: rel.risk_level || 'medium',
                    commentary: `AI-identified relationship. Confidence: ${rel.confidence || 65}%`
                  });

                  // Create relationship in database if target exists
                  const { data: targetEntity } = await supabase
                    .from('entities')
                    .select('id')
                    .ilike('name', `%${rel.name}%`)
                    .single();

                  if (targetEntity) {
                    await supabase
                      .from('entity_relationships')
                      .upsert({
                        entity_a_id: entity_id,
                        entity_b_id: targetEntity.id,
                        relationship_type: rel.relationship_type,
                        description: rel.description,
                        confidence_score: (rel.confidence || 65) / 100,
                        discovered_by: 'entity_deep_scan',
                        last_observed: new Date().toISOString()
                      }, {
                        onConflict: 'entity_a_id,entity_b_id,relationship_type'
                      });
                  }
                }
              }
            } catch (parseError) {
              console.error('Failed to parse AI relationships:', parseError);
            }
          }
        }
      } catch (e) {
        console.error('AI analysis error:', e);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5B: TECHNICAL OSINT (Shodan/Censys-style via Perplexity)
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (PERPLEXITY_API_KEY && budgetOk() && (entity.type === 'organization' || entity.type === 'infrastructure' || entity.type === 'domain')) {
      try {
        console.log(`[DEEP-SCAN] Running technical OSINT enrichment for ${entity.name}`);
        const techPrompt = `Perform a technical OSINT assessment for "${entity.name}". Research and report on:
1. Known domains, subdomains, and DNS records (MX, SPF, DMARC, TXT)
2. SSL/TLS certificate details and any certificate transparency findings
3. Known open ports or exposed services (IoT devices, admin panels, APIs)
4. Email infrastructure (mail servers, security configurations)
5. Known IP ranges and hosting providers
6. Any exposed cloud resources (S3 buckets, Azure blobs, GCS)
7. WHOIS and domain registration history

Return as JSON array with objects: { finding_type, title, description, risk_level (critical/high/medium/low/info), source, confidence (0-100) }`;

        const techResponse = await fetchWithRetry('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              { role: 'system', content: 'You are a technical OSINT analyst specializing in network infrastructure and digital attack surface analysis. Return only valid JSON.' },
              { role: 'user', content: techPrompt }
            ]
          })
        });

        if (techResponse.ok) {
          const techData = await techResponse.json();
          const techContent = techData.choices?.[0]?.message?.content || '';
          const techJsonMatch = techContent.match(/\[[\s\S]*\]/);
          if (techJsonMatch) {
            try {
              const techFindings = JSON.parse(techJsonMatch[0]);
              for (const finding of techFindings.slice(0, 10)) {
                results.push({
                  category: 'technical_osint',
                  type: finding.finding_type || 'infrastructure',
                  label: `🔧 ${finding.title?.slice(0, 60) || 'Technical Finding'}`,
                  value: finding.description || 'Technical infrastructure finding',
                  source: finding.source || 'Technical OSINT Analysis',
                  confidence: Math.min(finding.confidence || 65, 80), // Cap single-source at 80
                  riskLevel: finding.risk_level || 'medium',
                  commentary: `Technical OSINT finding. Single-source confidence capped at 80%.`
                });
              }
            } catch (parseErr) {
              console.error('[DEEP-SCAN] Failed to parse technical OSINT:', parseErr);
            }
          }
        }
        await delay(500);
      } catch (e) {
        console.error('[DEEP-SCAN] Technical OSINT error:', e);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5C: SANCTIONS & REGISTRY SCREENING
    // ═══════════════════════════════════════════════════════════════════════════
    
    if ((PERPLEXITY_API_KEY || GEMINI_API_KEY) && budgetOk()) {
      try {
        console.log(`[DEEP-SCAN] Running sanctions/registry screening for ${entity.name}`);
        const sanctionsPrompt = `Check "${entity.name}" (${entity.type}) against:
1. OFAC SDN (Specially Designated Nationals) sanctions list
2. EU consolidated sanctions list
3. UN Security Council sanctions
4. OpenCorporates corporate registry entries (formation, directors, filings)
5. SEC EDGAR filings (if applicable — 10-K, proxy statements, insider trading)
6. PEP (Politically Exposed Persons) databases
7. Interpol and law enforcement notices

Return as JSON array with objects: { check_type, entity_matched, list_name, match_confidence (0-100), description, risk_level (critical/high/medium/low/info), is_exact_match (boolean) }
If no matches found for a category, include an entry with risk_level "info" confirming clean status.`;

        const apiUrl = PERPLEXITY_API_KEY ? 'https://api.perplexity.ai/chat/completions' : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
        const apiKey = PERPLEXITY_API_KEY || GEMINI_API_KEY;
        const model = PERPLEXITY_API_KEY ? 'sonar' : 'gemini-2.5-flash';

        const sanctionsResponse = await fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'You are a compliance and sanctions screening analyst. Return only valid JSON.' },
              { role: 'user', content: sanctionsPrompt }
            ],
            max_tokens: 1000
          })
        });

        if (sanctionsResponse.ok) {
          const sanctionsData = await sanctionsResponse.json();
          const sanctionsContent = sanctionsData.choices?.[0]?.message?.content || '';
          const sanctionsJsonMatch = sanctionsContent.match(/\[[\s\S]*\]/);
          if (sanctionsJsonMatch) {
            try {
              const sanctionsFindings = JSON.parse(sanctionsJsonMatch[0]);
              for (const finding of sanctionsFindings) {
                const isMatch = finding.risk_level !== 'info' && finding.is_exact_match !== false;
                results.push({
                  category: 'sanctions_screening',
                  type: finding.check_type || 'sanctions_check',
                  label: `${isMatch ? '🚨' : '✅'} ${finding.list_name || finding.check_type}: ${isMatch ? 'MATCH' : 'Clear'}`,
                  value: finding.description || `${finding.list_name} screening result`,
                  source: finding.list_name || 'Sanctions Screening',
                  confidence: Math.min(finding.match_confidence || 70, 80),
                  riskLevel: isMatch ? (finding.risk_level || 'critical') : 'info',
                  commentary: isMatch 
                    ? `⚠️ Potential sanctions match on ${finding.list_name}. Manual verification required.`
                    : `No match found on ${finding.list_name}.`
                });
              }
            } catch (parseErr) {
              console.error('[DEEP-SCAN] Failed to parse sanctions results:', parseErr);
            }
          }
        }
        await delay(500);
      } catch (e) {
        console.error('[DEEP-SCAN] Sanctions screening error:', e);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 6: THREAT INTELLIGENCE FEEDS
    // ═══════════════════════════════════════════════════════════════════════════
    
    try {
      // Check CISA KEV for relevant vulnerabilities (for infrastructure/domain entities)
      if (entity.type === 'infrastructure' || entity.type === 'domain' || entity.type === 'ip_address') {
        const cisaResponse = await fetchWithRetry('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {});
        if (cisaResponse.ok) {
          const cisaData = await cisaResponse.json();
          const recentVulns = cisaData.vulnerabilities?.slice(0, 5) || [];
          
          for (const vuln of recentVulns) {
            results.push({
              category: 'threat_intel',
              type: 'cisa_kev',
              label: `🛡️ ${vuln.cveID}: ${vuln.vulnerabilityName?.slice(0, 40)}`,
              value: vuln.shortDescription || 'Known exploited vulnerability',
              source: 'CISA KEV',
              confidence: 95,
              riskLevel: 'high',
              commentary: `Due date: ${vuln.dueDate}. ${vuln.notes || ''}`
            });
          }
        }
      }
    } catch (e) {
      console.error('CISA KEV fetch error:', e);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 7: STORE RESULTS & UPDATE ENTITY
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Calculate overall risk assessment
    const criticalCount = results.filter(r => r.riskLevel === 'critical').length;
    const highCount = results.filter(r => r.riskLevel === 'high').length;
    
    let overallRisk = 'low';
    if (criticalCount > 0) overallRisk = 'critical';
    else if (highCount >= 3) overallRisk = 'high';
    else if (highCount >= 1) overallRisk = 'medium';

    // Calculate new threat score
    let threatScore = entity.threat_score || 0;
    threatScore += criticalCount * 2;
    threatScore += highCount * 1;
    threatScore = Math.min(10, threatScore);

    // Update entity with scan results
    const scanSummary = {
      last_deep_scan: new Date().toISOString(),
      scan_results_count: results.length,
      critical_findings: criticalCount,
      high_findings: highCount,
      categories_scanned: [...new Set(results.map(r => r.category))]
    };

    await supabase
      .from('entities')
      .update({
        threat_score: threatScore,
        risk_level: overallRisk,
        attributes: {
          ...attributes,
          deep_scan_summary: scanSummary
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', entity_id);

    // Store ALL findings in entity_content for reference
    // Findings without a real URL get a stable pseudo-URL so they persist
    let savedCount = 0;
    for (const result of results) {
      try {
        const stableUrl = result.url ||
          `deep-scan://${entity_id}/${result.category}/${encodeURIComponent((result.label || 'finding').slice(0, 80))}`;
        const { error: upsertError } = await supabase
          .from('entity_content')
          .upsert({
            entity_id,
            content_type: result.category,
            title: result.label,
            url: stableUrl,
            source: result.source,
            excerpt: result.value,
            content_text: result.commentary,
            relevance_score: result.confidence,
            metadata: {
              risk_level: result.riskLevel,
              scan_type: 'deep_scan',
              discovered_at: new Date().toISOString(),
              has_real_url: !!result.url,
            }
          }, {
            onConflict: 'entity_id,url'
          });
        if (upsertError) {
          console.error(`[DEEP-SCAN] Failed to save finding "${result.label}":`, upsertError.message);
        } else {
          savedCount++;
        }
      } catch (saveErr) {
        console.error(`[DEEP-SCAN] Exception saving finding:`, saveErr);
      }
    }
    console.log(`[DEEP-SCAN] Saved ${savedCount}/${results.length} findings to entity_content`);

    console.log(`Deep scan complete for ${entity.name}: ${results.length} findings, ${criticalCount} critical, ${highCount} high`);

    return new Response(
      JSON.stringify({
        success: true,
        entity_id,
        entity_name: entity.name,
        findings_count: results.length,
        critical_count: criticalCount,
        high_count: highCount,
        overall_risk: overallRisk,
        updated_threat_score: threatScore,
        findings: results,
        categories: [...new Set(results.map(r => r.category))]
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Entity deep scan error:', errMsg);

    // If we have no entity (entity not found / bad id), return a real error
    if (!entity) {
      return new Response(
        JSON.stringify({ success: false, error: errMsg }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Otherwise return partial results as 200 so the client can show what we found
    const criticalCount = results.filter(r => r.riskLevel === 'critical').length;
    const highCount = results.filter(r => r.riskLevel === 'high').length;
    let overallRisk = 'low';
    if (criticalCount > 0) overallRisk = 'critical';
    else if (highCount >= 3) overallRisk = 'high';
    else if (highCount >= 1) overallRisk = 'medium';

    return new Response(
      JSON.stringify({
        success: true,
        partial: true,
        error_detail: errMsg,
        entity_id,
        findings_count: results.length,
        critical_count: criticalCount,
        high_count: highCount,
        overall_risk: overallRisk,
        findings: results,
        categories: [...new Set(results.map(r => r.category))]
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
