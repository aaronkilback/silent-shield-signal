/**
 * extract-predicted-events
 *
 * Scans recent signals + content for references to upcoming events
 * (forums, rallies, conferences, presentations, hearings) and extracts
 * structured event records. Stored as entities with type='event' so they
 * inherit the entire correlation / narrative / dispatch pipeline.
 *
 * Why entities-as-events: when a signal later mentions an event by name,
 * the existing correlate-entities flow auto-fires entity-mention dispatch
 * (Phase 4E), and the same recurring-pattern narrative synth runs over
 * accumulated mentions. Events become first-class monitored objects.
 *
 * Conservative defaults:
 *   - Off by default — set env PREDICTED_EVENT_EXTRACTION=true to enable
 *   - Only scans signals from the last 7 days
 *   - Only signals with event-trigger keywords (cap on AI calls)
 *   - Top 30 candidate signals per run
 *   - Skips creation if a similar event entity already exists
 *
 * Cron: every 6h (extract-predicted-events-6h).
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGatewayJson } from "../_shared/ai-gateway.ts";
// #179 Entity governance — LLM cron extractor; can never reach operator_promoted (origin=llm).
// Direct entities.insert replaced with governance-routed suggestion creation.
import {
  validateAndClassify as governanceValidateAndClassify,
  recordGovernanceEvent as governanceRecordEvent,
} from "../_shared/entity-governance.ts";

const EVENT_TRIGGER_REGEX = /\b(forum|rally|protest|march|hearing|tribunal|workshop|conference|panel|presentation|town\s*hall|webinar|symposium|gathering|vigil|meeting|consultation|roundtable|summit|festival|memorial|launch)\b/i;
const SCAN_WINDOW_DAYS = 7;
const MAX_CANDIDATES = 30;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    if (Deno.env.get('PREDICTED_EVENT_EXTRACTION') !== 'true') {
      return successResponse({ skipped: true, reason: 'feature flag PREDICTED_EVENT_EXTRACTION is not "true"' });
    }

    const supabase = createServiceClient();
    const since = new Date(Date.now() - SCAN_WINDOW_DAYS * 86400000).toISOString();

    // ── 1. Pull candidate signals ─────────────────────────────────────────
    // Pre-filter SQL-side via ILIKE on a small set of keywords; then refine
    // with the regex. This keeps the AI call set small.
    const { data: candidates } = await supabase
      .from('signals')
      .select('id, title, normalized_text, client_id, source_url, created_at, category, severity')
      .gte('created_at', since)
      .neq('status', 'false_positive')
      .neq('status', 'archived')
      .or('title.ilike.%forum%,title.ilike.%rally%,title.ilike.%hearing%,title.ilike.%event%,title.ilike.%protest%,title.ilike.%conference%,title.ilike.%workshop%,title.ilike.%meeting%,normalized_text.ilike.%forum%,normalized_text.ilike.%rally%,normalized_text.ilike.%upcoming%,normalized_text.ilike.%scheduled%')
      .order('created_at', { ascending: false })
      .limit(150);

    const refined = (candidates ?? []).filter((s: any) => {
      const blob = `${s.title ?? ''} ${s.normalized_text ?? ''}`;
      return EVENT_TRIGGER_REGEX.test(blob);
    }).slice(0, MAX_CANDIDATES);

    if (refined.length === 0) {
      return successResponse({ scanned: candidates?.length ?? 0, refined: 0, events_created: 0 });
    }

    // ── 2. Extract structured events via AI ───────────────────────────────
    let eventsCreated = 0;
    let eventsLinked = 0;
    const skipped: string[] = [];

    for (const sig of refined) {
      const text = `Title: ${sig.title}\n\n${(sig.normalized_text ?? '').slice(0, 1500)}`;
      const aiPrompt = `Extract an upcoming event from this signal if one is described. ` +
        `Return strict JSON: {"is_event": true|false, "event_name": "...", "event_date_iso": "YYYY-MM-DD or null", ` +
        `"location": "...", "organizer": "...", "speakers": [], "confidence": 0.0-1.0}. ` +
        `Set is_event=false unless the signal describes a SPECIFIC, FUTURE-DATED event with at least an organizer or location. ` +
        `Skip past events, vague references ("an upcoming event"), and generic discussions about events in general.`;

      const { data: ai, error: aiErr } = await callAiGatewayJson({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You extract structured event data. Be conservative: prefer is_event=false over hallucinating dates/places.' },
          { role: 'user', content: `${aiPrompt}\n\nSIGNAL:\n${text}` },
        ],
        functionName: 'extract-predicted-events',
      });

      if (aiErr || !ai?.is_event) {
        skipped.push(`${sig.id}:${aiErr?.message || 'not_an_event'}`);
        continue;
      }

      const eventName = String(ai.event_name ?? '').slice(0, 200).trim();
      if (!eventName) {
        skipped.push(`${sig.id}:no_event_name`);
        continue;
      }

      // Dedup: an event with similar name already exists?
      const { data: existing } = await supabase
        .from('entities')
        .select('id, name, attributes')
        .eq('type', 'event')
        .ilike('name', `%${eventName.slice(0, 40).replace(/[%_]/g, ' ')}%`)
        .limit(1);

      const eventConfidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0.5));
      const attributes = {
        event_date_iso: typeof ai.event_date_iso === 'string' ? ai.event_date_iso : null,
        location: typeof ai.location === 'string' ? ai.location : null,
        organizer: typeof ai.organizer === 'string' ? ai.organizer : null,
        speakers: Array.isArray(ai.speakers) ? ai.speakers.slice(0, 8) : [],
        extraction_confidence: eventConfidence,
        extracted_from_signal_id: sig.id,
        extracted_at: new Date().toISOString(),
      };

      if (existing && existing.length > 0) {
        // Link the new signal as an additional source (entity_mentions) — the
        // Phase 4E entity-mention dispatch will fire on its own.
        const eventId = existing[0].id;
        await supabase.from('entity_mentions').insert({
          entity_id: eventId,
          signal_id: sig.id,
          confidence: eventConfidence,
          context: 'predicted_event_extraction',
        }).then(() => {}, (e: unknown) => console.warn('[events] mention insert failed', e));
        eventsLinked++;
      } else {
        // #179 — Autonomous LLM cron: route through governance. Cannot reach
        // operator_promoted (origin=llm). Best outcome: suggestion_queue.
        // Tenant resolution: signal.tenant_id (deterministic).
        let sigTenantId: string | null = null;
        if (sig.client_id) {
          const { data: clientRow } = await supabase.from('clients').select('tenant_id').eq('id', sig.client_id).maybeSingle();
          sigTenantId = clientRow?.tenant_id ?? null;
        }
        if (!sigTenantId) {
          // Try signal.tenant_id directly (post-#134 signals have this field)
          const { data: sigTenantRow } = await supabase.from('signals').select('tenant_id').eq('id', sig.id).maybeSingle();
          sigTenantId = sigTenantRow?.tenant_id ?? null;
        }
        if (!sigTenantId) {
          skipped.push(`${sig.id}:no_tenant_context_refused_per_doctrine`);
          continue;
        }

        const candidate = {
          name: eventName,
          type: 'event',
          description: typeof attributes?.summary === 'string' ? attributes.summary : null,
          confidence: eventConfidence,
          origin: 'llm' as const,
          context: sig.normalized_text?.substring(0, 500) ?? null,
          sourceRef: { kind: 'signal' as const, id: sig.id },
        };

        const verdict = await governanceValidateAndClassify(supabase, sigTenantId, candidate);

        if (verdict.verdict === 'auto_link' && verdict.matchedEntityId) {
          governanceRecordEvent(supabase, { tenantId: sigTenantId, sourceWriter: 'other', candidate, result: verdict });
          await supabase.from('entity_mentions').insert({
            entity_id: verdict.matchedEntityId, signal_id: sig.id, confidence: eventConfidence, context: 'predicted_event_extraction',
          }).then(() => {}, (e: unknown) => console.warn('[events] mention insert failed', e));
          eventsLinked++;
          continue;
        }
        if (verdict.verdict === 'auto_reject') {
          governanceRecordEvent(supabase, { tenantId: sigTenantId, sourceWriter: 'other', candidate, result: verdict });
          skipped.push(`${sig.id}:governance_rejected:${verdict.rejectionReasons.join(',')}`);
          continue;
        }
        // suggestion_queue — persist as entity_suggestion (event must be operator-promoted to become entity)
        const { data: newSuggestion, error: suggErr } = await supabase.from('entity_suggestions').insert({
          tenant_id: sigTenantId,
          suggested_name: verdict.normalizedName,
          suggested_type: verdict.resolvedType,
          suggested_attributes: attributes,
          source_type: 'signal',
          source_id: sig.id,
          confidence: verdict.effectiveConfidence,
          context: `Predicted event extraction from signal ${sig.id}`,
          status: 'pending',
        }).select('id').single();
        if (suggErr) {
          skipped.push(`${sig.id}:suggestion_insert_failed:${suggErr.message}`);
          governanceRecordEvent(supabase, { tenantId: sigTenantId, sourceWriter: 'other', candidate, result: { ...verdict, verdict: 'auto_reject', rejectionReasons: ['persistence_error'] } });
          continue;
        }
        governanceRecordEvent(supabase, { tenantId: sigTenantId, sourceWriter: 'other', candidate, result: verdict, suggestionId: newSuggestion.id });
        eventsCreated++;  // counter retained for compat; semantic: events queued
      }
    }

    return successResponse({
      scanned_total: candidates?.length ?? 0,
      refined_candidates: refined.length,
      events_created: eventsCreated,
      events_linked: eventsLinked,
      skipped_count: skipped.length,
      skipped_sample: skipped.slice(0, 10),
    });
  } catch (err) {
    console.error('[extract-predicted-events] error:', err);
    return errorResponse(err instanceof Error ? err.message : 'unknown', 500);
  }
});
