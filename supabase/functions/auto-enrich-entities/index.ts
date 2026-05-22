import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";
// #179 H-2 Entity governance — origin=llm (autonomous cron); cannot reach operator_promoted.
// Note: enrichment proposals target existing entities (matched_entity_id always set);
// validator returns auto_link on name match — we still persist the suggestion because
// the row encodes proposed changes, not a new entity.
import {
  validateAndClassify as governanceValidateAndClassify,
  recordGovernanceEvent as governanceRecordEvent,
  type EntityCandidate,
} from "../_shared/entity-governance.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Auto-enrich entities with generic descriptions
 */

const GENERIC_PATTERNS = [
  /^no description/i,
  /^description not available/i,
  /^unknown/i,
  /^n\/a$/i,
  /^none$/i,
  /^tbd$/i,
  /^to be determined/i,
  /^pending/i,
  /^-$/,
  /^\.$/,
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      entity_id,
      batch_mode = false,
      auto_apply = false,
      limit = 10,
      min_confidence = 0.7,
      // #179 H-2 dry_run mode: skip AI call + persistence, exercise governance on injected candidates
      dry_run = false,
      dry_run_candidates = [] as Array<{ entity_id: string; mock_enrichment: any }>,
    } = await req.json();

    console.log(`[auto-enrich-entities] Mode: ${batch_mode ? 'batch' : 'single'}, Auto-apply: ${auto_apply}, dry_run: ${dry_run}`);

    // #179 H-2 observability counters
    const startedAtMs = Date.now();
    const metrics = {
      candidate_count: 0,
      verdict_counts: { suggestion_queue: 0, auto_link: 0, auto_reject: 0, operator_promoted: 0 },
      skip_count_no_tenant: 0,
      persistence_errors: 0,
      processing_duration_ms: 0,
    };

    // #179 H-2 dry_run: skip AI + persistence; exercise governance routing only.
    if (dry_run) {
      const dryResults: any[] = [];
      for (const c of dry_run_candidates) {
        metrics.candidate_count += 1;
        const { data: ent } = await supabase
          .from('entities')
          .select('id, name, type, tenant_id')
          .eq('id', c.entity_id)
          .maybeSingle();
        if (!ent) { dryResults.push({ entity_id: c.entity_id, error: 'entity_not_found' }); continue; }
        // Fail-fast tenant check BEFORE governance call (per #179 H-2 doctrine refinement)
        if (!ent.tenant_id) {
          metrics.skip_count_no_tenant += 1;
          dryResults.push({ entity_id: ent.id, name: ent.name, skip: 'no_tenant' });
          continue;
        }
        const candidate: EntityCandidate = {
          name: c.mock_enrichment?.name ?? ent.name,
          type: c.mock_enrichment?.type ?? ent.type,
          description: c.mock_enrichment?.description ?? null,
          confidence: c.mock_enrichment?.confidence ?? 0.75,
          origin: 'llm',
          context: c.mock_enrichment?.context ?? null,
          sourceRef: { kind: 'investigation', id: ent.id },
        };
        const verdict = await governanceValidateAndClassify(supabase, ent.tenant_id, candidate);
        metrics.verdict_counts[verdict.verdict] = (metrics.verdict_counts[verdict.verdict] ?? 0) + 1;
        dryResults.push({
          entity_id: ent.id,
          tenant_id: ent.tenant_id,
          verdict: verdict.verdict,
          rejection_reasons: verdict.rejectionReasons,
          warnings: verdict.warnings,
          matched_entity_id: verdict.matchedEntityId,
          effective_confidence: verdict.effectiveConfidence,
        });
      }
      metrics.processing_duration_ms = Date.now() - startedAtMs;
      return new Response(JSON.stringify({ dry_run: true, metrics, results: dryResults }, null, 2), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
      });
    }

    let entitiesToProcess: any[] = [];

    if (batch_mode) {
      const { data: allEntities } = await supabase
        .from('entities')
        .select('id, name, type, description, risk_level, aliases, threat_indicators, client_id, tenant_id')
        .order('updated_at', { ascending: true })
        .limit(200);

      entitiesToProcess = (allEntities || []).filter(e => {
        const desc = (e.description || '').trim();
        if (desc === '' || desc.length < 15) return true;
        return GENERIC_PATTERNS.some(pattern => pattern.test(desc));
      }).slice(0, limit);

      console.log(`Found ${entitiesToProcess.length} entities needing enrichment`);
    } else if (entity_id) {
      const { data: entity } = await supabase
        .from('entities')
        .select('id, name, type, description, risk_level, aliases, threat_indicators, client_id, tenant_id')
        .eq('id', entity_id)
        .single();

      if (entity) {
        entitiesToProcess = [entity];
      }
    } else {
      return new Response(
        JSON.stringify({ error: 'Provide entity_id or batch_mode' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: any[] = [];

    for (const entity of entitiesToProcess) {
      try {
        // Gather internal context about this entity
        let internalContext = '';

        const { data: mentions } = await supabase
          .from('entity_mentions')
          .select(`context, signal:signals(normalized_text, category, severity)`)
          .eq('entity_id', entity.id)
          .order('created_at', { ascending: false })
          .limit(5);

        if (mentions && mentions.length > 0) {
          internalContext = 'Known from signals:\n' + mentions.map(m => 
            `- ${m.context || ''} (${(m.signal as any)?.category || 'Unknown category'})`
          ).join('\n');
        }

        const { data: docMentions } = await supabase
          .from('document_entity_mentions')
          .select(`mention_text, document:ingested_documents(title)`)
          .eq('entity_id', entity.id)
          .limit(5);

        if (docMentions && docMentions.length > 0) {
          internalContext += '\n\nMentioned in documents:\n' + docMentions.map(d =>
            `- ${(d.document as any)?.title || 'Untitled'}: "${d.mention_text || ''}"`
          ).join('\n');
        }

        const aiResult = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a corporate security intelligence analyst. Enrich entity profiles with relevant, actionable information.

Based on the entity name, type, and any available context, provide:
1. A comprehensive description (2-4 sentences focusing on security relevance)
2. Known aliases or alternate names
3. Threat indicators if applicable
4. Risk assessment with justification
5. Associations with other entities/groups

Be factual and specific. If you cannot determine information with confidence, indicate uncertainty.`
            },
            {
              role: 'user',
              content: `Enrich this entity profile:

Name: ${entity.name}
Type: ${entity.type}
Current Description: ${entity.description || 'None'}
Known Aliases: ${(entity.aliases || []).join(', ') || 'None'}

${internalContext ? `Internal Intelligence:\n${internalContext}` : 'No internal intelligence available'}`
            }
          ],
          functionName: 'auto-enrich-entities',
          dlqOnFailure: true,
          dlqPayload: { entity_id: entity.id, entity_name: entity.name },
          extraBody: {
            tools: [
              {
                type: "function",
                function: {
                  name: "enrich_entity_profile",
                  description: "Provide enriched entity profile information",
                  parameters: {
                    type: "object",
                    properties: {
                      description: { type: "string", description: "Comprehensive 2-4 sentence description" },
                      aliases: { type: "array", items: { type: "string" }, description: "Known alternate names" },
                      threat_indicators: { type: "array", items: { type: "string" }, description: "Security threat indicators" },
                      risk_level: { type: "string", enum: ["critical", "high", "medium", "low", "unknown"], description: "Assessed risk level" },
                      risk_justification: { type: "string", description: "Explanation for risk assessment" },
                      associations: { type: "array", items: { type: "string" }, description: "Related entities or groups" },
                      confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence in the enrichment accuracy" },
                      needs_human_review: { type: "boolean", description: "True if information is uncertain and needs verification" }
                    },
                    required: ["description", "confidence"],
                    additionalProperties: false
                  }
                }
              }
            ],
            tool_choice: { type: "function", function: { name: "enrich_entity_profile" } }
          },
        });

        const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];

        if (!toolCall) {
          throw new Error('No tool call in AI response');
        }

        const enrichment = JSON.parse(toolCall.function.arguments);

        const shouldApply = auto_apply && 
          enrichment.confidence >= min_confidence && 
          !enrichment.needs_human_review;

        if (shouldApply) {
          const updatePayload: any = {
            description: enrichment.description,
            risk_level: enrichment.risk_level || entity.risk_level,
            updated_at: new Date().toISOString()
          };

          if (enrichment.aliases && enrichment.aliases.length > 0) {
            const existingAliases = entity.aliases || [];
            updatePayload.aliases = [...new Set([...existingAliases, ...enrichment.aliases])];
          }

          if (enrichment.threat_indicators && enrichment.threat_indicators.length > 0) {
            const existingIndicators = entity.threat_indicators || [];
            updatePayload.threat_indicators = [...new Set([...existingIndicators, ...enrichment.threat_indicators])];
          }

          await supabase.from('entities').update(updatePayload).eq('id', entity.id);

          results.push({
            entity_id: entity.id,
            entity_name: entity.name,
            success: true,
            applied: true,
            enrichment: {
              description: enrichment.description,
              risk_level: enrichment.risk_level,
              aliases_added: enrichment.aliases?.length || 0,
              confidence: enrichment.confidence
            }
          });

          console.log(`[auto-enrich-entities] Applied enrichment to ${entity.name}`);

        } else {
          // #179 H-2 — Governance routing for enrichment proposal.
          // Fail-fast tenant check BEFORE governance call (per H-2 refinement).
          metrics.candidate_count += 1;
          if (!entity.tenant_id) {
            metrics.skip_count_no_tenant += 1;
            console.warn(`[#179 H-2] skip enrichment for entity ${entity.id} — no tenant context per doctrine`);
          } else {
            const candidate: EntityCandidate = {
              name: entity.name,
              type: entity.type,
              description: enrichment.description ?? null,
              confidence: enrichment.confidence,
              origin: 'llm',
              context: `Auto-enrichment proposal: ${enrichment.needs_human_review ? 'Needs verification' : 'High confidence'}`,
              sourceRef: { kind: 'investigation', id: entity.id },
            };
            const verdict = await governanceValidateAndClassify(supabase, entity.tenant_id, candidate);
            metrics.verdict_counts[verdict.verdict] = (metrics.verdict_counts[verdict.verdict] ?? 0) + 1;
            // Enrichment semantics: validator will typically return auto_link (the entity exists).
            // We still persist the suggestion row because it carries the proposed changes —
            // this is an enrichment-of-existing pattern, distinct from new-entity proposals.
            // auto_reject (e.g., entity name became invalid by ontology) skips persistence + records event.
            if (verdict.verdict === 'auto_reject') {
              governanceRecordEvent(supabase, { tenantId: entity.tenant_id, sourceWriter: 'other', candidate, result: verdict });
              console.warn(`[#179 H-2] enrichment rejected for ${entity.id}: ${verdict.rejectionReasons.join(',')}`);
            } else {
              const { data: newSugg, error: sErr } = await supabase
                .from('entity_suggestions')
                .insert({
                  tenant_id: entity.tenant_id,
                  source_type: 'auto_enrichment',
                  source_id: crypto.randomUUID(),
                  suggested_name: verdict.normalizedName,
                  suggested_type: verdict.resolvedType,
                  matched_entity_id: entity.id,
                  suggested_attributes: {
                    proposed_description: enrichment.description,
                    proposed_risk_level: enrichment.risk_level,
                    proposed_aliases: enrichment.aliases,
                    proposed_threat_indicators: enrichment.threat_indicators,
                    risk_justification: enrichment.risk_justification,
                    associations: enrichment.associations,
                  },
                  confidence: verdict.effectiveConfidence,
                  context: candidate.context,
                  status: 'pending',
                })
                .select('id')
                .single();
              if (sErr) {
                metrics.persistence_errors += 1;
                governanceRecordEvent(supabase, { tenantId: entity.tenant_id, sourceWriter: 'other', candidate, result: { ...verdict, verdict: 'auto_reject', rejectionReasons: ['persistence_error'] } });
                console.error(`[#179 H-2] enrichment persistence failed for ${entity.id}:`, sErr.message);
              } else {
                governanceRecordEvent(supabase, {
                  tenantId: entity.tenant_id,
                  sourceWriter: 'other',
                  candidate,
                  result: verdict,
                  suggestionId: newSugg.id,
                  linkedEntityId: entity.id,
                });
              }
            }
          }

          results.push({
            entity_id: entity.id,
            entity_name: entity.name,
            success: true,
            applied: false,
            reason: enrichment.needs_human_review ? 'needs_human_review' : 'confidence_below_threshold',
            enrichment: {
              description_preview: enrichment.description.substring(0, 100) + '...',
              confidence: enrichment.confidence,
              needs_review: enrichment.needs_human_review
            }
          });

          console.log(`[auto-enrich-entities] Created suggestion for ${entity.name} (confidence: ${enrichment.confidence})`);
        }

      } catch (entityError) {
        console.error(`[auto-enrich-entities] Error processing ${entity.id}:`, entityError);
        results.push({
          entity_id: entity.id,
          entity_name: entity.name,
          success: false,
          error: entityError instanceof Error ? entityError.message : 'Unknown error'
        });
      }
    }

    metrics.processing_duration_ms = Date.now() - startedAtMs;
    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        applied: results.filter(r => r.applied).length,
        pending_review: results.filter(r => r.success && !r.applied).length,
        failed: results.filter(r => !r.success).length,
        results,
        metrics,  // #179 H-2 observability
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[auto-enrich-entities] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
