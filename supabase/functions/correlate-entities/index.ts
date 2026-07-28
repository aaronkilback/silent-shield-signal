import { createClient } from "npm:@supabase/supabase-js@2";
import { attenuateConfidence } from "../_shared/calibration.ts";
import {
  extractEntityNames,
  matchEntitiesInPage,
  type EntityRow,
} from "../_shared/entity-correlation.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CorrelationRequest {
  text: string;
  sourceType: 'signal' | 'archival_document' | 'investigation' | 'source';
  sourceId: string;
  autoApprove?: boolean;
}

interface EntityMatch {
  entityId: string;
  entityName: string;
  confidence: number;
  matchedOn: string[];
}

// Normalise curly/smart quotes to straight apostrophes.
// Entity names use typographic apostrophes (Gidimt'en) while signal text
// often uses plain ASCII. Normalise both before matching.
function normaliseQuotes(s: string): string {
  return s
    .replace(/\u2018|\u2019|\u201a|\u201b|\u2032|\u2035/g, "'")
    .replace(/\u201c|\u201d|\u201e|\u201f|\u2033|\u2036/g, '"');
}

Deno.serve(async (req) => {
  // EMERGENCY CONTAINMENT KILL-SWITCH — set CORRELATE_ENTITIES_DISABLED=true
  // (Supabase secret) to disable instantly with NO code deploy. Absent/false = unchanged.
  if (req.method !== "OPTIONS" && Deno.env.get("CORRELATE_ENTITIES_DISABLED") === "true") {
    return new Response(JSON.stringify({ disabled: true, message: "This function is temporarily disabled for containment." }), { status: 503, headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, sourceType, sourceId }: CorrelationRequest = await req.json();
    const autoApprove = false;

    if (!text || !sourceType || !sourceId) {
      return new Response(
        JSON.stringify({ error: 'text, sourceType, and sourceId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Correlating entities for ${sourceType}:${sourceId}`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // #134: resolve tenant_id from the source record. Entity suggestions
    // created here must carry tenant_id or analysts will not see them.
    //   signals             → direct tenant_id column
    //   archival_documents  → chain via client_id → clients.tenant_id
    //   investigations      → chain via client_id → clients.tenant_id
    let sourceTenantId: string | null = null;
    if (sourceType === 'signal') {
      const { data: sigRow } = await supabase
        .from('signals')
        .select('tenant_id')
        .eq('id', sourceId)
        .maybeSingle();
      sourceTenantId = sigRow?.tenant_id ?? null;
    } else if (sourceType === 'archival_document' || sourceType === 'investigation') {
      const table = sourceType === 'archival_document' ? 'archival_documents' : 'investigations';
      const { data: srcRow } = await supabase
        .from(table)
        .select('client_id')
        .eq('id', sourceId)
        .maybeSingle();
      if (srcRow?.client_id) {
        const { data: clientRow } = await supabase
          .from('clients')
          .select('tenant_id')
          .eq('id', srcRow.client_id)
          .maybeSingle();
        sourceTenantId = clientRow?.tenant_id ?? null;
      }
    }
    if (!sourceTenantId) {
      console.warn(`[#134] correlate-entities: could not resolve tenant_id for ${sourceType}:${sourceId} — suggestions will be skipped`);
    }

    // Normalise quotes AND lowercase the text ONCE, up front. The matcher reuses
    // this single lowercased copy for every entity instead of re-lowercasing the
    // full (possibly multi-MB) document per comparison — the allocation that
    // OOM'd the isolate (HTTP 546) even after entity streaming.
    const textLower = normaliseQuotes(text).toLowerCase();

    // Patterns reused by the suggestion pass below. (Name extraction itself now
    // lives in extractEntityNames; these three are still needed to type the
    // remaining unmatched names into suggestions.)
    const emailPattern = /\b([a-zA-Z0-9._-]{3,}@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g;
    const phonePattern = /\b(\+?1?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g;
    const domainPattern = /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/gi;

    const extractedNames = extractEntityNames(text);
    console.log(`Extracted ${extractedNames.size} potential entity names`);

    // Stream active entities one page at a time and match per page, discarding
    // each page before fetching the next. Bounds peak memory to one page
    // (~1000 rows) instead of the whole entity table, which OOM'd small compute
    // on large documents (HTTP 546, INC-JOBWORKER-SATURATION-2026-07-27 item 3).
    // Match output is identical to loading all entities at once — proven by
    // _shared/entity-correlation_test.ts. `attributes` is no longer selected
    // (the matcher never used it), further reducing per-row memory.
    const matches: EntityMatch[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      const { data: page, error: pageError } = await supabase
        .from('entities')
        .select('id, name, aliases, type')
        .eq('is_active', true)
        .range(offset, offset + pageSize - 1);
      if (pageError) throw pageError;
      if (!page || page.length === 0) break;
      matches.push(...matchEntitiesInPage(textLower, extractedNames, page as EntityRow[]));
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    // Remaining extracted names -> entity suggestions
    const remainingNames = Array.from(extractedNames).slice(0, 5);
    const MIN_AUTO_CREATE_CONFIDENCE = 0.8;
    const suggestions = [];

    for (const name of remainingNames) {
      let suggestedType = 'other';
      let confidence = 0.7;
      if (emailPattern.test(name)) { suggestedType = 'email'; confidence = 0.9; }
      else if (phonePattern.test(name)) { suggestedType = 'phone'; confidence = 0.9; }
      else if (domainPattern.test(name) && !name.includes('@')) { suggestedType = 'domain'; confidence = 0.85; }
      else if (/\b(?:Inc|Corp|LLC|Ltd|Company|Corporation|Group|Systems|Solutions)\b/i.test(name)) {
        suggestedType = 'organization'; confidence = 0.85;
      } else if (/^[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}/.test(name)) {
        suggestedType = 'person';
        const occurrences = (text.match(new RegExp(name, 'g')) || []).length;
        confidence = Math.min(0.7 + (occurrences * 0.1), 0.95);
      }
      const nameIndex = text.indexOf(name);
      const ctx = text.substring(Math.max(0, nameIndex - 100), Math.min(text.length, nameIndex + name.length + 100));

      if (autoApprove && confidence >= MIN_AUTO_CREATE_CONFIDENCE) {
        const { data: newEntity, error: createError } = await supabase
          .from('entities')
          .insert({ name, type: suggestedType, is_active: true,
            description: `Auto-created from ${sourceType} (confidence: ${confidence.toFixed(2)})` })
          .select().single();
        if (!createError && newEntity) {
          matches.push({ entityId: newEntity.id, entityName: newEntity.name, confidence, matchedOn: [name] });
        }
      } else if (sourceTenantId) {
        const { data: suggestion, error: suggestionError } = await supabase
          .from('entity_suggestions')
          .insert({ tenant_id: sourceTenantId, suggested_name: name, suggested_type: suggestedType, source_type: sourceType,
            source_id: sourceId, confidence, context: ctx, status: 'pending' })
          .select().single();
        if (!suggestionError && suggestion) suggestions.push(suggestion);
      }
      // else: tenant_id couldn't be resolved → suggestion skipped (warning logged above)
    }

    // Write correlated entity IDs back to source record
    const entityIds = matches.map(m => m.entityId);
    console.log(`[Phase4B] Total matches found: ${matches.length} — ${matches.map(m => m.entityName).join(', ')}`);

    if (entityIds.length > 0) {
      const tableMap: Record<string, { table: string; col: string }> = {
        signal: { table: 'signals', col: 'auto_correlated_entities' },
        archival_document: { table: 'archival_documents', col: 'correlated_entity_ids' },
        investigation: { table: 'investigations', col: 'correlated_entity_ids' },
      };
      const dest = tableMap[sourceType];
      if (dest) {
        await supabase.from(dest.table).update({ [dest.col]: entityIds }).eq('id', sourceId);
        console.log(`Updated ${sourceType} with ${entityIds.length} correlated entities`);
      }

      // Dedup: check existing mentions before inserting to handle double-fire
      const { data: existingMentions } = await supabase
        .from('entity_mentions')
        .select('entity_id')
        .eq('signal_id', sourceId);

      const alreadyMentioned = new Set((existingMentions || []).map((row: any) => row.entity_id));

      const mentions = matches
        .filter(match => !alreadyMentioned.has(match.entityId))
        .map(match => ({
          entity_id: match.entityId,
          signal_id: sourceType === 'signal' ? sourceId : null,
          confidence: match.confidence,
          context: match.matchedOn.join(', '),
        }));

      if (mentions.length > 0) {
        const { error: mentionError } = await supabase.from('entity_mentions').insert(mentions);
        if (mentionError) {
          console.error('[Phase4B] entity_mentions INSERT failed:', JSON.stringify(mentionError));
          console.error('[Phase4B] Failed payload:', JSON.stringify(mentions));
        } else {
          console.log(`[Phase4B] Inserted ${mentions.length} entity mentions (${matches.length - mentions.length} deduped)`);
        }
      }

      // ───────────────────────────────────────────────────────────────────────
      // PHASE 4D: RELATIONSHIP GRAPH TRAVERSAL
      // For each matched entity, traverse its relationships to find related
      // entities. If any related entity has recent signal activity, that is
      // corroboration — the signal is more likely real and significant.
      // Corroboration boosts the signal's composite_confidence score.
      // ───────────────────────────────────────────────────────────────────────
      if (sourceType === 'signal' && entityIds.length > 0) {
        try {
          // Step 1: fetch relationships for matched entities (one hop, strength >= 0.5)
          const { data: relationships } = await supabase
            .from('entity_relationships')
            .select('entity_a_id, entity_b_id, relationship_type, strength')
            .or(`entity_a_id.in.(${entityIds.join(',')}),entity_b_id.in.(${entityIds.join(',')})`)
            .gte('strength', 0.5);

          if (relationships && relationships.length > 0) {
            // Step 2: collect all entity IDs needed for name lookup
            const allIds = new Set<string>();
            for (const rel of relationships) {
              allIds.add(rel.entity_a_id);
              allIds.add(rel.entity_b_id);
            }
            const { data: nameRows } = await supabase
              .from('entities')
              .select('id, name')
              .in('id', Array.from(allIds));
            const nameMap: Record<string, string> = {};
            for (const e of (nameRows || [])) nameMap[e.id] = e.name;

            // Step 3: build related entity map (one hop away, not already matched)
            const relatedEntityIds = new Set<string>();
            const relatedEntityNames: Record<string, string> = {};
            const traversedRelationships: Array<{ from: string; type: string; to: string; strength: number }> = [];

            for (const rel of relationships) {
              const aId = rel.entity_a_id;
              const bId = rel.entity_b_id;
              const matchedId = entityIds.includes(aId) ? aId : bId;
              const relatedId = entityIds.includes(aId) ? bId : aId;
              const matchedName = nameMap[matchedId] || matchedId;
              const relatedName = nameMap[relatedId] || relatedId;

              if (!entityIds.includes(relatedId)) {
                relatedEntityIds.add(relatedId);
                relatedEntityNames[relatedId] = relatedName;
                traversedRelationships.push({
                  from: matchedName,
                  type: rel.relationship_type,
                  to: relatedName,
                  strength: rel.strength,
                });
              }
            }

            // Step 4: check for recent mentions of related entities (72h window)
            if (relatedEntityIds.size > 0) {
              const seventyTwoHoursAgo = new Date(Date.now() - 72 * 3600000).toISOString();
              const { data: recentRelatedMentions } = await supabase
                .from('entity_mentions')
                .select('entity_id, signal_id')
                .in('entity_id', Array.from(relatedEntityIds))
                .gte('created_at', seventyTwoHoursAgo)
                .neq('signal_id', sourceId);

              if (recentRelatedMentions && recentRelatedMentions.length > 0) {
                // Corroboration detected — related entities have recent activity
                const corroboratingEntityIds = [...new Set(recentRelatedMentions.map((m: any) => m.entity_id))];
                const corroboratingNames = corroboratingEntityIds.map(id => relatedEntityNames[id]).filter(Boolean);
                const boost = Math.min(corroboratingEntityIds.length * 0.05, 0.15);

                console.log(`[Phase4D] Corroboration: ${corroboratingNames.join(', ')} have recent activity. Boost: +${boost.toFixed(3)}`);

                // Step 5: boost composite_confidence and write graph context to raw_json.
                //
                // #121 Phase 1 (2026-05-21) — also promote matched_entities into
                // signals.entity_tags. Phase 4D was already computing tenant-scoped
                // entity matches but writing them ONLY to raw_json. AEGIS recon
                // (`fortress-recon.ts`) reads signals.entity_tags for retrieval,
                // so leaving the column empty meant recon retrieved diluted context
                // even when matches existed. The fix: resolve matched_entities UUIDs
                // to names tenant-scoped, merge with any existing tags, dedupe, and
                // write to entity_tags in the same UPDATE.
                //
                // Tenant scoping is non-negotiable here — resolving a UUID without
                // a tenant filter could leak a cross-tenant entity name onto a
                // signal that doesn't own it. The .eq('tenant_id', sig.tenant_id)
                // filter is the invariant.
                const { data: sig } = await supabase
                  .from('signals')
                  .select('composite_confidence, raw_json, entity_tags, tenant_id')
                  .eq('id', sourceId)
                  .maybeSingle();

                if (sig) {
                  const oldScore = sig.composite_confidence ?? null;
                  const newScore = oldScore !== null ? Math.min(0.98, oldScore + boost) : null;

                  // Resolve entityIds → names, tenant-scoped + soft-deleted-excluded.
                  // If a matched UUID isn't found under this tenant, it's silently
                  // dropped (defensive against stale matched_entities or cross-tenant
                  // UUIDs slipping through).
                  let mergedEntityTags: string[] = Array.isArray(sig.entity_tags) ? sig.entity_tags : [];
                  if (sig.tenant_id && entityIds.length > 0) {
                    const { data: matchedNameRows } = await supabase
                      .from('entities')
                      .select('name')
                      .in('id', entityIds)
                      .eq('tenant_id', sig.tenant_id)
                      .is('deleted_at', null);
                    const newTagNames = (matchedNameRows ?? [])
                      .map((e: any) => e?.name)
                      .filter((n: unknown): n is string => typeof n === 'string' && n.length > 0);
                    if (newTagNames.length > 0) {
                      mergedEntityTags = Array.from(new Set([...mergedEntityTags, ...newTagNames]));
                    }
                  }

                  await supabase.from('signals').update({
                    composite_confidence: newScore,
                    entity_tags: mergedEntityTags,
                    raw_json: {
                      ...(sig.raw_json || {}),
                      phase4d_traversal: {
                        matched_entities: entityIds,
                        traversed_relationships: traversedRelationships,
                        corroborating_entities: corroboratingNames,
                        corroboration_signal_count: recentRelatedMentions.length,
                        confidence_boost: boost,
                        traversal_window_hours: 72,
                        detected_at: new Date().toISOString(),
                      },
                    },
                  }).eq('id', sourceId);

                  console.log(`[Phase4D] ${sourceId} composite_confidence: ${oldScore?.toFixed(3) ?? 'null'} → ${newScore?.toFixed(3) ?? 'null'} | entity_tags: +${mergedEntityTags.length - (Array.isArray(sig.entity_tags) ? sig.entity_tags.length : 0)}`);
                }
              } else {
                console.log(`[Phase4D] No corroboration — related entities have no recent activity`);
              }
            }
          }
        } catch (err) {
          console.error('[Phase4D] Traversal failed (non-blocking):', err);
        }
      }
    }

    console.log(`Correlation complete: ${matches.length} matches, ${suggestions.length} suggestions`);

    // ───────────────────────────────────────────────────────────────────────
    // PHASE 4E: ENTITY-MENTION AGENT DISPATCH
    // For each matched entity that is actively monitored, dispatch a specialty
    // agent to write a signal_agent_analyses row tying the new signal to the
    // entity's prior history. This is what turns the entity graph from dead
    // weight (1,400+ unused entities) into active analysis.
    //
    // Conservative defaults:
    //   - Only fires for active_monitoring_enabled = true entities
    //   - Top 3 matches by confidence per signal (cost cap)
    //   - Skips if a row already exists for (signal_id, agent_call_sign, entity)
    //   - Fire-and-forget — ingest pipeline is unaffected by failures
    //   - Off by default (env ENTITY_MENTION_AUTO_DISPATCH=true to enable)
    // ───────────────────────────────────────────────────────────────────────
    if (sourceType === 'signal' && matches.length > 0 && Deno.env.get('ENTITY_MENTION_AUTO_DISPATCH') === 'true') {
      try {
        const topMatchIds = matches
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 3)
          .map(m => m.entityId);

        const { data: monitoredEntities } = await supabase
          .from('entities')
          .select('id, name, type, attributes, client_id')
          .in('id', topMatchIds)
          .eq('active_monitoring_enabled', true);

        if (monitoredEntities && monitoredEntities.length > 0) {
          // Map entity.type → primary specialty agent. Generic fallback AEGIS-CMD.
          const typeToAgent = (t: string): string => {
            const n = (t || '').toLowerCase();
            if (n === 'person') return 'MCGRAW';
            if (n === 'organization' || n === 'org') return 'CERBERUS';
            if (n === 'group' || n === 'movement') return 'ECHO-WATCH';
            if (n === 'location' || n === 'place') return 'LOCUS-INTEL';
            if (n === 'asset' || n === 'infrastructure') return 'CHAIN-WATCH';
            return 'AEGIS-CMD';
          };

          // Fetch the signal once (we'll feed its text to each dispatched agent)
          const { data: sig } = await supabase
            .from('signals')
            .select('id, title, normalized_text, severity, category, client_id')
            .eq('id', sourceId)
            .maybeSingle();

          if (sig) {
            for (const ent of monitoredEntities) {
              const callSign = typeToAgent(String(ent.type ?? ''));
              const triggerReason = `entity_mention:${ent.name}`;

              // Skip if already analyzed for this (signal, agent, entity) trio
              const { data: existing } = await supabase
                .from('signal_agent_analyses')
                .select('id')
                .eq('signal_id', sig.id)
                .eq('agent_call_sign', callSign)
                .eq('trigger_reason', triggerReason)
                .maybeSingle();
              if (existing) continue;

              // Look up the agent's id for agent-chat
              const { data: agentRow } = await supabase
                .from('ai_agents')
                .select('id')
                .eq('call_sign', callSign)
                .eq('is_active', true)
                .maybeSingle();
              if (!agentRow) {
                console.warn(`[Phase4E] Agent ${callSign} not found / not active — skipping ${ent.name}`);
                continue;
              }

              // Fire-and-forget agent dispatch + record write. We don't await
              // the response — ingest pipeline must not block.
              (async () => {
                try {
                  const userMsg =
                    `New signal mentions ${ent.name} (${ent.type}). ` +
                    `Title: ${sig.title}. ` +
                    `Severity: ${sig.severity}. Category: ${sig.category}. ` +
                    (sig.normalized_text ? `Content: ${String(sig.normalized_text).slice(0, 1500)} ` : '') +
                    `Drawing on what you know about ${ent.name} from prior investigations and your specialty, ` +
                    `is this a meaningful development? What should we be watching for next? ` +
                    `Be concise (≤180 words). Cite specific prior events if you recall them.`;

                  const resp = await supabase.functions.invoke('agent-chat', {
                    body: {
                      agentId: agentRow.id,
                      messages: [{ role: 'user', content: userMsg }],
                      clientId: sig.client_id ?? ent.client_id ?? null,
                      stream: false,
                    },
                  });

                  const content: string | null = (resp?.data as any)?.response ?? null;
                  if (!content) return;

                  // Stated confidence is the legacy flat 0.7 — kept for
                  // continuity but pulled toward 0.5 by the agent's own
                  // calibration history before persisting. Agents that
                  // have been chronically over-confident on this domain
                  // (per agent_calibration_scores) write a lower number;
                  // well-calibrated agents pass through unchanged.
                  const { attenuated } = await attenuateConfidence(
                    supabase,
                    callSign,
                    String(sig.category ?? 'unknown'),
                    0.7,
                  );

                  await supabase.from('signal_agent_analyses').insert({
                    signal_id: sig.id,
                    agent_call_sign: callSign,
                    analysis: content.slice(0, 6000),
                    confidence_score: attenuated,
                    trigger_reason: triggerReason,
                    analysis_tier: 'entity_mention',
                  });
                } catch (dispatchErr) {
                  console.warn(`[Phase4E] dispatch ${callSign}/${ent.name} failed:`, dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr));
                }
              })();
            }
            console.log(`[Phase4E] Fired ${monitoredEntities.length} entity-mention dispatches for signal ${sig.id}`);
          }
        }
      } catch (phase4eErr) {
        console.error('[Phase4E] non-blocking failure:', phase4eErr instanceof Error ? phase4eErr.message : String(phase4eErr));
      }
    }

    return new Response(
      JSON.stringify({ success: true, matches, suggestions, totalMatches: matches.length, pendingSuggestions: suggestions.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in correlate-entities:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
