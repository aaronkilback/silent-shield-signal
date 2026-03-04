import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Delay helper for rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry logic
async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
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
    
    const { entity_id } = body;
    
    if (!entity_id) {
      throw new Error('entity_id is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch entity details
    const { data: entity, error: entityError } = await supabase
      .from('entities')
      .select('*')
      .eq('id', entity_id)
      .single();

    if (entityError || !entity) {
      throw new Error('Entity not found');
    }

    console.log(`Starting deep scan for entity: ${entity.name} (${entity.type})`);

    const results: DeepScanResult[] = [];
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
          await delay(1500); // HIBP rate limit

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
          await delay(1500);
        } catch (e) {
          console.error(`HIBP check failed for ${email}:`, e);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: DARK WEB & UNDERGROUND MENTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (GOOGLE_API_KEY && GOOGLE_CX) {
      // Dark web related searches
      const darkWebQueries = [
        `"${entity.name}" site:pastebin.com OR site:doxbin.org OR site:reddit.com/r/leak`,
        `"${entity.name}" "dox" OR "doxxed" OR "exposed"`,
        `"${entity.name}" "breach" OR "hacked" OR "leaked"`
      ];

      for (const query of darkWebQueries) {
        try {
          const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
          searchUrl.searchParams.set('key', GOOGLE_API_KEY);
          searchUrl.searchParams.set('cx', GOOGLE_CX);
          searchUrl.searchParams.set('q', query);
          searchUrl.searchParams.set('num', '5');

          const response = await fetchWithRetry(searchUrl.toString(), {});
          if (response.ok) {
            const data = await response.json();
            for (const item of data.items || []) {
              const hostname = new URL(item.link).hostname.toLowerCase();
              const isDarkWeb = hostname.includes('pastebin') || hostname.includes('doxbin') || 
                               hostname.includes('reddit.com/r/leak');
              
              results.push({
                category: 'dark_web',
                type: isDarkWeb ? 'dark_web_mention' : 'exposure_mention',
                label: `${isDarkWeb ? '🚨' : '⚠️'} ${item.title?.slice(0, 60)}`,
                value: item.snippet || 'No description available',
                source: hostname,
                confidence: 70,
                riskLevel: isDarkWeb ? 'critical' : 'high',
                url: item.link,
                commentary: isDarkWeb ? 'Found on known data exposure platform' : 'Potential exposure mention'
              });
            }
          }
          await delay(500);
        } catch (e) {
          console.error('Dark web search error:', e);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3: SOCIAL MEDIA & DIGITAL FOOTPRINT
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (GOOGLE_API_KEY && GOOGLE_CX) {
      const socialPlatforms = [
        { query: `"${entity.name}" site:linkedin.com`, platform: 'LinkedIn', icon: '💼' },
        { query: `"${entity.name}" site:twitter.com OR site:x.com`, platform: 'Twitter/X', icon: '🐦' },
        { query: `"${entity.name}" site:facebook.com`, platform: 'Facebook', icon: '📘' },
        { query: `"${entity.name}" site:instagram.com`, platform: 'Instagram', icon: '📸' }
      ];

      for (const { query, platform, icon } of socialPlatforms) {
        try {
          const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
          searchUrl.searchParams.set('key', GOOGLE_API_KEY);
          searchUrl.searchParams.set('cx', GOOGLE_CX);
          searchUrl.searchParams.set('q', query);
          searchUrl.searchParams.set('num', '3');

          const response = await fetchWithRetry(searchUrl.toString(), {});
          if (response.ok) {
            const data = await response.json();
            for (const item of data.items || []) {
              results.push({
                category: 'digital_footprint',
                type: 'social_media',
                label: `${icon} ${platform}: ${item.title?.slice(0, 50)}`,
                value: item.snippet || 'No description available',
                source: platform,
                confidence: 75,
                riskLevel: 'low',
                url: item.link,
                commentary: `${platform} presence detected`
              });
            }
          }
          await delay(500);
        } catch (e) {
          console.error(`${platform} search error:`, e);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 4: NEWS & MEDIA INTELLIGENCE
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (GOOGLE_API_KEY && GOOGLE_CX) {
      const newsQueries = [
        `"${entity.name}" news`,
        `"${entity.name}" controversy OR scandal OR lawsuit`,
        `"${entity.name}" arrest OR investigation OR charged`
      ];

      for (const query of newsQueries) {
        try {
          const searchUrl = new URL('https://www.googleapis.com/customsearch/v1');
          searchUrl.searchParams.set('key', GOOGLE_API_KEY);
          searchUrl.searchParams.set('cx', GOOGLE_CX);
          searchUrl.searchParams.set('q', query);
          searchUrl.searchParams.set('num', '5');
          searchUrl.searchParams.set('sort', 'date');

          const response = await fetchWithRetry(searchUrl.toString(), {});
          if (response.ok) {
            const data = await response.json();
            for (const item of data.items || []) {
              const isNegative = /arrest|scandal|lawsuit|investigation|charged|controversy/i.test(
                item.title + ' ' + item.snippet
              );
              
              results.push({
                category: 'news',
                type: isNegative ? 'adverse_media' : 'media_mention',
                label: `${isNegative ? '⚠️' : '📰'} ${item.title?.slice(0, 60)}`,
                value: item.snippet || 'No description available',
                source: new URL(item.link).hostname,
                confidence: 70,
                riskLevel: isNegative ? 'high' : 'low',
                url: item.link,
                commentary: isNegative ? 'Adverse media mention detected' : 'General news mention'
              });
            }
          }
          await delay(500);
        } catch (e) {
          console.error('News search error:', e);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5: RELATIONSHIP & NETWORK ANALYSIS (AI-Powered)
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (GEMINI_API_KEY || PERPLEXITY_API_KEY) {
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
            ]
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
    
    if (PERPLEXITY_API_KEY && (entity.type === 'organization' || entity.type === 'infrastructure' || entity.type === 'domain')) {
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
        await delay(1500);
      } catch (e) {
        console.error('[DEEP-SCAN] Technical OSINT error:', e);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5C: SANCTIONS & REGISTRY SCREENING
    // ═══════════════════════════════════════════════════════════════════════════
    
    if (PERPLEXITY_API_KEY || GEMINI_API_KEY) {
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
            ]
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
        await delay(1500);
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

    // Store findings in entity_content for reference
    for (const result of results.filter(r => r.url)) {
      await supabase
        .from('entity_content')
        .upsert({
          entity_id,
          content_type: result.category,
          title: result.label,
          url: result.url!,
          source: result.source,
          excerpt: result.value,
          content_text: result.commentary,
          relevance_score: result.confidence,
          metadata: {
            risk_level: result.riskLevel,
            scan_type: 'deep_scan',
            discovered_at: new Date().toISOString()
          }
        }, {
          onConflict: 'entity_id,url'
        });
    }

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
    console.error('Entity deep scan error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
