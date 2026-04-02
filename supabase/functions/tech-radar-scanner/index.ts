import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

/**
 * Technology Radar Scanner
 * 
 * Proactively monitors emerging security technologies across all domains
 * and generates actionable adoption recommendations. Runs weekly via cron
 * or on-demand. Uses Perplexity for real-time tech landscape scanning
 * and Gemini for organizational relevance scoring.
 */

const SCAN_CATEGORIES = [
  { category: 'ai_ml', label: 'AI & Machine Learning Security', queries: ['latest AI and machine learning security tools for enterprise SOC 2025 2026 emerging technology', 'generative AI threat detection and automated incident response platforms new releases'] },
  { category: 'endpoint', label: 'Endpoint & XDR', queries: ['emerging endpoint detection response XDR platforms and innovations 2025 2026'] },
  { category: 'network', label: 'Network Security', queries: ['next generation network security SASE zero trust network access innovations 2025 2026'] },
  { category: 'cloud', label: 'Cloud Security', queries: ['emerging cloud security posture management CNAPP CSPM tools enterprise 2025 2026'] },
  { category: 'physical', label: 'Physical Security Tech', queries: ['emerging physical security technology AI video analytics drone detection access control 2025 2026'] },
  { category: 'identity', label: 'Identity & Access', queries: ['passwordless authentication decentralized identity ITDR innovations enterprise 2025 2026'] },
  { category: 'data_protection', label: 'Data Protection', queries: ['post-quantum cryptography data loss prevention innovations enterprise security 2025 2026'] },
  { category: 'deception', label: 'Deception & Threat Intel', queries: ['deception technology honeypots threat intelligence platforms innovations 2025 2026'] },
  { category: 'automation', label: 'Security Automation & SOAR', queries: ['security orchestration automation SOAR hyperautomation platforms enterprise 2025 2026'] },
];

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const { categories, max_per_category } = body as { categories?: string[]; max_per_category?: number };

    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
    if (!PERPLEXITY_API_KEY) {
      return errorResponse('Missing PERPLEXITY_API_KEY', 500);
    }

    const supabase = createServiceClient();
    const limit = max_per_category || 3;

    let categoriesToScan = SCAN_CATEGORIES;
    if (categories && categories.length > 0) {
      categoriesToScan = SCAN_CATEGORIES.filter(c => categories.includes(c.category));
    }

    const { data: clients } = await supabase
      .from('clients')
      .select('industry, high_value_assets, locations')
      .limit(10);

    const orgContext = clients?.map(c =>
      `Industry: ${c.industry || 'Unknown'}, Assets: ${(c.high_value_assets || []).join(', ')}, Locations: ${(c.locations || []).join(', ')}`
    ).join('\n') || 'Fortune 500 enterprise with global operations';

    console.log(`[tech-radar-scanner] Scanning ${categoriesToScan.length} categories`);

    let totalRecommendations = 0;
    const results: Record<string, number> = {};

    for (const cat of categoriesToScan) {
      let catCount = 0;

      for (const query of cat.queries) {
        try {
          await new Promise(r => setTimeout(r, 1500));

          const rawIntel = await scanWithPerplexity(PERPLEXITY_API_KEY, query);
          if (!rawIntel) continue;

          const recommendations = await analyzeAndRecommend(rawIntel, cat.category, cat.label, orgContext, limit);
          if (!recommendations || recommendations.length === 0) continue;

          for (const rec of recommendations) {
            const { data: existing } = await supabase
              .from('tech_radar_recommendations')
              .select('id')
              .ilike('technology_name', `%${rec.technology_name.substring(0, 30)}%`)
              .eq('category', cat.category)
              .limit(1);

            if (existing && existing.length > 0) {
              await supabase.from('tech_radar_recommendations').update({
                summary: rec.summary, business_case: rec.business_case, maturity_level: rec.maturity_level,
                urgency: rec.urgency, relevance_score: rec.relevance_score, vendor_landscape: rec.vendor_landscape,
                source_citations: rec.source_citations || [], updated_at: new Date().toISOString(),
              }).eq('id', existing[0].id);
            } else {
              await supabase.from('tech_radar_recommendations').insert({
                category: cat.category, technology_name: rec.technology_name, vendor_landscape: rec.vendor_landscape,
                maturity_level: rec.maturity_level, relevance_score: rec.relevance_score, urgency: rec.urgency,
                summary: rec.summary, business_case: rec.business_case, implementation_effort: rec.implementation_effort,
                estimated_timeline: rec.estimated_timeline, dependencies: rec.dependencies || [], risks: rec.risks || [],
                competing_with: rec.competing_with || [], source_citations: rec.source_citations || [],
              });
            }
            catCount++;
          }
        } catch (err) {
          console.error(`[tech-radar-scanner] Error in ${cat.category}:`, err);
        }
      }

      results[cat.category] = catCount;
      totalRecommendations += catCount;
    }

    console.log(`[tech-radar-scanner] Complete: ${totalRecommendations} recommendations`);

    return successResponse({
      message: 'Technology radar scan complete',
      total_recommendations: totalRecommendations,
      categories_scanned: Object.keys(results).length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[tech-radar-scanner] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

async function scanWithPerplexity(apiKey: string, query: string): Promise<string | null> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: 'You are a security technology analyst tracking emerging tools, platforms, and innovations. Provide detailed, factual information about new and emerging security technologies including vendor names, capabilities, maturity levels, and adoption trends. Focus on technologies released or significantly updated in the last 6 months.' },
        { role: 'user', content: query }
      ],
      temperature: 0.1,
      search_recency_filter: 'month',
    }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const citations = data.citations || [];
  return JSON.stringify({ content, citations });
}

async function analyzeAndRecommend(
  rawIntel: string, category: string, categoryLabel: string, orgContext: string, limit: number
): Promise<any[]> {
  const prompt = `Analyze this security technology intelligence and generate ${limit} structured adoption recommendations.

CATEGORY: ${categoryLabel}
ORGANIZATION PROFILE:
${orgContext}

RAW INTELLIGENCE:
${rawIntel}

For each technology, return a JSON array with objects containing:
- "technology_name", "vendor_landscape", "maturity_level", "relevance_score", "urgency", "summary", "business_case", "implementation_effort", "estimated_timeline", "dependencies", "risks", "competing_with", "source_citations"

Return ONLY the JSON array.`;

  const aiResult = await callAiGateway({
    model: 'google/gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a senior security technology strategist advising Fortune 500 CISOs. Generate precise, evidence-based technology adoption recommendations.' },
      { role: 'user', content: prompt }
    ],
    functionName: 'tech-radar-scanner',
  });

  if (aiResult.error || !aiResult.content) return [];

  try {
    const jsonMatch = aiResult.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
    }
  } catch (e) {
    console.error('[tech-radar-scanner] Parse error:', e);
  }
  return [];
}
