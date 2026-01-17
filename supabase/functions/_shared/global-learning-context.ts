/**
 * Global Learning Context - Provides cross-tenant learning context to AI agents
 * 
 * This module fetches anonymized, aggregated learnings that help agents
 * make better decisions based on patterns seen across all tenants.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface GlobalInsight {
  id: string;
  insight_type: string;
  category: string | null;
  insight_content: string;
  confidence_score: number;
  occurrence_count: number;
  source_tenant_count: number;
}

export interface CrossTenantPattern {
  id: string;
  pattern_type: string;
  pattern_description: string | null;
  affected_tenant_count: number;
  severity_trend: string | null;
  recommended_actions: any[];
}

export async function getGlobalLearningContext(
  supabase: SupabaseClient,
  options: {
    insightTypes?: string[];
    categories?: string[];
    minConfidence?: number;
    limit?: number;
  } = {}
): Promise<{
  insights: GlobalInsight[];
  patterns: CrossTenantPattern[];
  context: string;
}> {
  const {
    insightTypes,
    categories,
    minConfidence = 0.5,
    limit = 20
  } = options;

  // Fetch relevant global insights
  let insightsQuery = supabase
    .from('global_learning_insights')
    .select('id, insight_type, category, insight_content, confidence_score, occurrence_count, source_tenant_count')
    .eq('is_active', true)
    .gte('confidence_score', minConfidence)
    .order('confidence_score', { ascending: false })
    .limit(limit);

  if (insightTypes && insightTypes.length > 0) {
    insightsQuery = insightsQuery.in('insight_type', insightTypes);
  }

  if (categories && categories.length > 0) {
    insightsQuery = insightsQuery.in('category', categories);
  }

  const { data: insights, error: insightsError } = await insightsQuery;

  if (insightsError) {
    console.error('[global-learning-context] Error fetching insights:', insightsError);
  }

  // Fetch active cross-tenant patterns
  const { data: patterns, error: patternsError } = await supabase
    .from('cross_tenant_patterns')
    .select('id, pattern_type, pattern_description, affected_tenant_count, severity_trend, recommended_actions')
    .eq('is_active', true)
    .order('affected_tenant_count', { ascending: false })
    .limit(10);

  if (patternsError) {
    console.error('[global-learning-context] Error fetching patterns:', patternsError);
  }

  // Build context string for AI consumption
  const contextParts: string[] = [
    '=== GLOBAL LEARNING CONTEXT (Cross-Tenant Intelligence) ==='
  ];

  if (insights && insights.length > 0) {
    contextParts.push('\n📊 AGGREGATED INSIGHTS:');
    for (const insight of insights) {
      contextParts.push(`• [${insight.insight_type}] ${insight.insight_content} (confidence: ${(insight.confidence_score * 100).toFixed(0)}%, from ${insight.source_tenant_count} sources)`);
    }
  }

  if (patterns && patterns.length > 0) {
    contextParts.push('\n🔄 CROSS-TENANT PATTERNS:');
    for (const pattern of patterns) {
      const trend = pattern.severity_trend ? ` [${pattern.severity_trend}]` : '';
      contextParts.push(`• [${pattern.pattern_type}]${trend}: ${pattern.pattern_description || 'No description'}`);
      if (pattern.recommended_actions && pattern.recommended_actions.length > 0) {
        contextParts.push(`  → Recommended: ${JSON.stringify(pattern.recommended_actions)}`);
      }
    }
  }

  if ((!insights || insights.length === 0) && (!patterns || patterns.length === 0)) {
    contextParts.push('\nNo global learning context available yet. System is still learning from interactions.');
  }

  return {
    insights: insights || [],
    patterns: patterns || [],
    context: contextParts.join('\n')
  };
}

export async function recordLearningFeedback(
  supabase: SupabaseClient,
  insightId: string,
  userId: string | null,
  agentId: string | null,
  tenantId: string | null,
  feedbackType: 'helpful' | 'not_helpful' | 'incorrect' | 'outdated',
  feedbackText?: string,
  context?: Record<string, any>
): Promise<boolean> {
  const { error } = await supabase
    .from('learning_feedback')
    .insert({
      insight_id: insightId,
      user_id: userId,
      agent_id: agentId,
      tenant_id: tenantId,
      feedback_type: feedbackType,
      feedback_text: feedbackText,
      context: context || {}
    });

  if (error) {
    console.error('[global-learning-context] Error recording feedback:', error);
    return false;
  }

  return true;
}

export async function promoteToGlobalInsight(
  supabase: SupabaseClient,
  insightType: string,
  category: string,
  content: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  // Check for existing similar insight
  const { data: existing } = await supabase
    .from('global_learning_insights')
    .select('id, occurrence_count')
    .eq('insight_type', insightType)
    .ilike('insight_content', `%${content.substring(0, 50)}%`)
    .single();

  if (existing) {
    // Increment occurrence count
    await supabase
      .from('global_learning_insights')
      .update({
        occurrence_count: existing.occurrence_count + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', existing.id);
    return true;
  }

  // Create new insight
  const { error } = await supabase
    .from('global_learning_insights')
    .insert({
      insight_type: insightType,
      category,
      insight_content: content,
      confidence_score: 0.5, // Start with moderate confidence
      occurrence_count: 1,
      source_tenant_count: 1,
      metadata: metadata || {}
    });

  if (error) {
    console.error('[global-learning-context] Error promoting insight:', error);
    return false;
  }

  return true;
}
