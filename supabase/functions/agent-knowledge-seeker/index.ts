/**
 * agent-knowledge-seeker
 *
 * Each active agent aggressively hunts the internet for the best available
 * knowledge in their specialty — books, podcasts, academic papers, expert
 * practitioners, case studies, frameworks, and emerging research.
 *
 * Runs per-agent via Perplexity with targeted multi-angle queries.
 * Stores results in expert_knowledge attributed to the agent's specialty.
 * Designed to be called by cron or on-demand.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { extractYouTubeTranscript } from "../_shared/youtube-transcript.ts";

// High-value practitioner sources to monitor for recent content
const PRACTITIONER_SOURCES = [
  { query: 'Sarah Adams CIA intelligence analyst threat assessment 2026', domain: 'threat_intelligence' },
  { query: 'Shawn Ryan Show threat intelligence energy infrastructure 2026', domain: 'threat_intelligence' },
  { query: 'Mike Glover Fieldcraft operational security threat assessment', domain: 'physical_security' },
  { query: 'forward observer intelligence preparation environment energy sector', domain: 'threat_intelligence' },
];

// Knowledge hunt angles — each agent runs ALL of these for their specialty
const KNOWLEDGE_ANGLES = [
  {
    angle: 'books',
    queryTemplate: (specialty: string) =>
      `What are the most essential books every expert in "${specialty}" must read? Include classics and recent publications. Give titles, authors, and why each is essential.`,
  },
  {
    angle: 'podcasts',
    queryTemplate: (specialty: string) =>
      `What are the best podcasts for deep expertise in "${specialty}"? Include show names, hosts, standout episodes, and what makes each valuable. Include both mainstream and niche shows.`,
  },
  {
    angle: 'practitioners',
    queryTemplate: (specialty: string) =>
      `Who are the world's leading practitioners and thought leaders in "${specialty}"? Include retired military/intelligence officers, researchers, and practitioners. What are they known for specifically?`,
  },
  {
    angle: 'frameworks',
    queryTemplate: (specialty: string) =>
      `What are the most important frameworks, methodologies, and doctrines used by experts in "${specialty}"? Include named models, decision frameworks, and operational procedures used by professionals.`,
  },
  {
    angle: 'case_studies',
    queryTemplate: (specialty: string) =>
      `What are the most instructive real-world case studies and incidents that professionals in "${specialty}" study to improve their practice? Include what lessons each teaches.`,
  },
  {
    angle: 'research',
    queryTemplate: (specialty: string) =>
      `What are the most influential academic papers, government reports, and research publications in "${specialty}"? Include authors, institutions, and the key findings that changed the field.`,
  },
  {
    angle: 'emerging',
    queryTemplate: (specialty: string) =>
      `What are the most important emerging trends, new threats, and evolving best practices in "${specialty}" in 2025 and 2026? What do experts say practitioners must understand right now?`,
  },
  {
    angle: 'tools',
    queryTemplate: (specialty: string) =>
      `What are the most important tools, platforms, databases, and resources that professionals in "${specialty}" use daily? Include both commercial and open-source options and what each is best for.`,
  },
];

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();
    const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

    if (!PERPLEXITY_API_KEY) return errorResponse('PERPLEXITY_API_KEY not configured', 500);

    const body = await req.json().catch(() => ({}));
    const {
      agent_call_sign,   // target a specific agent (optional)
      angles,            // specific angles to run (optional, default all)
      force = false,     // re-ingest even if recently done
      max_agents = 5,    // limit agents per invocation to avoid timeout
    } = body;

    // Load agents
    let agentQuery = supabase
      .from('ai_agents')
      .select('id, call_sign, codename, specialty, mission_scope')
      .eq('is_active', true)
      .order('updated_at', { ascending: true }); // least-recently-updated first = natural rotation
    if (agent_call_sign) agentQuery = agentQuery.eq('call_sign', agent_call_sign);

    const { data: agents } = await agentQuery.limit(max_agents);
    if (!agents?.length) return errorResponse('No agents found', 404);

    const anglesToRun = angles?.length
      ? KNOWLEDGE_ANGLES.filter(a => angles.includes(a.angle))
      : KNOWLEDGE_ANGLES;

    // Run agent hunts + practitioner source hunts in parallel
    const [agentResults, practitionerResult] = await Promise.allSettled([
      Promise.allSettled(agents.map(agent =>
        runAgentKnowledgeHunt({ agent, anglesToRun, perplexityKey: PERPLEXITY_API_KEY, supabase, force })
      )),
      runPractitionerSourceHunts({ perplexityKey: PERPLEXITY_API_KEY, supabase, force }),
    ]);

    const results = agentResults.status === 'fulfilled' ? agentResults.value : [];
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    const diagnostics = agents.map((a, i) => ({
      call_sign: a.call_sign,
      specialty: a.specialty?.substring(0, 80),
      angles: results[i]?.status === 'fulfilled' ? results[i].value : { error: (results[i] as any)?.reason },
    }));

    return successResponse({
      message: 'Agent knowledge hunt complete',
      agents_processed: agents.length,
      succeeded,
      failed,
      angles_per_agent: anglesToRun.length,
      queries_total: agents.length * anglesToRun.length,
      practitioner_hunts: practitionerResult.status === 'fulfilled' ? practitionerResult.value : { error: String(practitionerResult.reason) },
      diagnostics,
    });

  } catch (err) {
    console.error('[agent-knowledge-seeker] Error:', err);
    return errorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});

async function runAgentKnowledgeHunt(params: {
  agent: any;
  anglesToRun: typeof KNOWLEDGE_ANGLES;
  perplexityKey: string;
  supabase: any;
  force: boolean;
}) {
  const { agent, anglesToRun, perplexityKey, supabase, force } = params;

  // Use first specialty domain for cleaner queries
  const specialty = agent.specialty?.split(',')[0]?.trim() || agent.specialty || 'security intelligence';
  console.log(`[agent-knowledge-seeker] ${agent.call_sign} hunting: ${specialty}`);

  // Run all angles in parallel batches of 4
  const BATCH = 4;
  const angleResults: Record<string, string> = {};
  for (let i = 0; i < anglesToRun.length; i += BATCH) {
    const batch = anglesToRun.slice(i, i + BATCH);
    const batchResults = await Promise.allSettled(batch.map(angleConfig =>
      huntOneAngle({ agent, specialty, angleConfig, perplexityKey, supabase, force })
    ));
    batch.forEach((ac, idx) => {
      const r = batchResults[idx];
      angleResults[ac.angle] = r.status === 'fulfilled' ? (r.value ?? 'undefined') : `rejected:${r.reason}`;
    });
  }

  // Advance rotation: update agent's updated_at so next run picks a different agent
  await supabase.from('ai_agents').update({ updated_at: new Date().toISOString() }).eq('id', agent.id);

  return angleResults;
}

async function huntOneAngle(params: {
  agent: any;
  specialty: string;
  angleConfig: typeof KNOWLEDGE_ANGLES[0];
  perplexityKey: string;
  supabase: any;
  force: boolean;
}): Promise<string> {
  const { agent, specialty, angleConfig, perplexityKey, supabase, force } = params;

  // Skip if already ingested this angle for this agent recently
  if (!force) {
    const { data: existing } = await supabase
      .from('expert_knowledge')
      .select('id')
      .eq('expert_name', `agent:${agent.call_sign}`)
      .eq('subdomain', angleConfig.angle)
      .gte('created_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1);
    if (existing?.length) return 'skipped:recent';
  }

  try {
    const resp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${perplexityKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: `You are a research librarian building the most comprehensive knowledge base possible for an AI agent specializing in "${specialty}". Be exhaustive. Include specific titles, names, URLs, publication dates, and why each resource is valuable. Prioritize depth over breadth — real practitioners need real specifics.`,
          },
          {
            role: 'user',
            content: angleConfig.queryTemplate(specialty),
          },
        ],
        temperature: 0.1,
        search_recency_filter: 'year',
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '(unreadable)');
      console.error(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle} Perplexity ${resp.status}: ${errText.slice(0, 200)}`);
      return `perplexity_error:${resp.status}:${errText.slice(0, 100)}`;
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const citations: string[] = data.citations || [];

    console.log(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle} Perplexity OK, content length: ${content.length}`);

    if (content.length < 100) return `short_content:${content.length}`;

    // Extract transcripts from any YouTube citations in parallel
    const youtubeCitations = citations.filter(c => /(?:youtube\.com\/watch\?v=|youtu\.be\/)/.test(c));
    if (youtubeCitations.length > 0) {
      console.log(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle} extracting ${youtubeCitations.length} YouTube transcript(s)`);
      const transcriptResults = await Promise.allSettled(
        youtubeCitations.map(url => extractYouTubeTranscript(url))
      );
      const transcriptRows = youtubeCitations
        .map((url, i) => {
          const t = transcriptResults[i];
          return t.status === 'fulfilled' && t.value ? { url, transcript: t.value } : null;
        })
        .filter(Boolean) as Array<{ url: string; transcript: string }>;

      if (transcriptRows.length > 0) {
        const videoEntries = transcriptRows.map(({ url, transcript }) => ({
          expert_name: `agent:${agent.call_sign}`,
          source_url: url,
          media_type: 'video',
          domain: deriveDomain(specialty),
          subdomain: angleConfig.angle,
          knowledge_type: 'video_transcript',
          title: `Video transcript — ${specialty.substring(0, 60)} (${angleConfig.angle})`,
          content: transcript,
          applicability_tags: [agent.call_sign, angleConfig.angle, 'video_transcript'],
          citation: `YouTube transcript — ${agent.call_sign} knowledge hunt`,
          confidence_score: 0.75,
          source_type: 'youtube_transcript',
          last_validated_at: new Date().toISOString(),
        }));
        const { error: vidErr } = await supabase.from('expert_knowledge').insert(videoEntries);
        if (vidErr) console.error(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle} video insert error:`, vidErr);
        else console.log(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle}: stored ${videoEntries.length} video transcript(s)`);
      }
    }

    const fullText = content + (citations.length ? `\n\nSources:\n${citations.join('\n')}` : '');

    // AI extraction into structured entries
    const entries = await extractStructuredEntries(fullText, specialty, angleConfig.angle, agent);

    if (entries.length > 0) {
      const rows = entries.map(e => ({
        expert_name: `agent:${agent.call_sign}`,
        source_url: `agent-hunt:${agent.call_sign}:${angleConfig.angle}`,
        media_type: angleConfig.angle,
        domain: deriveDomain(specialty),
        subdomain: angleConfig.angle,
        knowledge_type: e.knowledge_type || angleConfig.angle,
        title: e.title,
        content: e.content,
        applicability_tags: [agent.call_sign, angleConfig.angle, ...(e.tags || [])],
        citation: `${agent.call_sign} knowledge hunt — ${angleConfig.angle} — ${specialty}`,
        confidence_score: 0.80,
        source_type: 'agent_knowledge_hunt',
        last_validated_at: new Date().toISOString(),
      }));
      const { error: insErr } = await supabase.from('expert_knowledge').insert(rows);
      if (insErr) { console.error(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle} insert error:`, insErr); return `insert_error:${insErr.message}`; }
      else { console.log(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle}: stored ${rows.length} entries`); return `ok:${rows.length}`; }
    } else {
      // Store raw as fallback
      const { error: rawErr } = await supabase.from('expert_knowledge').insert({
        expert_name: `agent:${agent.call_sign}`,
        source_url: `agent-hunt:${agent.call_sign}:${angleConfig.angle}`,
        media_type: angleConfig.angle,
        domain: deriveDomain(specialty),
        subdomain: angleConfig.angle,
        knowledge_type: angleConfig.angle,
        title: `${agent.call_sign}: ${angleConfig.angle} — ${specialty.substring(0, 60)}`,
        content: fullText.slice(0, 3000),
        applicability_tags: [agent.call_sign, angleConfig.angle],
        citation: `${agent.call_sign} knowledge hunt`,
        confidence_score: 0.72,
        source_type: 'agent_knowledge_hunt_raw',
        last_validated_at: new Date().toISOString(),
      });
      if (rawErr) { console.error(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle} raw insert error:`, rawErr); return `raw_insert_error:${rawErr.message}`; }
      else { console.log(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle}: stored raw fallback`); return 'ok:raw'; }
    }

  } catch (e) {
    console.error(`[agent-knowledge-seeker] ${agent.call_sign}/${angleConfig.angle} error:`, e);
    return `catch_error:${e instanceof Error ? e.message : String(e)}`;
  }
  return 'unknown';
}

async function extractStructuredEntries(
  text: string,
  specialty: string,
  angle: string,
  agent: any
): Promise<Array<{ title: string; content: string; knowledge_type: string; tags: string[] }>> {
  const systemPrompt = `Extract structured knowledge entries from the following research about "${specialty}" (${angle} angle).
Return a JSON array of 3-8 entries. Each entry:
- "title": concise title (max 100 chars)
- "content": 150-400 words of dense, actionable knowledge. Preserve specific names, titles, URLs, and why each matters.
- "knowledge_type": one of: book, podcast, practitioner, framework, case_study, research_paper, tool, emerging_trend
- "tags": 3-5 tags

Return ONLY the JSON array.`;

  try {
    const result = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 5000) },
      ],
      functionName: `agent-knowledge-extract-${agent.call_sign}`,
      retries: 1,
      extraBody: { max_completion_tokens: 2000 },
    });
    if (result.error || !result.content) return [];
    const cleaned = result.content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch (_) {
    return [];
  }
}

async function runPractitionerSourceHunts(params: {
  perplexityKey: string;
  supabase: any;
  force: boolean;
}): Promise<Record<string, string>> {
  const { perplexityKey, supabase, force } = params;
  const results: Record<string, string> = {};

  await Promise.allSettled(PRACTITIONER_SOURCES.map(async ({ query, domain }) => {
    const shortKey = query.substring(0, 40);

    if (!force) {
      const { data: existing } = await supabase
        .from('expert_knowledge')
        .select('id')
        .eq('source_type', 'practitioner_monitor')
        .ilike('citation', `%${query.substring(0, 60)}%`)
        .gte('created_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);
      if (existing?.length) { results[shortKey] = 'skipped:recent'; return; }
    }

    try {
      const resp = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${perplexityKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sonar-pro',
          messages: [
            {
              role: 'system',
              content: 'You are monitoring high-value security intelligence practitioners for recent insights, publications, and analysis. Summarize their most recent and important content. Include specific titles, dates, key arguments, and actionable intelligence. Be concrete and specific.',
            },
            { role: 'user', content: query },
          ],
          temperature: 0.1,
          search_recency_filter: 'month',
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (!resp.ok) { results[shortKey] = `perplexity_error:${resp.status}`; return; }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      const citations: string[] = data.citations || [];

      if (content.length < 100) { results[shortKey] = `short:${content.length}`; return; }

      const fullContent = content + (citations.length ? `\n\nSources:\n${citations.join('\n')}` : '');

      const { error } = await supabase.from('expert_knowledge').insert({
        expert_name: 'practitioner-monitor',
        source_url: `practitioner-monitor:${query.substring(0, 80)}`,
        media_type: 'practitioner',
        domain,
        subdomain: 'practitioner_content',
        knowledge_type: 'practitioner',
        title: query.substring(0, 100),
        content: fullContent.slice(0, 4000),
        applicability_tags: ['practitioner_monitor', domain],
        citation: `Practitioner monitor: ${query.substring(0, 60)}`,
        confidence_score: 0.78,
        source_type: 'practitioner_monitor',
        last_validated_at: new Date().toISOString(),
      });

      results[shortKey] = error ? `insert_error:${error.message}` : 'ok';
    } catch (e) {
      results[shortKey] = `catch:${e instanceof Error ? e.message : String(e)}`;
    }
  }));

  return results;
}

function deriveDomain(specialty: string): string {
  const s = specialty.toLowerCase();
  if (s.includes('cyber') || s.includes('hack') || s.includes('pentest')) return 'cyber';
  if (s.includes('physical') || s.includes('entry') || s.includes('lock')) return 'physical_security';
  if (s.includes('executive') || s.includes('protection') || s.includes('vip')) return 'executive_protection';
  if (s.includes('crisis') || s.includes('incident') || s.includes('response')) return 'crisis_management';
  if (s.includes('threat') || s.includes('intelligence') || s.includes('osint')) return 'threat_intelligence';
  if (s.includes('travel') || s.includes('kidnap')) return 'travel_security';
  if (s.includes('terror') || s.includes('counter')) return 'counter_terrorism';
  if (s.includes('fraud') || s.includes('social engineer')) return 'fraud_social_engineering';
  if (s.includes('narco') || s.includes('drug') || s.includes('cartel')) return 'narcotics_organized_crime';
  if (s.includes('maritime') || s.includes('piracy')) return 'maritime_security';
  if (s.includes('geopolit') || s.includes('nation')) return 'geopolitical';
  if (s.includes('insider')) return 'insider_threat';
  return 'threat_intelligence';
}
