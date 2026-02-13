import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LearningPattern {
  type: string;
  content: string;
  category?: string;
  occurrences: number;
  tenantCount: number;
  confidence: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[aggregate-global-learnings] Starting cross-tenant learning aggregation...');

    // 1. Aggregate signal patterns across tenants (anonymized)
    const { data: signalPatterns, error: signalError } = await supabase
      .from('signals')
      .select('category, severity, raw_json')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1000);

    if (signalError) {
      console.error('[aggregate-global-learnings] Error fetching signals:', signalError);
    }

    // 2. Aggregate incident patterns
    const { data: incidentPatterns, error: incidentError } = await supabase
      .from('incidents')
      .select('category, severity_level, priority, status, ai_analysis_log')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(500);

    if (incidentError) {
      console.error('[aggregate-global-learnings] Error fetching incidents:', incidentError);
    }

    // 3. Aggregate entity patterns
    const { data: entityPatterns, error: entityError } = await supabase
      .from('entities')
      .select('entity_type, risk_level, status')
      .eq('status', 'active')
      .limit(500);

    if (entityError) {
      console.error('[aggregate-global-learnings] Error fetching entities:', entityError);
    }

    // 4. Get feedback on existing insights to adjust confidence
    const { data: feedback, error: feedbackError } = await supabase
      .from('learning_feedback')
      .select('insight_id, feedback_type')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (feedbackError) {
      console.error('[aggregate-global-learnings] Error fetching feedback:', feedbackError);
    }

    // 5. Get conversation memories for query patterns
    const { data: memories, error: memoryError } = await supabase
      .from('conversation_memory')
      .select('memory_type, content, context_tags')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(500);

    if (memoryError) {
      console.error('[aggregate-global-learnings] Error fetching memories:', memoryError);
    }

    // Aggregate patterns
    const patterns: LearningPattern[] = [];

    // Signal category patterns
    if (signalPatterns && signalPatterns.length > 0) {
      const categoryCount: Record<string, { count: number; tenants: Set<string> }> = {};
      
      for (const signal of signalPatterns) {
        const category = signal.category || 'uncategorized';
        if (!categoryCount[category]) {
          categoryCount[category] = { count: 0, tenants: new Set() };
        }
        categoryCount[category].count++;
        // Track unique tenant patterns (anonymized by just counting)
        if (signal.raw_json?.tenant_id) {
          categoryCount[category].tenants.add(signal.raw_json.tenant_id);
        }
      }

      for (const [category, data] of Object.entries(categoryCount)) {
        if (data.count >= 5) { // Only patterns with significant occurrence
          patterns.push({
            type: 'signal_category_trend',
            content: `Signal category "${category}" showing ${data.count} occurrences in last 30 days`,
            category,
            occurrences: data.count,
            tenantCount: data.tenants.size || 1,
            confidence: Math.min(0.9, 0.5 + (data.count / 100))
          });
        }
      }
    }

    // Incident severity patterns
    if (incidentPatterns && incidentPatterns.length > 0) {
      const severityTrends: Record<string, number> = {};
      
      for (const incident of incidentPatterns) {
        const severity = incident.severity_level || 'unknown';
        severityTrends[severity] = (severityTrends[severity] || 0) + 1;
      }

      for (const [severity, count] of Object.entries(severityTrends)) {
        if (count >= 3) {
          patterns.push({
            type: 'incident_severity_trend',
            content: `${severity} severity incidents: ${count} in last 30 days`,
            category: 'incident_analysis',
            occurrences: count,
            tenantCount: 1, // Anonymized
            confidence: Math.min(0.85, 0.4 + (count / 50))
          });
        }
      }
    }

    // Entity type patterns
    if (entityPatterns && entityPatterns.length > 0) {
      const typeCount: Record<string, { count: number; highRisk: number }> = {};
      
      for (const entity of entityPatterns) {
        const type = entity.entity_type || 'unknown';
        if (!typeCount[type]) {
          typeCount[type] = { count: 0, highRisk: 0 };
        }
        typeCount[type].count++;
        if (entity.risk_level === 'high' || entity.risk_level === 'critical') {
          typeCount[type].highRisk++;
        }
      }

      for (const [type, data] of Object.entries(typeCount)) {
        if (data.count >= 5) {
          const riskRatio = data.highRisk / data.count;
          patterns.push({
            type: 'entity_risk_pattern',
            content: `Entity type "${type}": ${data.count} tracked, ${Math.round(riskRatio * 100)}% high-risk`,
            category: 'entity_monitoring',
            occurrences: data.count,
            tenantCount: 1,
            confidence: Math.min(0.8, 0.5 + riskRatio)
          });
        }
      }
    }

    // Use AI to generate meta-insights if available
    let aiInsights: string[] = [];
    if (lovableApiKey && patterns.length > 5) {
      try {
        const analysisPrompt = `Analyze these anonymized security patterns from multiple organizations and provide 3-5 actionable global insights:

${patterns.map(p => `- ${p.type}: ${p.content} (confidence: ${p.confidence.toFixed(2)})`).join('\n')}

Provide insights that would help ANY security team, without revealing specifics about individual organizations. Format as a JSON array of strings.`;

        const aiResult = await callAiGateway({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: 'You are a security intelligence analyst. Provide actionable, anonymized insights based on aggregate patterns. Return only a JSON array of insight strings.' },
            { role: 'user', content: analysisPrompt }
          ],
          functionName: 'aggregate-global-learnings',
          extraBody: { temperature: 0.3 },
        });

        if (aiResult.content) {
          try {
            const jsonMatch = aiResult.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              aiInsights = JSON.parse(jsonMatch[0]);
            }
          } catch {
            console.log('[aggregate-global-learnings] Could not parse AI insights as JSON');
          }
        }
      } catch (aiError) {
        console.error('[aggregate-global-learnings] AI analysis error:', aiError);
      }
    }

    // Store new insights
    const insertedInsights: any[] = [];

    for (const pattern of patterns) {
      // Check if similar insight already exists
      const { data: existing } = await supabase
        .from('global_learning_insights')
        .select('id, occurrence_count, source_tenant_count')
        .eq('insight_type', pattern.type)
        .ilike('insight_content', `%${pattern.category}%`)
        .single();

      if (existing) {
        // Update existing insight
        await supabase
          .from('global_learning_insights')
          .update({
            occurrence_count: existing.occurrence_count + pattern.occurrences,
            source_tenant_count: Math.max(existing.source_tenant_count, pattern.tenantCount),
            confidence_score: Math.min(0.95, pattern.confidence + 0.05),
            updated_at: new Date().toISOString(),
            last_validated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Insert new insight
        const { data: inserted, error: insertError } = await supabase
          .from('global_learning_insights')
          .insert({
            insight_type: pattern.type,
            category: pattern.category,
            insight_content: pattern.content,
            confidence_score: pattern.confidence,
            occurrence_count: pattern.occurrences,
            source_tenant_count: pattern.tenantCount,
            metadata: { generated_at: new Date().toISOString() },
            last_validated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (!insertError && inserted) {
          insertedInsights.push(inserted);
        }
      }
    }

    // Store AI-generated insights
    for (const insight of aiInsights) {
      if (typeof insight === 'string' && insight.length > 10) {
        await supabase
          .from('global_learning_insights')
          .insert({
            insight_type: 'ai_meta_insight',
            category: 'cross_tenant',
            insight_content: insight,
            confidence_score: 0.7,
            occurrence_count: 1,
            source_tenant_count: patterns.length,
            metadata: { ai_generated: true, generated_at: new Date().toISOString() }
          });
      }
    }

    // Update confidence based on feedback
    if (feedback && feedback.length > 0) {
      const feedbackByInsight: Record<string, { helpful: number; notHelpful: number }> = {};
      
      for (const fb of feedback) {
        if (!fb.insight_id) continue;
        if (!feedbackByInsight[fb.insight_id]) {
          feedbackByInsight[fb.insight_id] = { helpful: 0, notHelpful: 0 };
        }
        if (fb.feedback_type === 'helpful') {
          feedbackByInsight[fb.insight_id].helpful++;
        } else {
          feedbackByInsight[fb.insight_id].notHelpful++;
        }
      }

      for (const [insightId, counts] of Object.entries(feedbackByInsight)) {
        // Get current confidence and adjust
        const { data: currentInsight } = await supabase
          .from('global_learning_insights')
          .select('confidence_score')
          .eq('id', insightId)
          .single();
        
        if (currentInsight) {
          const adjustment = (counts.helpful - counts.notHelpful) * 0.05;
          const newConfidence = Math.max(0.1, Math.min(0.95, currentInsight.confidence_score + adjustment));
          await supabase
            .from('global_learning_insights')
            .update({
              confidence_score: newConfidence,
              updated_at: new Date().toISOString()
            })
            .eq('id', insightId);
        }
      }
    }

    // Record learning session
    await supabase
      .from('agent_learning_sessions')
      .insert({
        session_type: 'cross_tenant_aggregation',
        learnings: patterns.map(p => ({ type: p.type, content: p.content })),
        source_count: (signalPatterns?.length || 0) + (incidentPatterns?.length || 0) + (entityPatterns?.length || 0),
        quality_score: patterns.length > 0 ? 0.7 : 0.3,
        promoted_to_global: true
      });

    console.log(`[aggregate-global-learnings] Completed: ${patterns.length} patterns, ${aiInsights.length} AI insights`);

    return new Response(JSON.stringify({
      success: true,
      patterns_found: patterns.length,
      insights_created: insertedInsights.length,
      ai_insights: aiInsights.length,
      summary: {
        signals_analyzed: signalPatterns?.length || 0,
        incidents_analyzed: incidentPatterns?.length || 0,
        entities_analyzed: entityPatterns?.length || 0,
        memories_analyzed: memories?.length || 0
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[aggregate-global-learnings] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
