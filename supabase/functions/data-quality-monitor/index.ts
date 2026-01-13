import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Data Quality Monitor for Fortress
 * 
 * Monitors and reports on data quality issues across the system:
 * - Incidents missing titles/summaries
 * - Entities with generic descriptions
 * - Signals lacking key extracted information
 * - Orphaned records and data consistency issues
 */

interface DataQualityIssue {
  category: 'incident' | 'entity' | 'signal' | 'relationship';
  severity: 'critical' | 'high' | 'medium' | 'low';
  issue_type: string;
  count: number;
  sample_ids: string[];
  description: string;
  auto_fixable: boolean;
  fix_action?: string;
}

const GENERIC_DESCRIPTIONS = [
  'no description available',
  'no description',
  'description not available',
  'unknown',
  'n/a',
  'none',
  'tbd',
  'to be determined',
  'pending',
  ''
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { auto_fix = false, categories = ['incident', 'entity', 'signal'] } = await req.json().catch(() => ({}));

    console.log(`[data-quality-monitor] Running check. Auto-fix: ${auto_fix}, Categories: ${categories.join(', ')}`);

    const issues: DataQualityIssue[] = [];
    const fixResults: any[] = [];

    // 1. Check incidents missing titles
    if (categories.includes('incident')) {
      const { data: incidentsMissingTitle } = await supabase
        .from('incidents')
        .select('id, title, priority, status')
        .or('title.is.null,title.eq.')
        .order('opened_at', { ascending: false })
        .limit(100);

      if (incidentsMissingTitle && incidentsMissingTitle.length > 0) {
        issues.push({
          category: 'incident',
          severity: 'high',
          issue_type: 'missing_title',
          count: incidentsMissingTitle.length,
          sample_ids: incidentsMissingTitle.slice(0, 5).map(i => i.id),
          description: 'Incidents without titles reduce visibility and make triage difficult',
          auto_fixable: true,
          fix_action: 'auto-summarize-incident'
        });

        if (auto_fix) {
          const { data: fixResult } = await supabase.functions.invoke('auto-summarize-incident', {
            body: { batch_mode: true, limit: 20 }
          });
          fixResults.push({ issue_type: 'missing_title', result: fixResult });
        }
      }

      // Check incidents missing summaries
      const { data: incidentsMissingSummary } = await supabase
        .from('incidents')
        .select('id, summary, priority, status')
        .or('summary.is.null,summary.eq.')
        .not('title', 'is', null)
        .order('opened_at', { ascending: false })
        .limit(100);

      if (incidentsMissingSummary && incidentsMissingSummary.length > 0) {
        issues.push({
          category: 'incident',
          severity: 'medium',
          issue_type: 'missing_summary',
          count: incidentsMissingSummary.length,
          sample_ids: incidentsMissingSummary.slice(0, 5).map(i => i.id),
          description: 'Incidents without summaries require analysts to dig through signals for context',
          auto_fixable: true,
          fix_action: 'auto-summarize-incident'
        });
      }

      // Check high-priority incidents without linked signals
      const { data: orphanedIncidents } = await supabase
        .from('incidents')
        .select(`
          id, priority, status,
          incident_signals(signal_id)
        `)
        .in('priority', ['p1', 'p2'])
        .eq('status', 'open');

      const orphaned = (orphanedIncidents || []).filter(i => 
        !i.incident_signals || i.incident_signals.length === 0
      );

      if (orphaned.length > 0) {
        issues.push({
          category: 'incident',
          severity: 'high',
          issue_type: 'high_priority_no_signals',
          count: orphaned.length,
          sample_ids: orphaned.slice(0, 5).map(i => i.id),
          description: 'High-priority incidents without linked signals lack evidentiary basis',
          auto_fixable: false
        });
      }
    }

    // 2. Check entities with generic descriptions
    if (categories.includes('entity')) {
      const { data: allEntities } = await supabase
        .from('entities')
        .select('id, name, description, type, risk_level')
        .limit(500);

      const genericEntities = (allEntities || []).filter(e => {
        const desc = (e.description || '').toLowerCase().trim();
        return GENERIC_DESCRIPTIONS.some(g => desc === g.toLowerCase()) || desc.length < 10;
      });

      if (genericEntities.length > 0) {
        issues.push({
          category: 'entity',
          severity: 'medium',
          issue_type: 'generic_description',
          count: genericEntities.length,
          sample_ids: genericEntities.slice(0, 5).map(e => e.id),
          description: 'Entities with generic descriptions provide insufficient context for threat analysis',
          auto_fixable: true,
          fix_action: 'enrich-entity'
        });

        if (auto_fix) {
          // Trigger enrichment for entities with generic descriptions
          for (const entity of genericEntities.slice(0, 10)) {
            try {
              const { data: enrichResult } = await supabase.functions.invoke('enrich-entity', {
                body: { entityName: entity.name, context: `Entity type: ${entity.type}` }
              });
              
              if (enrichResult?.success && enrichResult?.data) {
                await supabase
                  .from('entities')
                  .update({
                    description: enrichResult.data.description,
                    risk_level: enrichResult.data.risk_level,
                    threat_score: enrichResult.data.threat_score,
                    threat_indicators: enrichResult.data.threat_indicators,
                    aliases: enrichResult.data.aliases,
                    updated_at: new Date().toISOString()
                  })
                  .eq('id', entity.id);

                fixResults.push({ entity_id: entity.id, enriched: true });
              }
            } catch (err) {
              console.error(`Failed to enrich entity ${entity.id}:`, err);
            }
          }
        }
      }

      // Check entities without any linked signals or documents
      const { data: entitiesWithMentions } = await supabase
        .from('entity_mentions')
        .select('entity_id')
        .limit(1000);

      const mentionedEntityIds = new Set((entitiesWithMentions || []).map(m => m.entity_id));
      const unlinkedEntities = (allEntities || []).filter(e => !mentionedEntityIds.has(e.id));

      if (unlinkedEntities.length > 10) {
        issues.push({
          category: 'entity',
          severity: 'low',
          issue_type: 'no_signal_links',
          count: unlinkedEntities.length,
          sample_ids: unlinkedEntities.slice(0, 5).map(e => e.id),
          description: 'Entities not linked to any signals may be stale or manually created without context',
          auto_fixable: false
        });
      }
    }

    // 3. Check signals lacking key information
    if (categories.includes('signal')) {
      const { data: signalsMissingExtraction } = await supabase
        .from('signals')
        .select('id, normalized_text, entity_tags, location, category')
        .or('entity_tags.is.null,location.is.null,category.is.null,category.eq.unknown')
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(100);

      const signalsWithMissingInfo = (signalsMissingExtraction || []).filter(s => {
        const hasEntities = s.entity_tags && Array.isArray(s.entity_tags) && s.entity_tags.length > 0;
        const hasLocation = s.location && s.location.trim() !== '';
        const hasCategory = s.category && s.category !== 'unknown';
        return !hasEntities || !hasLocation || !hasCategory;
      });

      if (signalsWithMissingInfo.length > 0) {
        issues.push({
          category: 'signal',
          severity: 'medium',
          issue_type: 'missing_extracted_info',
          count: signalsWithMissingInfo.length,
          sample_ids: signalsWithMissingInfo.slice(0, 5).map(s => s.id),
          description: 'Signals missing extracted entities, locations, or categories reduce analytical value',
          auto_fixable: true,
          fix_action: 'extract-signal-insights'
        });

        if (auto_fix) {
          // Re-process signals to extract missing information
          for (const signal of signalsWithMissingInfo.slice(0, 10)) {
            try {
              const { data: extractResult } = await supabase.functions.invoke('extract-signal-insights', {
                body: { signal_id: signal.id }
              });
              fixResults.push({ signal_id: signal.id, result: extractResult });
            } catch (err) {
              console.error(`Failed to extract insights for signal ${signal.id}:`, err);
            }
          }
        }
      }

      // Check for signals with very short normalized text (likely extraction failure)
      const { data: shortTextSignals } = await supabase
        .from('signals')
        .select('id, normalized_text')
        .not('normalized_text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);

      const tooShort = (shortTextSignals || []).filter(s => 
        (s.normalized_text || '').length < 50
      );

      if (tooShort.length > 10) {
        issues.push({
          category: 'signal',
          severity: 'low',
          issue_type: 'short_normalized_text',
          count: tooShort.length,
          sample_ids: tooShort.slice(0, 5).map(s => s.id),
          description: 'Signals with very short normalized text may indicate extraction failures',
          auto_fixable: false
        });
      }
    }

    // Calculate overall data quality score
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const highCount = issues.filter(i => i.severity === 'high').length;
    const mediumCount = issues.filter(i => i.severity === 'medium').length;
    const lowCount = issues.filter(i => i.severity === 'low').length;

    const qualityScore = Math.max(0, 100 - (criticalCount * 20 + highCount * 10 + mediumCount * 5 + lowCount * 2));

    const response = {
      success: true,
      timestamp: new Date().toISOString(),
      data_quality_score: qualityScore,
      summary: {
        total_issues: issues.length,
        critical: criticalCount,
        high: highCount,
        medium: mediumCount,
        low: lowCount,
        auto_fixable: issues.filter(i => i.auto_fixable).length
      },
      issues,
      fix_results: auto_fix ? fixResults : undefined,
      recommendations: [
        criticalCount > 0 && 'Address critical data quality issues immediately',
        highCount > 0 && 'Review and fix high-priority data gaps',
        issues.some(i => i.auto_fixable) && 'Run with auto_fix=true to automatically resolve fixable issues',
        qualityScore < 70 && 'Schedule regular data quality audits',
      ].filter(Boolean)
    };

    console.log(`[data-quality-monitor] Score: ${qualityScore}, Issues: ${issues.length}`);

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[data-quality-monitor] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
