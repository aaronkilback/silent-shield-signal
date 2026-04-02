import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const body = await req.json().catch(() => ({}));
    const clientId = body.client_id || null;

    console.log(`[learn-from-investigations] Starting pattern extraction...`);

    // 1. Fetch completed investigations
    const query = supabase
      .from('investigations')
      .select(`id, file_number, synopsis, information, recommendations, file_status, created_at, updated_at, client_id, correlated_entity_ids, cross_references, incident_id`)
      .in('file_status', ['closed', 'under_review'])
      .not('synopsis', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (clientId) query.eq('client_id', clientId);

    const { data: investigations, error: invError } = await query;

    if (invError) throw invError;
    if (!investigations?.length) {
      return successResponse({ message: 'No completed investigations found', patterns_extracted: 0 });
    }

    console.log(`[learn-from-investigations] Found ${investigations.length} completed investigations`);

    // 2. Fetch entries
    const invIds = investigations.map(i => i.id);
    const { data: allEntries } = await supabase
      .from('investigation_entries')
      .select('investigation_id, entry_text, is_ai_generated, ai_suggestion_accepted, created_at')
      .in('investigation_id', invIds)
      .order('created_at', { ascending: true });

    const entriesByInv = new Map<string, any[]>();
    for (const entry of (allEntries || [])) {
      const list = entriesByInv.get(entry.investigation_id) || [];
      list.push(entry);
      entriesByInv.set(entry.investigation_id, list);
    }

    // 3. Entity types
    const allEntityIds = investigations.flatMap(i => i.correlated_entity_ids || []).filter(Boolean);
    const entityTypeMap = new Map<string, string>();
    if (allEntityIds.length > 0) {
      const { data: entities } = await supabase.from('entities').select('id, type').in('id', allEntityIds.slice(0, 200));
      for (const e of (entities || [])) entityTypeMap.set(e.id, e.type);
    }

    // 4. Build summaries
    const investigationSummaries = investigations.map(inv => {
      const entries = entriesByInv.get(inv.id) || [];
      const entityTypes = (inv.correlated_entity_ids || []).map((id: string) => entityTypeMap.get(id)).filter(Boolean);
      const daysOpen = inv.updated_at && inv.created_at
        ? Math.round((new Date(inv.updated_at).getTime() - new Date(inv.created_at).getTime()) / 86400000)
        : null;
      const aiEntries = entries.filter(e => e.is_ai_generated);
      const acceptedAi = aiEntries.filter(e => e.ai_suggestion_accepted === true).length;
      const rejectedAi = aiEntries.filter(e => e.ai_suggestion_accepted === false).length;

      return {
        file_number: inv.file_number, has_incident: !!inv.incident_id,
        synopsis_length: inv.synopsis?.length || 0, synopsis_preview: inv.synopsis?.substring(0, 300) || '',
        information_length: inv.information?.length || 0, recommendations: inv.recommendations?.substring(0, 200) || '',
        entry_count: entries.length, entity_types: [...new Set(entityTypes)], days_open: daysOpen,
        ai_entries: aiEntries.length, ai_accepted: acceptedAi, ai_rejected: rejectedAi,
        has_cross_refs: (inv.cross_references || []).length > 0,
      };
    });

    const extractionPrompt = `Analyze these ${investigationSummaries.length} completed security investigations and extract reusable patterns.

INVESTIGATION DATA:
${JSON.stringify(investigationSummaries, null, 2)}

Extract and return a JSON object with:
1. "templates": Array of investigation templates (max 5)
2. "entry_patterns": Array of common entry writing patterns (max 10)
3. "workflow_insights": Object with avg_synopsis_length, most_common_entity_types, ai_acceptance_rate, workflow_bottlenecks

Return ONLY valid JSON, no markdown.`;

    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert at pattern recognition in security investigation workflows. Extract actionable, reusable patterns. Return ONLY valid JSON.' },
        { role: 'user', content: extractionPrompt }
      ],
      functionName: 'learn-from-investigations',
      dlqOnFailure: true,
      dlqPayload: { client_id: clientId, investigation_count: investigations.length },
    });

    if (aiResult.error) {
      throw new Error(aiResult.error);
    }

    let rawContent = (aiResult.content || '').trim();
    rawContent = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    let patterns: any;
    try {
      patterns = JSON.parse(rawContent);
    } catch {
      console.error('[learn-from-investigations] Failed to parse AI response:', rawContent.substring(0, 500));
      throw new Error('Failed to parse AI pattern extraction');
    }

    console.log(`[learn-from-investigations] Extracted ${patterns.templates?.length || 0} templates, ${patterns.entry_patterns?.length || 0} entry patterns`);

    // 5. Store templates
    let templatesStored = 0;
    for (const template of (patterns.templates || [])) {
      const { error: tmplError } = await supabase
        .from('investigation_templates')
        .upsert({
          template_name: template.template_name, category: template.category || 'general',
          description: template.description, typical_synopsis_structure: template.typical_synopsis_structure,
          typical_recommendations: template.typical_recommendations || [],
          common_entity_types: template.common_entity_types || [],
          common_entry_patterns: (patterns.entry_patterns || []).map((p: any) => p.pattern_template).slice(0, 10),
          avg_entry_count: template.avg_entry_count || null, avg_days_to_close: template.avg_days_to_close || null,
          derived_from_count: investigations.length, derived_from_ids: invIds.slice(0, 20),
          client_id: clientId, confidence_score: Math.min(investigations.length / 10, 1.0),
        }, { onConflict: 'template_name', ignoreDuplicates: false });

      if (tmplError) {
        await supabase.from('investigation_templates').insert({
          template_name: template.template_name, category: template.category || 'general',
          description: template.description, typical_synopsis_structure: template.typical_synopsis_structure,
          typical_recommendations: template.typical_recommendations || [],
          common_entity_types: template.common_entity_types || [],
          common_entry_patterns: (patterns.entry_patterns || []).map((p: any) => p.pattern_template).slice(0, 10),
          avg_entry_count: template.avg_entry_count || null, avg_days_to_close: template.avg_days_to_close || null,
          derived_from_count: investigations.length, derived_from_ids: invIds.slice(0, 20),
          client_id: clientId, confidence_score: Math.min(investigations.length / 10, 1.0),
        });
      }
      templatesStored++;
    }

    // 6. Store workflow insights
    const workflowInsights = patterns.workflow_insights || {};
    await supabase.from('learning_profiles').upsert({
      profile_type: 'investigation_workflow_patterns',
      features: { ...workflowInsights, entry_patterns: patterns.entry_patterns || [], templates_count: templatesStored, source_investigation_count: investigations.length, last_extraction: new Date().toISOString() },
      sample_count: investigations.length, last_updated: new Date().toISOString(),
    }, { onConflict: 'profile_type' });

    // 7. Keyword index
    const keywordIndex: Record<string, string[]> = {};
    for (const inv of investigations) {
      const text = `${inv.synopsis || ''} ${inv.information || ''}`.toLowerCase();
      const words = text.split(/\s+/).filter(w => w.length > 4);
      keywordIndex[inv.id] = [...new Set(words)].slice(0, 50);
    }

    await supabase.from('learning_profiles').upsert({
      profile_type: 'investigation_keyword_index',
      features: { index: keywordIndex, investigation_count: investigations.length, last_indexed: new Date().toISOString() },
      sample_count: Object.keys(keywordIndex).length, last_updated: new Date().toISOString(),
    }, { onConflict: 'profile_type' });

    // 8. Learning session
    await supabase.from('agent_learning_sessions').insert({
      session_type: 'investigation_pattern_extraction',
      learnings: { templates_extracted: templatesStored, entry_patterns: (patterns.entry_patterns || []).length, workflow_insights: workflowInsights, source_count: investigations.length },
      source_count: investigations.length, quality_score: Math.min(investigations.length / 5, 1.0),
    });

    console.log(`[learn-from-investigations] Complete. ${templatesStored} templates stored.`);

    return successResponse({
      templates_stored: templatesStored,
      entry_patterns: (patterns.entry_patterns || []).length,
      workflow_insights: workflowInsights,
      investigations_analyzed: investigations.length,
    });
  } catch (error) {
    console.error('[learn-from-investigations] Error:', error);
    await logError(error, { functionName: 'learn-from-investigations', severity: 'error' });
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});