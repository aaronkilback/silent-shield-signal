import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
// #179 H-3 Entity governance — LLM document extractor; suggestion_queue only (origin=llm).
import {
  validateAndClassify as governanceValidateAndClassify,
  recordGovernanceEvent as governanceRecordEvent,
  type EntityCandidate,
} from "../_shared/entity-governance.ts";
import { assertCallerInTenant } from "../_shared/auth-tenant-guard.ts";

function parseJwtSub(req: Request): string | null {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub ?? null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();

    // #179 H-3 dry_run: deterministic governance routing without AI/persistence
    if (body.dry_run && Array.isArray(body.dry_run_candidates)) {
      const supabaseDR = createServiceClient();
      const startedAtMs = Date.now();
      const metrics = {
        candidate_count: 0,
        verdict_counts: { suggestion_queue: 0, auto_link: 0, auto_reject: 0, operator_promoted: 0 } as Record<string, number>,
        skip_count_no_tenant: 0,
        processing_duration_ms: 0,
      };
      const dryResults: any[] = [];
      for (const c of body.dry_run_candidates) {
        metrics.candidate_count += 1;
        if (!c.tenant_id) { metrics.skip_count_no_tenant += 1; dryResults.push({ name: c.name, skip: 'no_tenant' }); continue; }
        const cand: EntityCandidate = {
          name: c.name, type: c.type ?? 'organization', description: c.description ?? null,
          confidence: c.confidence ?? 0.75, origin: 'llm', context: c.context ?? null,
          sourceRef: { kind: 'document', id: c.source_id ?? crypto.randomUUID() },
        };
        const verdict = await governanceValidateAndClassify(supabaseDR, c.tenant_id, cand);
        metrics.verdict_counts[verdict.verdict] = (metrics.verdict_counts[verdict.verdict] ?? 0) + 1;
        dryResults.push({ name: c.name, tenant_id: c.tenant_id, verdict: verdict.verdict, rejection_reasons: verdict.rejectionReasons, matched_entity_id: verdict.matchedEntityId, effective_confidence: verdict.effectiveConfidence });
      }
      metrics.processing_duration_ms = Date.now() - startedAtMs;
      return new Response(JSON.stringify({ dry_run: true, metrics, results: dryResults }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    const { file, filename, mimeType, tenant_id } = body;

    if (!file || !filename) {
      return errorResponse('File and filename are required', 400);
    }
    if (!tenant_id) {
      return errorResponse('tenant_id is required (entity suggestions must be tenant-scoped)', 400);
    }

    // #179 H-3 trust boundary fix: caller must be tenant_users member of the asserted tenant.
    // Replaces the previous weak-trust assumption (body-asserted tenant_id accepted at face value).
    const callerSub = parseJwtSub(req);
    if (!callerSub) {
      return errorResponse('AUTH_REQUIRED: caller JWT could not be parsed', 401);
    }
    const supabaseAuth = createServiceClient();
    const authCheck = await assertCallerInTenant(supabaseAuth, callerSub, tenant_id, { allowSuperAdmin: true });
    if (!authCheck.ok) {
      return errorResponse(`TENANT_BOUNDARY: ${authCheck.reason}`, 403);
    }

    console.log('Processing entities document:', filename, mimeType);

    // Decode base64 file
    const binaryData = Uint8Array.from(atob(file), c => c.charCodeAt(0));
    let text = '';

    // Handle different file types
    if (mimeType === 'text/plain' || mimeType === 'text/csv' || mimeType === 'text/markdown' || filename.endsWith('.txt') || filename.endsWith('.csv') || filename.endsWith('.md')) {
      text = new TextDecoder().decode(binaryData);
    } else if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      const pdfText = new TextDecoder().decode(binaryData);
      text = pdfText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        return errorResponse('Unable to extract text from PDF', 400);
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
      const docxText = new TextDecoder().decode(binaryData);
      text = docxText.replace(/[^\x20-\x7E\n]/g, ' ').trim();
      
      if (!text || text.length < 50) {
        return errorResponse('Unable to extract text from DOCX', 400);
      }
    } else {
      return errorResponse('Unsupported file type. Please upload TXT, CSV, PDF, or DOCX files.', 400);
    }

    console.log('Extracted text length:', text.length);

    // Use AI to extract entities from the text via resilient gateway
    const aiResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are an expert at extracting entity information from text. Extract all relevant entities with their details.'
        },
        {
          role: 'user',
          content: `Extract all entities from the following text. Return a JSON array of entities with the structure:
{
  "entities": [
    {
      "name": "entity name",
      "type": "person|organization|location|infrastructure|domain|ip_address|email|phone|vehicle|other",
      "description": "description of the entity",
      "aliases": ["alias1", "alias2"],
      "risk_level": "low|medium|high|critical",
      "threat_score": 0-100,
      "threat_indicators": ["indicator1", "indicator2"],
      "associations": ["associated entity names"]
    }
  ]
}

Text to analyze:
${text}`
        }
      ],
      functionName: 'parse-entities-document',
      extraBody: {
        tools: [
          {
            type: "function",
            function: {
              name: "extract_entities",
              description: "Extract entities from text",
              parameters: {
                type: "object",
                properties: {
                  entities: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        type: { 
                          type: "string",
                          enum: ["person", "organization", "location", "infrastructure", "domain", "ip_address", "email", "phone", "vehicle", "other"]
                        },
                        description: { type: "string" },
                        aliases: { type: "array", items: { type: "string" } },
                        risk_level: { 
                          type: "string",
                          enum: ["low", "medium", "high", "critical"]
                        },
                        threat_score: { type: "integer", minimum: 0, maximum: 100 },
                        threat_indicators: { type: "array", items: { type: "string" } },
                        associations: { type: "array", items: { type: "string" } }
                      },
                      required: ["name", "type"]
                    }
                  }
                },
                required: ["entities"]
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "extract_entities" } }
      },
    });

    if (aiResult.error) {
      throw new Error(`AI API error: ${aiResult.error}`);
    }

    // Handle tool call response
    const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const extractedData = JSON.parse(toolCall.function.arguments);
    const entities = extractedData.entities || [];

    console.log(`Extracted ${entities.length} entities`);

    const supabase = createServiceClient();

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    // #134: verify caller is a member of the supplied tenant
    const { data: membership } = await supabase
      .from('tenant_users')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant_id)
      .limit(1);
    if (!Array.isArray(membership) || membership.length === 0) {
      return errorResponse('Forbidden: not a member of the supplied tenant', 403);
    }

    // Suggestions-first policy: store extracted entities as pending suggestions (not active entities)
    const uploadId = crypto.randomUUID();

    const normalizeEntityType = (t: string): 'person' | 'organization' | 'location' | 'infrastructure' | 'domain' | 'ip_address' => {
      switch ((t || '').toLowerCase()) {
        case 'person':
          return 'person';
        case 'organization':
          return 'organization';
        case 'location':
          return 'location';
        case 'infrastructure':
          return 'infrastructure';
        case 'domain':
          return 'domain';
        case 'ip_address':
          return 'ip_address';
        case 'email':
        case 'phone':
        case 'vehicle':
        case 'other':
        default:
          return 'infrastructure';
      }
    };

    const getContext = (fullText: string, needle: string) => {
      const idx = fullText.indexOf(needle);
      if (idx === -1) return null;
      const start = Math.max(0, idx - 120);
      const end = Math.min(fullText.length, idx + needle.length + 120);
      return fullText.substring(start, end);
    };

    const computeConfidence = (name: string, originalType: string) => {
      const base = (() => {
        switch ((originalType || '').toLowerCase()) {
          case 'email':
          case 'phone':
            return 0.9;
          case 'domain':
          case 'ip_address':
            return 0.85;
          case 'organization':
          case 'person':
          case 'location':
          case 'infrastructure':
            return 0.75;
          default:
            return 0.7;
        }
      })();

      const occurrences = (text.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      return Math.min(0.95, base + Math.min(0.2, occurrences * 0.05));
    };

    // #179 H-3 — Governance routing for each extracted entity.
    // Fail-fast tenant check already done at function entry (line ~70).
    // origin=llm; verdict path: auto_link / suggestion_queue / auto_reject. operator_promoted unreachable.
    const insertedSuggestions: any[] = [];
    const startedAtMs = Date.now();
    const metrics = {
      candidate_count: 0,
      verdict_counts: { suggestion_queue: 0, auto_link: 0, auto_reject: 0, operator_promoted: 0 } as Record<string, number>,
      skip_count_no_tenant: 0,
      persistence_errors: 0,
      processing_duration_ms: 0,
    };
    for (const entity of entities) {
      const originalType = entity.type || 'other';
      const suggestedType = normalizeEntityType(originalType);
      const confidence = computeConfidence(entity.name, originalType);
      metrics.candidate_count += 1;

      const candidate: EntityCandidate = {
        name: entity.name,
        type: suggestedType,
        description: entity.description || null,
        aliases: entity.aliases || null,
        confidence,
        origin: 'llm',
        context: getContext(text, entity.name),
        sourceRef: { kind: 'document', id: uploadId },
      };
      const verdict = await governanceValidateAndClassify(supabase, tenant_id, candidate);
      metrics.verdict_counts[verdict.verdict] = (metrics.verdict_counts[verdict.verdict] ?? 0) + 1;

      // auto_link / auto_reject — record event immediately, no insert
      if (verdict.verdict === 'auto_link') {
        governanceRecordEvent(supabase, { tenantId: tenant_id, sourceWriter: 'other', candidate, result: verdict });
        continue;
      }
      if (verdict.verdict === 'auto_reject') {
        governanceRecordEvent(supabase, { tenantId: tenant_id, sourceWriter: 'other', candidate, result: verdict });
        continue;
      }
      // suggestion_queue — insert THEN record event (per H-2 doctrine: no optimistic audit)
      const { data, error } = await supabase
        .from('entity_suggestions')
        .insert({
          tenant_id,
          suggested_name: verdict.normalizedName,
          suggested_type: verdict.resolvedType,
          suggested_aliases: entity.aliases || [],
          suggested_attributes: {
            original_type: originalType,
            description: entity.description || null,
            risk_level: entity.risk_level || null,
            threat_score: entity.threat_score ?? null,
            threat_indicators: entity.threat_indicators || [],
            associations: entity.associations || [],
            source: 'document_upload',
            filename,
            upload_id: uploadId,
          },
          source_type: 'document_upload',
          source_id: uploadId,
          confidence: verdict.effectiveConfidence,
          context: candidate.context,
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        metrics.persistence_errors += 1;
        governanceRecordEvent(supabase, { tenantId: tenant_id, sourceWriter: 'other', candidate, result: { ...verdict, verdict: 'auto_reject', rejectionReasons: ['persistence_error'] } });
        console.error('Error inserting entity suggestion:', entity.name, error);
      } else {
        insertedSuggestions.push(data);
        governanceRecordEvent(supabase, { tenantId: tenant_id, sourceWriter: 'other', candidate, result: verdict, suggestionId: data.id });
      }
    }
    metrics.processing_duration_ms = Date.now() - startedAtMs;
    console.log(`[#179 H-3 parse-entities-document metrics]`, JSON.stringify(metrics));

    console.log(`Successfully inserted ${insertedSuggestions.length} entity suggestions`);

    return successResponse({
      success: true,
      message: `Successfully created ${insertedSuggestions.length} entity suggestions`,
      suggestions: insertedSuggestions,
      uploadId,
    });
  } catch (error) {
    console.error('Error in parse-entities-document function:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
