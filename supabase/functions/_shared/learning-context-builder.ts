/**
 * Learning Context Builder — Fetches learning profiles and formats them as
 * concise, structured context for injection into AI agent system prompts.
 * 
 * This bridges the adaptive intelligence system (feedback → learning_profiles)
 * with AI decision-making (system prompts for AEGIS, briefing generators, etc.).
 */

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface LearningSnapshot {
  /** Compact string for system prompt injection */
  promptContext: string;
  /** Structured data for programmatic use */
  data: {
    thresholds: { suppressBelow: number; lowConfBelow: number; feedbackRatio: number };
    topApprovedKeywords: string[];
    topRejectedKeywords: string[];
    driftAlert: boolean;
    driftSummary: string;
    sourceReliability: Array<{ source: string; score: number; total: number }>;
    qualityScores: Record<string, number>;
    activeLearningQueueSize: number;
    corrections: string[];
    seasonalWarnings: string[];
  };
  fetchedAt: string;
}

// Cache to avoid hammering DB on rapid requests (5-min TTL)
let _cache: { snapshot: LearningSnapshot; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getLearningSnapshot(
  supabase: SupabaseClient,
  options: { bypassCache?: boolean; maxTokenBudget?: 'compact' | 'standard' | 'full' } = {}
): Promise<LearningSnapshot> {
  const { bypassCache = false, maxTokenBudget = 'standard' } = options;

  if (!bypassCache && _cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.snapshot;
  }

  // Fetch all relevant learning profiles in one query
  const { data: profiles } = await supabase
    .from('learning_profiles')
    .select('profile_type, features, sample_count, last_updated')
    .in('profile_type', [
      'approved_signal_patterns',
      'rejected_signal_patterns',
      'adaptive_thresholds',
      'drift_baseline',
      'active_learning_queue',
      'seasonal_patterns',
      'quality:daily_briefing',
      'quality:report',
      'quality:travel_alert',
      'quality:audio_briefing',
      'quality:incident',
      'quality:signal',
      'briefing_quality',
      // Implicit behavioral learning
      'implicit_engaged_patterns',
      'implicit_dismissed_patterns',
      'implicit_behavioral_metrics',
    ]);

  // Fetch top source reliability scores
  const { data: sources } = await supabase
    .from('source_reliability_metrics')
    .select('source_name, reliability_score, total_signals')
    .order('total_signals', { ascending: false })
    .limit(10);

  // Parse profiles into structured map
  const profileMap = new Map<string, any>();
  for (const p of (profiles || [])) {
    profileMap.set(p.profile_type, p.features);
  }

  const thresholds = profileMap.get('adaptive_thresholds') || {};
  const drift = profileMap.get('drift_baseline') || {};
  const queue = profileMap.get('active_learning_queue') || {};

  // Extract top keywords from approved/rejected patterns
  const extractTopKeys = (features: Record<string, number> | null, n: number): string[] => {
    if (!features) return [];
    return Object.entries(features)
      .filter(([k]) => !k.startsWith('reason:') && k.length > 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);
  };

  const approvedFeatures = profileMap.get('approved_signal_patterns') || {};
  const rejectedFeatures = profileMap.get('rejected_signal_patterns') || {};
  const implicitEngaged = profileMap.get('implicit_engaged_patterns') || {};
  const implicitDismissed = profileMap.get('implicit_dismissed_patterns') || {};
  const implicitMetrics = profileMap.get('implicit_behavioral_metrics') || {};

  // Merge explicit + implicit signals (implicit weighted at 0.5x)
  const mergedApproved: Record<string, number> = { ...approvedFeatures };
  for (const [k, v] of Object.entries(implicitEngaged)) {
    mergedApproved[k] = (mergedApproved[k] || 0) + Math.round((v as number) * 0.5);
  }
  const mergedRejected: Record<string, number> = { ...rejectedFeatures };
  for (const [k, v] of Object.entries(implicitDismissed)) {
    mergedRejected[k] = (mergedRejected[k] || 0) + Math.round((v as number) * 0.5);
  }

  const topApproved = extractTopKeys(mergedApproved, maxTokenBudget === 'compact' ? 10 : 20);
  const topRejected = extractTopKeys(mergedRejected, maxTokenBudget === 'compact' ? 10 : 20);

  // Quality scores for different output types
  const qualityScores: Record<string, number> = {};
  for (const [key, features] of profileMap.entries()) {
    if (key.startsWith('quality:')) {
      const type = key.replace('quality:', '');
      qualityScores[type] = features?.satisfaction_rate ?? 0.5;
    }
  }
  // Also check briefing_quality profile
  const briefingQuality = profileMap.get('briefing_quality');
  if (briefingQuality) {
    const pos = (briefingQuality.feedback_positive || 0) + (briefingQuality.feedback_relevant || 0);
    const neg = (briefingQuality.feedback_negative || 0) + (briefingQuality.feedback_irrelevant || 0);
    const total = pos + neg;
    if (total > 0) qualityScores['briefing'] = Math.round((pos / total) * 100) / 100;
  }

  // Corrections from quality profiles
  const corrections: string[] = [];
  for (const [key, features] of profileMap.entries()) {
    if (key.startsWith('quality:') && features?.recent_corrections) {
      corrections.push(...features.recent_corrections.slice(0, 3));
    }
  }

  // Source reliability
  const sourceReliability = (sources || []).map(s => ({
    source: s.source_name,
    score: s.reliability_score,
    total: s.total_signals,
  }));

  // Seasonal warnings
  const seasonalWarnings: string[] = [];
  const seasonal = profileMap.get('seasonal_patterns');
  if (seasonal?.monthly_spikes) {
    const currentMonth = new Date().getMonth() + 1;
    for (const [cat, months] of Object.entries(seasonal.monthly_spikes as Record<string, Record<number, number>>)) {
      const spike = months[currentMonth];
      if (spike && spike > 1.5) {
        seasonalWarnings.push(`${cat} typically ${Math.round(spike * 100 - 100)}% above average this month`);
      }
    }
  }

  // Drift summary
  const driftAlert = drift?.drift_alert === true;
  let driftSummary = 'Threat landscape stable.';
  if (driftAlert) {
    const newCats = drift.new_categories || [];
    driftSummary = `⚠️ Distribution shift detected (${Math.round((drift.max_drift || 0) * 100)}% drift).`;
    if (newCats.length > 0) driftSummary += ` Emerging categories: ${newCats.join(', ')}.`;
  }

  // Build prompt context string
  const promptParts: string[] = [
    '═══ ADAPTIVE INTELLIGENCE CONTEXT (Auto-learned from analyst feedback) ═══'
  ];

  // Thresholds
  promptParts.push(`\nSignal thresholds: suppress below ${thresholds.suppress_below ?? 0.25}, low-confidence below ${thresholds.low_confidence_below ?? 0.45}. Based on ${thresholds.total_feedback ?? 0} analyst verdicts (${Math.round((thresholds.feedback_ratio ?? 0.5) * 100)}% relevant).`);

  // Approved patterns
  if (topApproved.length > 0) {
    promptParts.push(`\n✅ ANALYST-APPROVED PATTERNS (prioritize signals containing these): ${topApproved.join(', ')}`);
  }

  // Rejected patterns
  if (topRejected.length > 0) {
    promptParts.push(`\n❌ ANALYST-REJECTED PATTERNS (deprioritize signals containing these): ${topRejected.join(', ')}`);
  }

  // Implicit behavioral intelligence
  if (implicitMetrics.total_implicit_events > 0 && maxTokenBudget !== 'compact') {
    const parts: string[] = [];
    if (implicitMetrics.total_escalations) parts.push(`${implicitMetrics.total_escalations} escalations`);
    if (implicitMetrics.total_report_inclusions) parts.push(`${implicitMetrics.total_report_inclusions} report inclusions`);
    if (implicitMetrics.total_investigations) parts.push(`${implicitMetrics.total_investigations} investigations`);
    if (implicitMetrics.total_quick_dismissals) parts.push(`${implicitMetrics.total_quick_dismissals} quick dismissals`);
    if (parts.length > 0) {
      promptParts.push(`\n🧠 IMPLICIT ANALYST BEHAVIOR (last 24h): ${parts.join(', ')}. Signals that analysts investigate or escalate are high-value; quickly dismissed signals are low-value.`);
    }
  }

  // Source reliability
  const unreliable = sourceReliability.filter(s => s.score < 0.4 && s.total > 5);
  const reliable = sourceReliability.filter(s => s.score > 0.8 && s.total > 5);
  if (reliable.length > 0) {
    promptParts.push(`\n🟢 Trusted sources: ${reliable.map(s => `${s.source} (${Math.round(s.score * 100)}%)`).join(', ')}`);
  }
  if (unreliable.length > 0) {
    promptParts.push(`\n🔴 Low-reliability sources (treat with extra scrutiny): ${unreliable.map(s => `${s.source} (${Math.round(s.score * 100)}%)`).join(', ')}`);
  }

  // Quality scores
  const lowQuality = Object.entries(qualityScores).filter(([_, s]) => s < 0.5);
  if (lowQuality.length > 0) {
    promptParts.push(`\n📉 QUALITY IMPROVEMENT NEEDED: ${lowQuality.map(([t, s]) => `${t} (${Math.round(s * 100)}% satisfaction)`).join(', ')}. Adjust tone, depth, or relevance based on past corrections.`);
  }

  // Corrections
  if (corrections.length > 0 && maxTokenBudget !== 'compact') {
    promptParts.push(`\n📝 RECENT ANALYST CORRECTIONS (learn from these):\n${corrections.slice(0, 5).map(c => `  • "${c}"`).join('\n')}`);
  }

  // Drift
  promptParts.push(`\n${driftSummary}`);

  // Seasonal
  if (seasonalWarnings.length > 0 && maxTokenBudget !== 'compact') {
    promptParts.push(`\n📅 SEASONAL PATTERNS: ${seasonalWarnings.join('; ')}`);
  }

  // Active learning
  const queueSize = queue?.queue_size ?? 0;
  if (queueSize > 5) {
    promptParts.push(`\n🎯 ${queueSize} uncertain signals awaiting analyst review — encourage feedback on borderline items.`);
  }

  const snapshot: LearningSnapshot = {
    promptContext: promptParts.join('\n'),
    data: {
      thresholds: {
        suppressBelow: thresholds.suppress_below ?? 0.25,
        lowConfBelow: thresholds.low_confidence_below ?? 0.45,
        feedbackRatio: thresholds.feedback_ratio ?? 0.5,
      },
      topApprovedKeywords: topApproved,
      topRejectedKeywords: topRejected,
      driftAlert,
      driftSummary,
      sourceReliability,
      qualityScores,
      activeLearningQueueSize: queueSize,
      corrections,
      seasonalWarnings,
    },
    fetchedAt: new Date().toISOString(),
  };

  _cache = { snapshot, ts: Date.now() };
  return snapshot;
}

/**
 * Build a compact system prompt section for any AI agent.
 * Useful for briefing generators, report generators, etc.
 */
export async function getLearningPromptBlock(
  supabase: SupabaseClient,
  budget: 'compact' | 'standard' | 'full' = 'standard'
): Promise<string> {
  try {
    const snapshot = await getLearningSnapshot(supabase, { maxTokenBudget: budget });
    return snapshot.promptContext;
  } catch (err) {
    console.error('[learning-context-builder] Error fetching learning context:', err);
    return '═══ ADAPTIVE INTELLIGENCE CONTEXT ═══\nLearning context unavailable — proceeding with defaults.';
  }
}

/**
 * Get system health metrics for the self-healing tool.
 */
export async function getSystemHealthMetrics(supabase: SupabaseClient): Promise<Record<string, any>> {
  const snapshot = await getLearningSnapshot(supabase, { bypassCache: true, maxTokenBudget: 'full' });

  // Fetch recent learning session
  const { data: lastSession } = await supabase
    .from('agent_learning_sessions')
    .select('created_at, learnings, quality_score')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Fetch recent feedback volume
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentFeedbackCount } = await supabase
    .from('feedback_events')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', oneDayAgo);

  // Fetch monitoring health
  const { data: recentMonitoring } = await supabase
    .from('monitoring_history')
    .select('function_name, status, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  const failedMonitors = (recentMonitoring || []).filter(m => m.status === 'error');

  return {
    learning: {
      lastSessionAt: lastSession?.created_at || 'never',
      lastSessionQuality: lastSession?.quality_score || 0,
      sessionAge: lastSession?.created_at
        ? `${Math.round((Date.now() - new Date(lastSession.created_at).getTime()) / 3600000)}h ago`
        : 'unknown',
    },
    thresholds: snapshot.data.thresholds,
    drift: { alert: snapshot.data.driftAlert, summary: snapshot.data.driftSummary },
    quality: snapshot.data.qualityScores,
    activeLearnQueue: snapshot.data.activeLearningQueueSize,
    feedback24h: recentFeedbackCount || 0,
    sourceReliability: snapshot.data.sourceReliability,
    seasonal: snapshot.data.seasonalWarnings,
    corrections: snapshot.data.corrections,
    monitoringHealth: {
      recentTotal: recentMonitoring?.length || 0,
      failures: failedMonitors.length,
      failedFunctions: failedMonitors.map(m => m.function_name),
    },
  };
}
