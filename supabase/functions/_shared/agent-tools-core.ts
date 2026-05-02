/**
 * Core tool implementations registered with the agent-tools framework.
 *
 * Importing this file (with side-effect: it calls registerTool() for each)
 * makes the tools available to runAgentLoop. Functions wanting tool use
 * should import this once at module load:
 *
 *   import "../_shared/agent-tools-core.ts";  // registers tools
 *   import { runAgentLoop } from "../_shared/agent-tools.ts";
 *
 * Each tool below maps to one of the agent-capability roadmap items:
 *   #1 lookup_historical_signals + query_entity_relationships  (investigation)
 *   #2 emit_prediction                                          (predictions+scoring)
 *   #3 retrieve_similar_past_decisions                          (episode memory)
 *   #5 agent_consult                                            (cross-agent help)
 */

import { registerTool, type ToolHandler } from "./agent-tools.ts";
import { callAiGatewayJson } from "./ai-gateway.ts";
import { embedText } from "./embed.ts";
import { proposeAction } from "./agent-actions.ts";
import { getArcGISClient } from "./arcgis.ts";

// ── Tool 1: lookup_historical_signals ───────────────────────────────────────

const lookupHistoricalSignals: ToolHandler = {
  name: 'lookup_historical_signals',
  description:
    'Retrieve recent signals related to an entity, keyword, or location. Use this when you need to know whether a person, organisation, or pattern has appeared before. Returns up to 10 most recent matching signals with title, severity, and date.',
  parameters: {
    type: 'object',
    properties: {
      entity_or_keyword: { type: 'string', description: 'Entity name or keyword to search for in signal text.' },
      days_back: { type: 'number', description: 'How many days of history to search. Default 90.' },
      limit: { type: 'number', description: 'Max number of signals to return. Default 10, cap 25.' },
    },
    required: ['entity_or_keyword'],
  },
  async execute(args, _ctx, supabase) {
    const term = String(args.entity_or_keyword || '').trim();
    const days = Math.min(Math.max(Number(args.days_back) || 90, 1), 365);
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
    if (!term) return { error: 'entity_or_keyword required' };
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const { data, error } = await supabase
      .from('signals')
      .select('id, title, severity, severity_score, category, created_at, normalized_text')
      .or(`title.ilike.%${term.replace(/[%,]/g, '')}%,normalized_text.ilike.%${term.replace(/[%,]/g, '')}%`)
      .gte('created_at', since)
      .is('deleted_at', null)
      .eq('is_test', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { error: error.message };
    return {
      term,
      days_searched: days,
      count: data?.length ?? 0,
      signals: (data ?? []).map((s) => ({
        id: s.id,
        title: (s.title || '').substring(0, 120),
        severity: s.severity,
        severity_score: s.severity_score,
        category: s.category,
        created_at: s.created_at,
        excerpt: (s.normalized_text || '').substring(0, 200),
      })),
    };
  },
};

// ── Tool 2: query_entity_relationships ─────────────────────────────────────

const queryEntityRelationships: ToolHandler = {
  name: 'query_entity_relationships',
  description:
    'Look up known relationships and recent mentions for an entity (person or organisation). Returns related entities, recent signal mentions count, and whether the entity is on any active monitoring/watch list.',
  parameters: {
    type: 'object',
    properties: {
      entity_name: { type: 'string', description: 'Name of the entity to look up.' },
    },
    required: ['entity_name'],
  },
  async execute(args, _ctx, supabase) {
    const name = String(args.entity_name || '').trim();
    if (!name) return { error: 'entity_name required' };
    const { data: entity } = await supabase
      .from('entities')
      .select('id, name, type, active_monitoring_enabled, attributes, client_id')
      .ilike('name', name)
      .limit(1)
      .maybeSingle();
    if (!entity) {
      return { entity_name: name, found: false, message: 'No matching entity in graph.' };
    }
    const [{ data: rels }, { count: mentions }] = await Promise.all([
      supabase
        .from('entity_relationships')
        .select('to_entity_id, relationship_type')
        .eq('from_entity_id', entity.id)
        .limit(10),
      supabase
        .from('entity_mentions')
        .select('id', { count: 'exact', head: true })
        .eq('entity_id', entity.id)
        .gte('created_at', new Date(Date.now() - 90 * 86400_000).toISOString()),
    ]);
    let relatedNames: string[] = [];
    if (rels && rels.length > 0) {
      const ids = rels.map((r: any) => r.to_entity_id).filter(Boolean);
      const { data: relatedEntities } = await supabase
        .from('entities')
        .select('id, name')
        .in('id', ids);
      relatedNames = (relatedEntities ?? []).map((e: any) => e.name);
    }
    return {
      entity_name: entity.name,
      type: entity.type,
      monitoring_enabled: entity.active_monitoring_enabled,
      related_entities: relatedNames,
      mentions_last_90d: mentions ?? 0,
      attributes_keys: Object.keys(entity.attributes || {}),
    };
  },
};

// ── Tool 3: retrieve_similar_past_decisions (episode memory) ───────────────

const retrieveSimilarPastDecisions: ToolHandler = {
  name: 'retrieve_similar_past_decisions',
  description:
    'Retrieve up to 5 of YOUR (the calling agent\'s) most semantically similar prior reasoning rows. Pass a query_text describing what you are now assessing and the tool returns past decisions that are conceptually closest, ranked by cosine similarity. Falls back to category match if embedding lookup fails.',
  parameters: {
    type: 'object',
    properties: {
      query_text: { type: 'string', description: 'Free-text description of the current signal/decision you want past parallels for. Be concrete (1-2 sentences).' },
      category: { type: 'string', description: 'Optional signal category for fallback when embedding is unavailable.' },
      entity_hint: { type: 'string', description: 'Optional entity name to narrow further (used in fallback path).' },
    },
    required: ['query_text'],
  },
  async execute(args, ctx, supabase) {
    const queryText = String(args.query_text || '').trim();
    const category = String(args.category || '').trim();
    const entityHint = String(args.entity_hint || '').trim();
    if (!queryText) return { error: 'query_text required' };

    // Primary path: vector cosine similarity via the find_similar_agent_analyses RPC.
    const queryEmbedding = await embedText(queryText);
    if (queryEmbedding) {
      const { data, error } = await supabase.rpc('find_similar_agent_analyses', {
        p_agent_call_sign: ctx.agentCallSign,
        p_query_embedding: queryEmbedding,
        p_limit: 5,
        p_min_similarity: 0.5,
      });
      if (!error && data && data.length > 0) {
        return {
          mode: 'vector',
          agent_call_sign: ctx.agentCallSign,
          query: queryText.substring(0, 120),
          count: data.length,
          past_decisions: (data as any[]).map((r) => ({
            signal_id: r.signal_id,
            reasoning_excerpt: (r.analysis || '').substring(0, 350),
            confidence: r.confidence_score,
            trigger: r.trigger_reason,
            similarity: Math.round(((r.similarity ?? 0) as number) * 1000) / 1000,
            decided_at: r.created_at,
          })),
        };
      }
      // Fall through to category match if vector returns nothing
    }

    // Fallback path: category + entity_tag match (legacy behaviour).
    if (!category) {
      return {
        mode: 'fallback_unavailable',
        agent_call_sign: ctx.agentCallSign,
        count: 0,
        message: 'Vector lookup returned no results and no category provided for fallback.',
      };
    }
    let q = supabase
      .from('signal_agent_analyses')
      .select('id, signal_id, analysis, confidence_score, trigger_reason, created_at, signals!inner(category, entity_tags, title, severity)')
      .eq('agent_call_sign', ctx.agentCallSign)
      .eq('signals.category', category)
      .order('created_at', { ascending: false })
      .limit(5);
    if (entityHint) {
      q = q.contains('signals.entity_tags', [entityHint]);
    }
    const { data, error } = await q;
    if (error) return { error: error.message };
    return {
      mode: 'category_fallback',
      agent_call_sign: ctx.agentCallSign,
      category,
      entity_hint: entityHint || null,
      count: data?.length ?? 0,
      past_decisions: (data ?? []).map((r: any) => ({
        signal_id: r.signal_id,
        reasoning_excerpt: (r.analysis || '').substring(0, 350),
        confidence: r.confidence_score,
        trigger: r.trigger_reason,
        signal_title: r.signals?.title?.substring(0, 100),
        signal_severity: r.signals?.severity,
        decided_at: r.created_at,
      })),
    };
  },
};

// ── Tool 4: emit_prediction ─────────────────────────────────────────────────

const emitPrediction: ToolHandler = {
  name: 'emit_prediction',
  description:
    'Make a falsifiable prediction tied to your current decision. The prediction will be auto-resolved against reality after expected_by, and your calibration score will be updated based on hits/misses. Use this whenever you make a high-stakes call so we can measure your accuracy over time. Examples: "another signal mentioning this entity will appear within 14 days", "this incident will not require escalation", "a corroborating signal will surface within 48h".',
  parameters: {
    type: 'object',
    properties: {
      prediction_text: { type: 'string', description: 'Plain-English prediction in one sentence.' },
      domain: { type: 'string', description: 'Knowledge domain (e.g. "physical_security", "cyber", "geopolitical", "compliance").' },
      confidence_probability: { type: 'number', description: 'Your subjective probability the prediction is correct (0.0-1.0).' },
      time_horizon_hours: { type: 'number', description: 'How many hours from now until the prediction should be resolved.' },
      triggering_conditions: { type: 'array', items: { type: 'string' }, description: 'Concrete observable events that would CONFIRM the prediction.' },
      falsifying_conditions: { type: 'array', items: { type: 'string' }, description: 'Concrete observable events that would REFUTE the prediction.' },
    },
    required: ['prediction_text', 'confidence_probability', 'time_horizon_hours', 'triggering_conditions', 'falsifying_conditions'],
  },
  async execute(args, ctx, supabase) {
    const text = String(args.prediction_text || '').trim();
    const conf = Math.max(0, Math.min(1, Number(args.confidence_probability) || 0));
    const horizon = Math.max(1, Math.min(24 * 90, Number(args.time_horizon_hours) || 168));
    if (!text) return { error: 'prediction_text required' };
    const expectedBy = new Date(Date.now() + horizon * 3600_000).toISOString();
    const { data, error } = await supabase
      .from('agent_world_predictions')
      .insert({
        agent_call_sign: ctx.agentCallSign,
        prediction_text: text.substring(0, 500),
        domain: String(args.domain || 'general'),
        confidence_probability: conf,
        time_horizon_hours: horizon,
        expected_by: expectedBy,
        triggering_conditions: Array.isArray(args.triggering_conditions) ? args.triggering_conditions.slice(0, 10) : [],
        falsifying_conditions: Array.isArray(args.falsifying_conditions) ? args.falsifying_conditions.slice(0, 10) : [],
        status: 'pending',
        related_signal_id: ctx.contextSignalId ?? null,
        related_incident_id: ctx.contextIncidentId ?? null,
        client_id: ctx.contextClientId ?? null,
      })
      .select('id, expected_by')
      .single();
    if (error) return { error: error.message };
    return {
      prediction_id: data!.id,
      expected_by: data!.expected_by,
      message: `Prediction recorded. Will auto-resolve at ${data!.expected_by} and update your calibration score.`,
    };
  },
};

// ── Tool 5: agent_consult ───────────────────────────────────────────────────

const agentConsult: ToolHandler = {
  name: 'agent_consult',
  description:
    'Consult a specialist agent for their domain expertise. Use this when your confidence is below 0.65 and another agent has stronger expertise on the topic (NEO=cyber pattern detection, CERBERUS=financial crime, OUROBOROS=supply chain, SPECTER=insider threat, MERIDIAN=geopolitical, ARGUS=physical security, WARDEN=content/digital safety, BRAVO-1=major case management). Returns the specialist\'s opinion which you should weigh in your final decision.',
  parameters: {
    type: 'object',
    properties: {
      specialist_call_sign: { type: 'string', description: 'Call sign of specialist to consult, e.g. "NEO", "CERBERUS".' },
      question: { type: 'string', description: 'The specific question for the specialist. Be concrete.' },
      context: { type: 'string', description: 'Brief context about the signal/incident you are evaluating.' },
    },
    required: ['specialist_call_sign', 'question', 'context'],
  },
  async execute(args, ctx, supabase) {
    const callSign = String(args.specialist_call_sign || '').trim().toUpperCase();
    const question = String(args.question || '').trim();
    const context = String(args.context || '').trim();
    if (!callSign || !question) return { error: 'specialist_call_sign and question required' };

    const { data: specialist } = await supabase
      .from('ai_agents')
      .select('call_sign, persona, specialty, system_prompt')
      .eq('call_sign', callSign)
      .eq('is_active', true)
      .maybeSingle();
    if (!specialist) {
      return { error: `Unknown or inactive specialist '${callSign}'` };
    }
    const consultResult = await callAiGatewayJson<{ assessment: string; confidence: number; reasoning: string }>({
      model: 'openai/gpt-5.2',
      functionName: `agent-consult:${callSign}`,
      messages: [
        {
          role: 'system',
          content: `You are ${specialist.call_sign}, ${specialist.specialty || ''}.\n\n${(specialist.system_prompt || '').substring(0, 4000)}\n\nYou are being CONSULTED by ${ctx.agentCallSign}, who is leading the assessment. Provide your domain expertise concisely. Do not hedge — give your best read.`,
        },
        { role: 'user', content: `Context: ${context}\n\nQuestion: ${question}\n\nReturn JSON: {"assessment": "your view in 2-3 sentences", "confidence": 0.0-1.0, "reasoning": "brief justification"}` },
      ],
      extraBody: { response_format: { type: 'json_object' } },
      retries: 1,
    });
    if (consultResult.error || !consultResult.data) {
      return { error: consultResult.error || 'Consult call failed' };
    }
    // Audit row in signal_agent_analyses
    if (ctx.contextSignalId) {
      await supabase.from('signal_agent_analyses').insert({
        signal_id: ctx.contextSignalId,
        agent_call_sign: callSign,
        analysis: `[CONSULT requested by ${ctx.agentCallSign}] ${consultResult.data.assessment}\n\nReasoning: ${consultResult.data.reasoning}`,
        confidence_score: consultResult.data.confidence,
        trigger_reason: 'cross_agent_consult',
        analysis_tier: 'consult',
        confidence_breakdown: { question, requesting_agent: ctx.agentCallSign },
      });
    }
    return {
      specialist: callSign,
      assessment: consultResult.data.assessment,
      confidence: consultResult.data.confidence,
      reasoning: consultResult.data.reasoning,
    };
  },
};

// ── Tool 6: get_signal_velocity ─────────────────────────────────────────────

const getSignalVelocity: ToolHandler = {
  name: 'get_signal_velocity',
  description:
    'Compute the rate of incoming signals for an entity, category, or client over a recent window vs a baseline. Returns counts and a delta multiplier. Use this when the question is "is something accelerating?" — e.g. usual rate is 1/week, today saw 5 in 24h = 35x baseline = anomaly.',
  parameters: {
    type: 'object',
    properties: {
      entity_or_keyword: { type: 'string', description: 'Optional entity name or keyword to filter signals.' },
      category: { type: 'string', description: 'Optional signal category to filter.' },
      client_id: { type: 'string', description: 'Optional client_id to scope to one client.' },
      window_hours: { type: 'number', description: 'Recent window length in hours. Default 24.' },
      baseline_days: { type: 'number', description: 'Baseline window in days for comparison. Default 30.' },
    },
  },
  async execute(args, ctx, supabase) {
    const term = String(args.entity_or_keyword || '').trim();
    const category = String(args.category || '').trim();
    const clientId = String(args.client_id || ctx.contextClientId || '').trim();
    const windowHours = Math.max(1, Math.min(720, Number(args.window_hours) || 24));
    const baselineDays = Math.max(1, Math.min(180, Number(args.baseline_days) || 30));

    const recentSince = new Date(Date.now() - windowHours * 3600_000).toISOString();
    const baselineSince = new Date(Date.now() - baselineDays * 86400_000).toISOString();

    const buildQuery = (since: string) => {
      let q = supabase
        .from('signals')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since)
        .is('deleted_at', null)
        .eq('is_test', false);
      if (term) q = q.or(`title.ilike.%${term.replace(/[%,]/g, '')}%,normalized_text.ilike.%${term.replace(/[%,]/g, '')}%`);
      if (category) q = q.eq('category', category);
      if (clientId) q = q.eq('client_id', clientId);
      return q;
    };
    const [{ count: recentCount }, { count: baselineCount }] = await Promise.all([
      buildQuery(recentSince),
      buildQuery(baselineSince),
    ]);
    const recent = recentCount ?? 0;
    const baseline = baselineCount ?? 0;
    const baselineRate = baseline / Math.max(1, baselineDays * 24); // per hour
    const recentRate = recent / Math.max(1, windowHours);
    const multiplier = baselineRate > 0 ? recentRate / baselineRate : (recent > 0 ? Infinity : 0);
    return {
      filter: { entity_or_keyword: term || null, category: category || null, client_id: clientId || null },
      window: { recent_hours: windowHours, baseline_days: baselineDays },
      counts: { recent, baseline },
      rates_per_hour: { recent: Math.round(recentRate * 100) / 100, baseline: Math.round(baselineRate * 100) / 100 },
      multiplier_vs_baseline: multiplier === Infinity ? '∞ (no prior signals)' : Math.round(multiplier * 100) / 100,
      interpretation:
        multiplier === Infinity ? 'first-ever appearance in baseline window — investigate'
        : multiplier > 5 ? 'STRONG acceleration — well above baseline'
        : multiplier > 2 ? 'moderate acceleration'
        : multiplier >= 0.7 ? 'normal pace'
        : 'below baseline (decline or quiet period)',
    };
  },
};

// ── Tool 7: detect_escalation_pattern ──────────────────────────────────────

const detectEscalationPattern: ToolHandler = {
  name: 'detect_escalation_pattern',
  description:
    'Examine the last 30 days of signals matching an entity/keyword and detect whether severity is trending up. Returns a per-week severity timeline and an escalation verdict. Use this to answer "is this getting worse over time?" beyond a single signal.',
  parameters: {
    type: 'object',
    properties: {
      entity_or_keyword: { type: 'string', description: 'Entity name or keyword to track.' },
      days_back: { type: 'number', description: 'How many days of history. Default 30.' },
    },
    required: ['entity_or_keyword'],
  },
  async execute(args, _ctx, supabase) {
    const term = String(args.entity_or_keyword || '').trim();
    const days = Math.min(Math.max(Number(args.days_back) || 30, 7), 180);
    if (!term) return { error: 'entity_or_keyword required' };
    const since = new Date(Date.now() - days * 86400_000).toISOString();
    const { data, error } = await supabase
      .from('signals')
      .select('created_at, severity, severity_score, title')
      .or(`title.ilike.%${term.replace(/[%,]/g, '')}%,normalized_text.ilike.%${term.replace(/[%,]/g, '')}%`)
      .gte('created_at', since)
      .is('deleted_at', null)
      .eq('is_test', false)
      .order('created_at', { ascending: true });
    if (error) return { error: error.message };
    const rows = data ?? [];
    if (rows.length === 0) {
      return { term, days, count: 0, verdict: 'no signals in window', timeline: [] };
    }
    // Bucket by week from oldest to most recent
    const buckets: Record<string, { week: string; count: number; mean_score: number; max_severity: string }> = {};
    for (const r of rows) {
      const d = new Date(r.created_at);
      const weekStart = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      if (!buckets[key]) buckets[key] = { week: key, count: 0, mean_score: 0, max_severity: 'low' };
      buckets[key].count++;
      buckets[key].mean_score += (r.severity_score ?? 0);
      const severityRank = (s: string) => s === 'critical' ? 4 : s === 'high' ? 3 : s === 'medium' ? 2 : 1;
      if (severityRank(r.severity) > severityRank(buckets[key].max_severity)) buckets[key].max_severity = r.severity;
    }
    const timeline = Object.values(buckets).map((b) => ({
      week: b.week,
      count: b.count,
      mean_score: Math.round((b.mean_score / b.count) * 10) / 10,
      max_severity: b.max_severity,
    }));
    // Escalation verdict: compare first half to second half
    const half = Math.floor(timeline.length / 2);
    const firstHalfMean = half > 0 ? timeline.slice(0, half).reduce((a, b) => a + b.mean_score, 0) / half : 0;
    const secondHalfMean = timeline.length - half > 0 ? timeline.slice(half).reduce((a, b) => a + b.mean_score, 0) / (timeline.length - half) : 0;
    const delta = secondHalfMean - firstHalfMean;
    let verdict: string;
    if (timeline.length < 2) verdict = 'insufficient history (need 2+ weeks)';
    else if (delta > 15) verdict = 'STRONG escalation — severity rising sharply';
    else if (delta > 5) verdict = 'moderate escalation';
    else if (delta < -10) verdict = 'de-escalating';
    else verdict = 'stable';
    return {
      term,
      days_searched: days,
      count: rows.length,
      timeline,
      verdict,
      severity_delta_first_to_second_half: Math.round(delta * 10) / 10,
    };
  },
};

// ── Tool 8: get_anomaly_score ──────────────────────────────────────────────

const getAnomalyScore: ToolHandler = {
  name: 'get_anomaly_score',
  description:
    'Look up the anomaly z-score for a specific signal if one has been computed by score-signal-anomaly. Returns the z-score, anomaly type, and details. Empty if no anomaly score exists for this signal.',
  parameters: {
    type: 'object',
    properties: {
      signal_id: { type: 'string', description: 'Signal id to look up.' },
    },
    required: ['signal_id'],
  },
  async execute(args, _ctx, supabase) {
    const id = String(args.signal_id || '').trim();
    if (!id) return { error: 'signal_id required' };
    const { data, error } = await supabase
      .from('signal_anomaly_scores')
      .select('z_score, anomaly_type, is_anomalous, anomaly_details, computed_at')
      .eq('signal_id', id)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { signal_id: id, found: false, message: 'No anomaly score has been computed for this signal yet.' };
    return {
      signal_id: id,
      found: true,
      z_score: data.z_score,
      anomaly_type: data.anomaly_type,
      is_anomalous: data.is_anomalous,
      details: data.anomaly_details,
      computed_at: data.computed_at,
    };
  },
};

// ── Tool 9: analyze_signal_image (vision) ──────────────────────────────────

const analyzeSignalImage: ToolHandler = {
  name: 'analyze_signal_image',
  description:
    'Use vision-capable AI to analyse the image attached to the current signal (signal.image_url / thumbnail_url / first media_urls entry). Returns structured findings: what is visible, identifying details, threat indicators, and confidence. Most signals from news, social, or wildfire monitors have an image — analysing it adds a layer of evidence beyond text.',
  parameters: {
    type: 'object',
    properties: {
      focus: { type: 'string', description: 'What you want the model to focus on, e.g. "identify protest signs", "verify pipeline damage", "extract people/text/objects", "describe scene". Default: general scene description.' },
    },
  },
  async execute(args, ctx, supabase) {
    if (!ctx.contextSignalId) return { error: 'analyze_signal_image requires contextSignalId on the agent run' };
    const focus = String(args.focus || 'general scene description and any identifying details').trim();
    const { data: signal, error: sigErr } = await supabase
      .from('signals')
      .select('id, title, image_url, thumbnail_url, media_urls')
      .eq('id', ctx.contextSignalId)
      .maybeSingle();
    if (sigErr) return { error: sigErr.message };
    if (!signal) return { error: 'signal not found' };
    const imageUrl = signal.image_url || signal.thumbnail_url || signal.media_urls?.[0];
    if (!imageUrl) {
      return { signal_id: ctx.contextSignalId, found: false, message: 'No image attached to this signal.' };
    }
    // Vision call via OpenAI compatible endpoint. gpt-5.2 supports vision content blocks.
    const result = await callAiGatewayJson<{
      summary: string;
      visible_objects: string[];
      identifying_details: string[];
      threat_indicators: string[];
      confidence: number;
      caveats: string;
    }>({
      model: 'openai/gpt-5.2',
      functionName: 'analyze_signal_image',
      messages: [
        {
          role: 'system',
          content: 'You are a security intelligence image analyst. Examine the image attached to this signal and return structured findings. Be specific about what you can verify visually. Distinguish between facts (clearly visible) and inferences (possible interpretations). If the image quality or content is insufficient, say so in caveats. Return JSON: {"summary": "1-2 sentence overview", "visible_objects": ["list"], "identifying_details": ["names/logos/locations/text on signs/etc"], "threat_indicators": ["things that elevate concern"], "confidence": 0.0-1.0, "caveats": "what you could not determine"}',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Analyse this image attached to signal "${(signal.title || '').substring(0, 100)}". Focus: ${focus}` },
            { type: 'image_url', image_url: { url: imageUrl } },
          ] as any,
        },
      ],
      extraBody: { response_format: { type: 'json_object' } },
      retries: 1,
    });
    if (result.error || !result.data) {
      return { signal_id: ctx.contextSignalId, found: true, image_url: imageUrl, error: result.error || 'vision call failed' };
    }
    return { signal_id: ctx.contextSignalId, found: true, image_url: imageUrl, ...result.data };
  },
};

// ── Action tools (permission-tiered, write to agent_actions ledger) ────────

// AUTO tier — agent acts directly; bounded scope and low blast radius.
const fileFollowupTask: ToolHandler = {
  name: 'file_followup_task',
  description:
    'Auto-tier action. File a follow-up task for an analyst to investigate something specific later. Lands in agent_actions ledger as executed. Use when you have a specific, time-bounded follow-up question that should not be lost.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title (under 120 chars).' },
      detail: { type: 'string', description: 'What should be looked at and why.' },
      followup_after_hours: { type: 'number', description: 'When this should resurface (default 24).' },
    },
    required: ['title', 'detail'],
  },
  async execute(args, ctx, supabase) {
    const result = await proposeAction(supabase, {
      agentCallSign: ctx.agentCallSign,
      actionType: 'file_followup_task',
      permissionTier: 'auto',
      rationale: `${ctx.agentCallSign} files follow-up: ${String(args.title || '').substring(0, 100)}`,
      actionPayload: {
        title: String(args.title || '').substring(0, 120),
        detail: String(args.detail || '').substring(0, 1000),
        followup_after_hours: Number(args.followup_after_hours) || 24,
      },
      contextSignalId: ctx.contextSignalId,
      contextIncidentId: ctx.contextIncidentId,
    });
    return result;
  },
};

const scheduleEntityRescan: ToolHandler = {
  name: 'schedule_entity_rescan',
  description:
    'Auto-tier action. Schedule a rescan of a monitored entity for fresh OSINT. Use when historical data on this entity is stale or you noticed signals indicating something has changed for them. Recorded in agent_actions ledger.',
  parameters: {
    type: 'object',
    properties: {
      entity_name: { type: 'string', description: 'Entity to rescan.' },
      reason: { type: 'string', description: 'Why a rescan is warranted.' },
    },
    required: ['entity_name', 'reason'],
  },
  async execute(args, ctx, supabase) {
    return await proposeAction(supabase, {
      agentCallSign: ctx.agentCallSign,
      actionType: 'schedule_entity_rescan',
      permissionTier: 'auto',
      rationale: String(args.reason || '').substring(0, 800),
      actionPayload: {
        entity_name: String(args.entity_name || ''),
        reason: String(args.reason || ''),
      },
      contextSignalId: ctx.contextSignalId,
      contextIncidentId: ctx.contextIncidentId,
    });
  },
};

// PROPOSE tier — analyst must approve before execution.
const proposeSeverityCorrection: ToolHandler = {
  name: 'propose_severity_correction',
  description:
    'PROPOSE-tier action (analyst approval required). Suggest the current signal severity is wrong. Use when you have evidence the existing severity is materially off. Lands in agent_actions awaiting_approval status; analyst reviews via dashboard.',
  parameters: {
    type: 'object',
    properties: {
      proposed_severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Severity you propose.' },
      evidence: { type: 'string', description: 'Specific evidence from your investigation that justifies this correction.' },
    },
    required: ['proposed_severity', 'evidence'],
  },
  async execute(args, ctx, supabase) {
    if (!ctx.contextSignalId) return { error: 'propose_severity_correction needs contextSignalId' };
    return await proposeAction(supabase, {
      agentCallSign: ctx.agentCallSign,
      actionType: 'propose_severity_correction',
      permissionTier: 'propose',
      rationale: String(args.evidence || '').substring(0, 800),
      actionPayload: {
        signal_id: ctx.contextSignalId,
        proposed_severity: String(args.proposed_severity || ''),
        evidence: String(args.evidence || ''),
      },
      contextSignalId: ctx.contextSignalId,
    });
  },
};

const notifyOncallViaSlack: ToolHandler = {
  name: 'notify_oncall_via_slack',
  description:
    'PROPOSE-tier action (analyst approval required). Propose paging oncall via Slack for a high-confidence threat. Use only when YOU and (ideally) a specialist consult agree the threat is acute. Lands in agent_actions awaiting_approval; analyst sees the proposed message and decides.',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Proposed message to oncall (under 500 chars).' },
      urgency: { type: 'string', enum: ['low', 'medium', 'high'], description: 'How urgent.' },
    },
    required: ['message', 'urgency'],
  },
  async execute(args, ctx, supabase) {
    return await proposeAction(supabase, {
      agentCallSign: ctx.agentCallSign,
      actionType: 'notify_oncall_via_slack',
      permissionTier: 'propose',
      rationale: 'Agent proposes paging oncall.',
      actionPayload: {
        message: String(args.message || '').substring(0, 500),
        urgency: String(args.urgency || 'medium'),
      },
      contextSignalId: ctx.contextSignalId,
      contextIncidentId: ctx.contextIncidentId,
    });
  },
};

// ── ArcGIS spatial intelligence tools ──────────────────────────────────────
// Available when the signal's client has an active client_arcgis_connections
// row. Tools return { available: false } gracefully when not configured —
// agents simply move on without spatial context.

const arcgisListLayers: ToolHandler = {
  name: 'arcgis_list_layers',
  description:
    "List the spatial layers available for this client's ArcGIS connection (e.g. pipeline_centerline, compressor_stations, operational_easement). Use this once before calling the proximity / query tools so you know what's queryable. Returns {available: false} if the client has no ArcGIS connection.",
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, ctx, supabase) {
    if (!ctx.contextClientId) return { available: false, reason: 'no client_id in context' };
    const arcgis = await getArcGISClient(supabase, ctx.contextClientId);
    if (!arcgis) return { available: false, reason: 'no active ArcGIS connection for this client' };
    const layers = arcgis.layers();
    if (layers.length === 0) return { available: true, layers: [], message: 'connection exists but no layer aliases configured yet' };
    return { available: true, count: layers.length, layers };
  },
};

const arcgisCheckSignalProximity: ToolHandler = {
  name: 'arcgis_check_signal_proximity',
  description:
    "Given a layer alias and the current signal's location (or an explicit lat/lon), find the client's assets within radius_km. Returns up to 10 nearest features with their attributes and geometry. Use this to answer 'is this signal close to any of OUR pipelines / facilities / sensitive zones?' — the answer becomes evidence the agent can cite. Returns {available: false} if not configured.",
  parameters: {
    type: 'object',
    properties: {
      layer_alias: { type: 'string', description: 'Friendly layer name from arcgis_list_layers, e.g. "pipeline_centerline".' },
      lat: { type: 'number', description: 'Latitude (WGS84). Defaults to the signal\'s location if not provided.' },
      lon: { type: 'number', description: 'Longitude (WGS84). Defaults to the signal\'s location if not provided.' },
      radius_km: { type: 'number', description: 'Search radius in km. Default 5.' },
    },
    required: ['layer_alias'],
  },
  async execute(args, ctx, supabase) {
    if (!ctx.contextClientId) return { available: false, reason: 'no client_id in context' };
    const arcgis = await getArcGISClient(supabase, ctx.contextClientId);
    if (!arcgis) return { available: false, reason: 'no active ArcGIS connection for this client' };

    let lat = Number(args.lat);
    let lon = Number(args.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      // Fall back to the signal's location text — best-effort. Real geo
      // resolution would need PostGIS or a geocoder; we skip if no coords
      // were passed.
      if (!ctx.contextSignalId) return { error: 'lat/lon required when signal has no resolvable coordinates' };
      const { data: sig } = await supabase
        .from('signals')
        .select('raw_json')
        .eq('id', ctx.contextSignalId)
        .maybeSingle();
      const rj = (sig?.raw_json as any) || {};
      lat = Number(rj.lat ?? rj.latitude);
      lon = Number(rj.lon ?? rj.longitude ?? rj.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return { error: 'no coordinates available — pass lat/lon explicitly' };
      }
    }

    const radiusKm = Math.max(0.1, Math.min(100, Number(args.radius_km) || 5));
    try {
      const features = await arcgis.findNear(String(args.layer_alias), lat, lon, radiusKm, ['*']);
      // Compress: just attributes (geometry is too verbose for the prompt)
      const compact = features.slice(0, 10).map((f) => ({
        attributes: f.attributes,
      }));
      return {
        layer: args.layer_alias,
        center: { lat, lon },
        radius_km: radiusKm,
        feature_count: features.length,
        features: compact,
      };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  },
};

const arcgisQueryLayer: ToolHandler = {
  name: 'arcgis_query_layer',
  description:
    "Run a free-form attribute query against a configured layer alias. Use when you want to find features by attribute, not location, e.g. 'all compressor stations marked offline' or 'all easements with status=ACTIVE'. The where_clause uses ArcGIS SQL-92 syntax. Returns up to 25 features.",
  parameters: {
    type: 'object',
    properties: {
      layer_alias: { type: 'string', description: 'Friendly layer name.' },
      where_clause: { type: 'string', description: "SQL-92 where, e.g. \"STATUS='ACTIVE' AND SEVERITY > 3\". Default: 1=1 (all features)." },
      out_fields: { type: 'array', items: { type: 'string' }, description: 'Attribute names to return. Default: all.' },
    },
    required: ['layer_alias'],
  },
  async execute(args, ctx, supabase) {
    if (!ctx.contextClientId) return { available: false, reason: 'no client_id in context' };
    const arcgis = await getArcGISClient(supabase, ctx.contextClientId);
    if (!arcgis) return { available: false, reason: 'no active ArcGIS connection' };
    try {
      const result = await arcgis.query(String(args.layer_alias), {
        where: String(args.where_clause || '1=1'),
        outFields: Array.isArray(args.out_fields) && args.out_fields.length > 0 ? args.out_fields as string[] : ['*'],
        returnGeometry: false,
        resultRecordCount: 25,
      });
      return {
        layer: args.layer_alias,
        where: args.where_clause || '1=1',
        feature_count: result.count,
        features: result.features.slice(0, 25).map((f) => ({ attributes: f.attributes })),
      };
    } catch (e: any) {
      return { error: e?.message || String(e) };
    }
  },
};

// ── Register all sixteen ───────────────────────────────────────────────────

registerTool(lookupHistoricalSignals);
registerTool(queryEntityRelationships);
registerTool(retrieveSimilarPastDecisions);
registerTool(emitPrediction);
registerTool(agentConsult);
registerTool(getSignalVelocity);
registerTool(detectEscalationPattern);
registerTool(getAnomalyScore);
registerTool(analyzeSignalImage);
registerTool(fileFollowupTask);
registerTool(scheduleEntityRescan);
registerTool(proposeSeverityCorrection);
registerTool(notifyOncallViaSlack);
// ── ArcGIS tools are NOT registered until a client_arcgis_connections row
// exists. We attempted Petronas integration but no API key was provisioned,
// so leaving these in the schema just burns prompt tokens (every chat /
// signal investigation gets the schema, model sometimes tries them, gets
// null-client errors back). Re-enable by uncommenting once any client has
// a connection row — code is unchanged, just unregistered.
// registerTool(arcgisListLayers);
// registerTool(arcgisCheckSignalProximity);
// registerTool(arcgisQueryLayer);

// ── Domain bundles ─────────────────────────────────────────────────────────
// Side-effect imports: each module calls registerTool() at load time.
// Adding a new bundle here makes its tools available to every agent /
// chat surface that imports agent-tools-core.ts (respond-as-agent,
// aegis-chat, …) on the next deploy.
import "./agent-tools-wildfire.ts";
