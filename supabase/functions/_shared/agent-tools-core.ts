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
    'Retrieve up to 5 of YOUR (the calling agent\'s) most recent prior reasoning rows on signals similar in category or entity to the one you are now assessing. Use this to check for pattern consistency with your own past decisions.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', description: 'Signal category, e.g. "protest", "cyber", "wildfire".' },
      entity_hint: { type: 'string', description: 'Optional entity name to narrow further.' },
    },
    required: ['category'],
  },
  async execute(args, ctx, supabase) {
    const category = String(args.category || '').trim();
    const entityHint = String(args.entity_hint || '').trim();
    if (!category) return { error: 'category required' };
    // Pull this agent's recent analyses, joined with signal category/entity
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

// ── Register all five ──────────────────────────────────────────────────────

registerTool(lookupHistoricalSignals);
registerTool(queryEntityRelationships);
registerTool(retrieveSimilarPastDecisions);
registerTool(emitPrediction);
registerTool(agentConsult);
