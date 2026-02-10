/**
 * System Watchdog — Self-Healing & Self-Improving AI Agent
 * 
 * An intelligent agent that UNDERSTANDS how Fortress works,
 * DETECTS issues, ATTEMPTS autonomous fixes, VERIFIES results,
 * LEARNS from outcomes, and REPORTS what was fixed vs. what needs attention.
 * 
 * Pipeline: Load Learnings → Collect Telemetry → AI Analysis → Auto-Remediate → Re-Verify → Store Learnings → Email Report
 * 
 * Self-Improvement Loop:
 * - Tracks which remediations succeed/fail over time
 * - Identifies recurring issues and escalates them
 * - Adjusts baselines as the platform grows
 * - Feeds historical context into AI analysis for smarter decisions
 * 
 * Runs every 6 hours via pg_cron. Emails ak@silentshieldsecurity.com
 */

import { Resend } from "npm:resend@2.0.0";
import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const ALERT_EMAIL = 'ak@silentshieldsecurity.com';

// ═══════════════════════════════════════════════════════════════
//                   SYSTEM KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════

const FORTRESS_SYSTEM_KNOWLEDGE = `
You are the Fortress System Watchdog Agent — an autonomous self-healing, self-improving AI for a corporate security intelligence platform called Fortress, built by Silent Shield Security.

## YOUR MISSION
You monitor platform health every 6 hours. You receive raw telemetry AND your own historical learnings from past runs. Use those learnings to make smarter decisions, avoid repeating failed fixes, and detect patterns humans would miss.

## SELF-IMPROVEMENT PROTOCOL
You will receive a LEARNING HISTORY section with:
- Past findings and their remediation outcomes (success/failure rates)
- Recurring issues that keep reappearing despite fixes
- Effectiveness scores for each remediation strategy
- Your own past observations and notes

USE THIS HISTORY TO:
1. Skip remediations that have consistently failed (effectiveness < 0.3)
2. Escalate recurring issues that self-healing cannot solve
3. Notice trends (e.g., "orphaned signals spike every Monday" or "source X fails after updates")
4. Adjust severity based on whether an issue is new vs. chronic
5. Recommend NEW remediation strategies if old ones aren't working
6. Note when the platform is growing (more signals, more users) and adjust baselines

## PLATFORM ARCHITECTURE
Fortress is an AI-powered SOC for Fortune 500 companies with these core systems:

### Signal Pipeline (CRITICAL)
- Monitoring sources (RSS, social, threat intel, OSINT) continuously ingest signals
- Signals deduplicated via SHA-256 content hashing, 24hr lookback
- AI Decision Engine categorizes, scores relevance, routes signals
- Source reliability weighting (0.0-1.0) with 14-day temporal decay
- EXPECTED: Steady flow. Zero signals for 6+ hours = pipeline stall
- REMEDIATION: Trigger monitoring source re-scans via edge functions

### AEGIS AI Assistant (CRITICAL)
- Primary user interface — agent-mediated UI philosophy
- Powered by GPT/Gemini with 21 operational tools
- EXPECTED: Responds coherently. Empty/generic = degraded
- REMEDIATION: Cannot auto-fix — flag for human review

### Daily Briefing System (HIGH)
- Sends AI-generated threat summary at 06:00 Calgary (13:00 UTC)
- Suppression rule: skips if no new intelligence in 24h (NORMAL)
- Uses Silent Shield doctrine (core-10 tagged entries)
- EXPECTED: Sends daily unless suppressed. Check AFTER 14:00 UTC only
- REMEDIATION: Can trigger manual briefing re-send

### Autonomous Operations (HIGH)
- OODA loop evaluates auto-escalation rules
- Creates incidents/briefings based on risk thresholds
- EXPECTED: Periodic actions logged. Silence for days = possible stall
- REMEDIATION: Trigger autonomous-operations-loop

### Data Integrity
- Signals/entities should have client_id (except global category)
- Database triggers auto-generate signal titles
- EXPECTED: Zero orphaned records
- REMEDIATION: Can fix orphaned signals by assigning default client, deactivate orphaned entities

### Bug Reports
- Users report via support-chat UI
- Workflow: Reported → Investigating → Fix Proposed → Testing → Verified → Closed
- EXPECTED: Bugs progress through stages. 5+ stale >7 days = backlog
- REMEDIATION: Can auto-close very old resolved bugs, add watchdog notes

### Edge Functions (150+)
- 5 CRITICAL: get-user-tenants, agent-chat, dashboard-ai-assistant, system-health-check, ingest-signal
- REMEDIATION: Cannot redeploy — flag for human attention

## PHASE 1: ANALYSIS OUTPUT FORMAT
Respond with ONLY valid JSON (no markdown):
{
  "shouldAlert": true/false,
  "overallAssessment": "One sentence summary",
  "severity": "healthy" | "monitoring" | "degraded" | "critical",
  "findings": [
    {
      "category": "Signal Pipeline" | "AEGIS AI" | "Daily Briefing" | "Edge Functions" | "Data Integrity" | "Bug Reports" | "Database" | "Autonomous Ops",
      "severity": "critical" | "warning" | "info",
      "title": "Short title",
      "analysis": "What you observed and WHY it matters (2-3 sentences). Reference learnings if relevant.",
      "recommendation": "What action to take. If past remediations failed, suggest alternatives.",
      "canAutoRemediate": true/false,
      "remediationAction": "stale_sources_rescan" | "trigger_briefing" | "fix_orphaned_signals" | "fix_orphaned_entities" | "close_stale_bugs" | "trigger_autonomous_loop" | "none",
      "isRecurring": true/false,
      "learningNote": "What you learned about this issue from history (or 'First occurrence')"
    }
  ],
  "suppressedChecks": ["Normal things you checked and suppressed"],
  "trendNote": "Trend observation including growth patterns",
  "selfImprovementNotes": ["Observations about your own effectiveness, baseline drift, or new patterns discovered"]
}

## What is NORMAL (suppress):
- Briefing suppressed due to no new intel
- Travel E2E tests failing (known RLS limitation)
- 1-2 open bugs (normal volume)
- CORS errors on OPTIONS (means function is deployed)
- Seasonal monitoring sources with no recent scans

Set shouldAlert=false if only minor info-level observations. Alert for warning+ findings.
`;

const VERIFICATION_PROMPT = `
You are reviewing the results of automated remediation actions taken by the Fortress System Watchdog.

For each remediation attempt, you received the original finding, the outcome, AND historical effectiveness data for that remediation type.

Use the effectiveness history to:
1. Downgrade confidence if this fix has a poor track record
2. Suggest alternative approaches if the same fix keeps failing
3. Mark issues as "chronic" if they've recurred 3+ times

## OUTPUT FORMAT (JSON only, no markdown):
{
  "overallAssessment": "Updated executive summary incorporating remediation outcomes",
  "severity": "healthy" | "monitoring" | "degraded" | "critical",
  "shouldStillAlert": true/false,
  "findings": [
    {
      "category": "string",
      "severity": "critical" | "warning" | "info" | "resolved",
      "title": "string",
      "analysis": "Updated analysis incorporating remediation result and historical context",
      "recommendation": "What remains to be done (or 'No action needed — resolved')",
      "remediationStatus": "fixed" | "partially_fixed" | "failed" | "not_attempted" | "not_applicable" | "chronic",
      "effectivenessScore": 0.0-1.0,
      "learningNote": "What should be remembered for next run"
    }
  ],
  "suppressedChecks": [],
  "trendNote": "optional",
  "selfImprovementNotes": ["Observations about remediation effectiveness"]
}

Mark findings as "resolved" severity and "fixed" remediationStatus if remediation succeeded.
Only set shouldStillAlert=true if there are unresolved warning+ issues remaining.
`;

// ═══════════════════════════════════════════════════════════════
//                    TELEMETRY & TYPES
// ═══════════════════════════════════════════════════════════════

interface TelemetryData {
  timestamp: string;
  edgeFunctions: { name: string; status: string; responseTime?: number; error?: string }[];
  signalPipeline: {
    recentSignalCount: number;
    staleSources: string[];
    last24hCategories: Record<string, number>;
  };
  dailyBriefing: { sentToday: boolean; suppressionLikely: boolean; recipientCount: number };
  dataIntegrity: { orphanedSignals: number; orphanedEntities: number };
  bugReports: { totalOpen: number; staleCount: number; recentSpike: number; oldestOpenDays: number };
  database: { connected: boolean; responseTimeMs: number };
  autonomousOps: { recentActions: number; lastActionAge: string };
  aiHealth: { systemHealthCheckStatus: number | null };
  historicalBaseline: { avgDailySignals: number; avgWeeklyBugs: number };
}

interface Finding {
  category: string;
  severity: string;
  title: string;
  analysis: string;
  recommendation: string;
  canAutoRemediate?: boolean;
  remediationAction?: string;
  remediationStatus?: string;
  isRecurring?: boolean;
  learningNote?: string;
  effectivenessScore?: number;
}

interface AIAnalysis {
  shouldAlert: boolean;
  overallAssessment: string;
  severity: 'healthy' | 'monitoring' | 'degraded' | 'critical';
  findings: Finding[];
  suppressedChecks: string[];
  trendNote?: string;
  shouldStillAlert?: boolean;
  selfImprovementNotes?: string[];
}

interface RemediationResult {
  action: string;
  finding: Finding;
  success: boolean;
  details: string;
}

interface LearningHistory {
  recentFindings: { category: string; title: string; action: string; success: boolean; count: number; lastSeen: string; effectivenessScore: number }[];
  recurringIssues: { category: string; title: string; occurrences: number; lastFixWorked: boolean }[];
  effectivenessStats: { action: string; successRate: number; totalAttempts: number }[];
  platformGrowth: { signalsTrend: string; entitiesTrend: string; usersTrend: string };
  pastSelfNotes: string[];
}

const CRITICAL_FUNCTIONS = ['get-user-tenants', 'agent-chat', 'dashboard-ai-assistant', 'system-health-check', 'ingest-signal'];
const OPERATIONAL_FUNCTIONS = ['send-daily-briefing', 'support-chat', 'ai-decision-engine', 'autonomous-operations-loop', 'monitor-travel-risks'];

// ═══════════════════════════════════════════════════════════════
//                 SELF-IMPROVEMENT: LEARNING HISTORY
// ═══════════════════════════════════════════════════════════════

async function loadLearningHistory(supabase: any): Promise<LearningHistory> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Fetch recent findings with outcomes
  const [recentResult, recurringResult, effectivenessResult, pastNotesResult] = await Promise.all([
    supabase
      .from('watchdog_learnings')
      .select('finding_category, finding_title, remediation_action, remediation_success, effectiveness_score, created_at')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('watchdog_learnings')
      .select('finding_category, finding_title, recurrence_count, remediation_success')
      .eq('was_recurring', true)
      .gte('created_at', thirtyDaysAgo)
      .order('recurrence_count', { ascending: false })
      .limit(20),
    supabase
      .from('watchdog_effectiveness')
      .select('*')
      .limit(20),
    supabase
      .from('watchdog_learnings')
      .select('ai_learning_note')
      .not('ai_learning_note', 'is', null)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  // Aggregate recent findings
  const findingMap = new Map<string, any>();
  for (const r of (recentResult.data || [])) {
    const key = `${r.finding_category}::${r.finding_title}`;
    if (!findingMap.has(key)) {
      findingMap.set(key, {
        category: r.finding_category,
        title: r.finding_title,
        action: r.remediation_action || 'none',
        success: r.remediation_success ?? false,
        count: 1,
        lastSeen: r.created_at,
        effectivenessScore: r.effectiveness_score ?? 0.5,
      });
    } else {
      const existing = findingMap.get(key);
      existing.count++;
      if (r.remediation_success) existing.success = true;
    }
  }

  // Platform growth signals
  const [signalsCount30d, signalsCount7d, entitiesCount] = await Promise.all([
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', sevenDaysAgo),
    supabase.from('entities').select('*', { count: 'exact', head: true }).eq('is_active', true),
  ]);

  const avgDaily30 = Math.round((signalsCount30d.count || 0) / 30);
  const avgDaily7 = Math.round((signalsCount7d.count || 0) / 7);
  const signalsTrend = avgDaily7 > avgDaily30 * 1.2 ? 'growing' : avgDaily7 < avgDaily30 * 0.8 ? 'declining' : 'stable';

  return {
    recentFindings: Array.from(findingMap.values()),
    recurringIssues: (recurringResult.data || []).map((r: any) => ({
      category: r.finding_category,
      title: r.finding_title,
      occurrences: r.recurrence_count,
      lastFixWorked: r.remediation_success ?? false,
    })),
    effectivenessStats: (effectivenessResult.data || []).map((r: any) => ({
      action: r.remediation_action,
      successRate: r.total_attempts > 0 ? r.successes / r.total_attempts : 0,
      totalAttempts: r.total_attempts,
    })),
    platformGrowth: {
      signalsTrend,
      entitiesTrend: (entitiesCount.count || 0) > 1000 ? 'large' : 'normal',
      usersTrend: 'stable', // Could be enhanced with profiles count
    },
    pastSelfNotes: (pastNotesResult.data || []).map((r: any) => r.ai_learning_note).filter(Boolean),
  };
}

async function storeLearnings(
  supabase: any,
  runId: string,
  analysis: AIAnalysis,
  remediations: RemediationResult[],
  learningHistory: LearningHistory,
  telemetry: TelemetryData,
): Promise<void> {
  const rows: any[] = [];

  for (const finding of analysis.findings) {
    const remediation = remediations.find(r => r.finding.title === finding.title);
    
    // Check if this is a recurring issue
    const pastOccurrences = learningHistory.recentFindings.filter(
      f => f.category === finding.category && f.title === finding.title
    );
    const isRecurring = pastOccurrences.length > 0;
    const recurrenceCount = isRecurring ? (pastOccurrences[0]?.count || 0) + 1 : 1;

    // Calculate effectiveness score
    let effectiveness = 0.5;
    if (remediation) {
      const pastEffectiveness = learningHistory.effectivenessStats.find(
        e => e.action === remediation.action
      );
      if (pastEffectiveness && pastEffectiveness.totalAttempts > 2) {
        // Weighted average: 70% historical, 30% current result
        effectiveness = pastEffectiveness.successRate * 0.7 + (remediation.success ? 1.0 : 0.0) * 0.3;
      } else {
        effectiveness = remediation.success ? 0.8 : 0.2;
      }
    }

    rows.push({
      run_id: runId,
      severity: finding.severity,
      finding_category: finding.category,
      finding_title: finding.title,
      remediation_action: remediation?.action || null,
      remediation_success: remediation?.success ?? null,
      remediation_details: remediation?.details || null,
      was_recurring: isRecurring,
      recurrence_count: recurrenceCount,
      learned_pattern: finding.learningNote || null,
      effectiveness_score: effectiveness,
      telemetry_snapshot: {
        signals6h: telemetry.signalPipeline.recentSignalCount,
        orphanedSignals: telemetry.dataIntegrity.orphanedSignals,
        openBugs: telemetry.bugReports.totalOpen,
        dbLatency: telemetry.database.responseTimeMs,
      },
      ai_learning_note: finding.learningNote || null,
    });
  }

  // Store self-improvement notes as a summary learning
  if (analysis.selfImprovementNotes && analysis.selfImprovementNotes.length > 0) {
    rows.push({
      run_id: runId,
      severity: 'info',
      finding_category: 'Self-Improvement',
      finding_title: 'Watchdog Self-Assessment',
      ai_learning_note: analysis.selfImprovementNotes.join(' | '),
      effectiveness_score: 1.0,
      telemetry_snapshot: {
        signals6h: telemetry.signalPipeline.recentSignalCount,
        overallSeverity: analysis.severity,
      },
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('watchdog_learnings').insert(rows);
    if (error) console.error('[Watchdog] Failed to store learnings:', error);
    else console.log(`[Watchdog] 🧠 Stored ${rows.length} learnings for future runs`);
  }
}

// ═══════════════════════════════════════════════════════════════
//                    TELEMETRY COLLECTOR
// ═══════════════════════════════════════════════════════════════

async function collectTelemetry(supabase: any, supabaseUrl: string, anonKey: string): Promise<TelemetryData> {
  const now = new Date();
  const sixHoursAgo = new Date(now.getTime() - 6 * 3600000).toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3600000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const today = now.toISOString().split('T')[0];

  // Edge function probes
  const allFunctions = [...CRITICAL_FUNCTIONS, ...OPERATIONAL_FUNCTIONS];
  const edgeFunctions: TelemetryData['edgeFunctions'] = [];
  for (const fn of allFunctions) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: 'OPTIONS', headers: { 'apikey': anonKey }, signal: controller.signal,
      });
      clearTimeout(timeout);
      edgeFunctions.push({ name: fn, status: response.status === 404 ? 'not_deployed' : 'ok', responseTime: Date.now() - start });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      if (msg.includes('CORS') || msg.includes('NetworkError')) {
        edgeFunctions.push({ name: fn, status: 'ok', responseTime: Date.now() - start });
      } else {
        edgeFunctions.push({ name: fn, status: 'error', error: msg, responseTime: Date.now() - start });
      }
    }
  }

  const [
    recentSignalsResult, staleSourcesResult, signalCategoriesResult,
    todayBriefingsResult, briefingConfigResult, recentNewSignalsResult,
    orphanedSignalsResult, orphanedEntitiesResult,
    openBugsResult, staleBugsResult, recentBugsResult, oldestBugResult,
    autonomousActionsResult, lastAutonomousResult,
    avgSignalsResult, avgBugsResult,
  ] = await Promise.all([
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', sixHoursAgo),
    supabase.from('monitoring_history').select('source_name').lt('scan_completed_at', sixHoursAgo).limit(20),
    supabase.from('signals').select('category').gte('created_at', twentyFourHoursAgo).limit(500),
    supabase.from('audio_briefings').select('id').gte('created_at', today + 'T00:00:00Z').eq('source_type', 'daily_briefing').limit(1),
    supabase.from('scheduled_briefings').select('id').eq('is_active', true).eq('briefing_type', 'daily_email'),
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', twentyFourHoursAgo),
    supabase.from('signals').select('id').is('client_id', null).not('category', 'eq', 'global').limit(20),
    supabase.from('entities').select('id').is('client_id', null).eq('is_active', true).limit(20),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).eq('status', 'open').lt('created_at', sevenDaysAgo),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).gte('created_at', new Date(now.getTime() - 3600000).toISOString()),
    supabase.from('bug_reports').select('created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(1),
    supabase.from('autonomous_actions_log').select('*', { count: 'exact', head: true }).gte('created_at', twentyFourHoursAgo),
    supabase.from('autonomous_actions_log').select('created_at').order('created_at', { ascending: false }).limit(1),
    supabase.from('signals').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
    supabase.from('bug_reports').select('*', { count: 'exact', head: true }).gte('created_at', thirtyDaysAgo),
  ]);

  const categoryBreakdown: Record<string, number> = {};
  if (signalCategoriesResult.data) {
    for (const s of signalCategoriesResult.data) {
      categoryBreakdown[s.category || 'uncategorized'] = (categoryBreakdown[s.category || 'uncategorized'] || 0) + 1;
    }
  }

  let oldestOpenDays = 0;
  if (oldestBugResult.data?.[0]?.created_at) {
    oldestOpenDays = Math.floor((now.getTime() - new Date(oldestBugResult.data[0].created_at).getTime()) / 86400000);
  }

  let lastActionAge = 'unknown';
  if (lastAutonomousResult.data?.[0]?.created_at) {
    const hoursAgo = Math.floor((now.getTime() - new Date(lastAutonomousResult.data[0].created_at).getTime()) / 3600000);
    lastActionAge = hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.floor(hoursAgo / 24)}d ago`;
  }

  const dbStart = Date.now();
  let dbConnected = true;
  try { const { error } = await supabase.from('signals').select('id').limit(1); if (error) dbConnected = false; } catch { dbConnected = false; }

  let aiHealthStatus: number | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(`${supabaseUrl}/functions/v1/system-health-check`, {
      method: 'POST',
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}), signal: controller.signal,
    });
    clearTimeout(timeout);
    aiHealthStatus = resp.status;
  } catch { aiHealthStatus = null; }

  return {
    timestamp: now.toISOString(),
    edgeFunctions,
    signalPipeline: {
      recentSignalCount: recentSignalsResult.count || 0,
      staleSources: (staleSourcesResult.data || []).map((s: any) => s.source_name),
      last24hCategories: categoryBreakdown,
    },
    dailyBriefing: { sentToday: (todayBriefingsResult.data?.length || 0) > 0, suppressionLikely: (recentNewSignalsResult.count || 0) === 0, recipientCount: briefingConfigResult.data?.length || 0 },
    dataIntegrity: { orphanedSignals: orphanedSignalsResult.data?.length || 0, orphanedEntities: orphanedEntitiesResult.data?.length || 0 },
    bugReports: { totalOpen: openBugsResult.count || 0, staleCount: staleBugsResult.count || 0, recentSpike: recentBugsResult.count || 0, oldestOpenDays },
    database: { connected: dbConnected, responseTimeMs: Date.now() - dbStart },
    autonomousOps: { recentActions: autonomousActionsResult.count || 0, lastActionAge },
    aiHealth: { systemHealthCheckStatus: aiHealthStatus },
    historicalBaseline: { avgDailySignals: Math.round((avgSignalsResult.count || 0) / 30), avgWeeklyBugs: Math.round((avgBugsResult.count || 0) / 4.3) },
  };
}

// ═══════════════════════════════════════════════════════════════
//                    AI ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════

async function callAI(systemPrompt: string, userMessage: string): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
      temperature: 0.1,
    }),
  });

  if (!response.ok) throw new Error(`AI call failed (${response.status}): ${await response.text()}`);
  const data = await response.json();
  let content = (data.choices?.[0]?.message?.content || '').trim();
  if (content.startsWith('```')) content = content.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  return JSON.parse(content);
}

// ═══════════════════════════════════════════════════════════════
//                  REMEDIATION ENGINE
// ═══════════════════════════════════════════════════════════════

async function executeRemediation(
  finding: Finding,
  supabase: any,
  supabaseUrl: string,
  anonKey: string,
  learningHistory: LearningHistory,
): Promise<RemediationResult> {
  const action = finding.remediationAction || 'none';
  
  // Check if this remediation has a poor track record
  const pastEffectiveness = learningHistory.effectivenessStats.find(e => e.action === action);
  if (pastEffectiveness && pastEffectiveness.totalAttempts > 3 && pastEffectiveness.successRate < 0.2) {
    console.log(`[Watchdog] ⏭️ Skipping ${action} — historical success rate too low (${(pastEffectiveness.successRate * 100).toFixed(0)}% over ${pastEffectiveness.totalAttempts} attempts)`);
    return {
      action, finding, success: false,
      details: `Skipped: historical success rate is ${(pastEffectiveness.successRate * 100).toFixed(0)}% over ${pastEffectiveness.totalAttempts} attempts. Needs human intervention or new strategy.`,
    };
  }

  console.log(`[Watchdog] 🔧 Attempting remediation: ${action} for "${finding.title}"`);

  try {
    switch (action) {
      case 'stale_sources_rescan': {
        const scanFunctions = ['monitor-news', 'monitor-threat-intel', 'monitor-rss-sources'];
        let triggered = 0;
        for (const fn of scanFunctions) {
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
              method: 'POST',
              headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ triggered_by: 'watchdog', reason: 'stale_source_remediation' }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            triggered++;
          } catch (e) {
            console.warn(`[Watchdog] Failed to trigger ${fn}:`, e);
          }
        }
        return { action, finding, success: triggered > 0, details: `Triggered ${triggered}/${scanFunctions.length} monitoring functions` };
      }

      case 'trigger_briefing': {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const resp = await fetch(`${supabaseUrl}/functions/v1/send-daily-briefing`, {
          method: 'POST',
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered_by: 'watchdog' }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return { action, finding, success: resp.ok, details: resp.ok ? 'Daily briefing re-triggered successfully' : `Briefing trigger returned ${resp.status}` };
      }

      case 'fix_orphaned_signals': {
        const { data: defaultClient } = await supabase.from('clients').select('id').limit(1).single();
        if (!defaultClient) return { action, finding, success: false, details: 'No default client found to assign orphaned signals' };

        const { data: orphaned } = await supabase.from('signals').select('id').is('client_id', null).not('category', 'eq', 'global').limit(50);
        if (!orphaned || orphaned.length === 0) return { action, finding, success: true, details: 'No orphaned signals found (already clean)' };

        const ids = orphaned.map((s: any) => s.id);
        const { error } = await supabase.from('signals').update({ client_id: defaultClient.id }).in('id', ids);
        return { action, finding, success: !error, details: error ? `Fix failed: ${error.message}` : `Assigned ${ids.length} orphaned signals to default client` };
      }

      case 'fix_orphaned_entities': {
        const { data: orphaned } = await supabase.from('entities').select('id').is('client_id', null).eq('is_active', true).limit(50);
        if (!orphaned || orphaned.length === 0) return { action, finding, success: true, details: 'No orphaned entities found' };

        const ids = orphaned.map((e: any) => e.id);
        const { error } = await supabase.from('entities').update({ is_active: false }).in('id', ids);
        return { action, finding, success: !error, details: error ? `Fix failed: ${error.message}` : `Deactivated ${ids.length} orphaned entities` };
      }

      case 'close_stale_bugs': {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: staleBugs } = await supabase
          .from('bug_reports')
          .select('id, title')
          .eq('status', 'open')
          .lt('created_at', thirtyDaysAgo)
          .lt('updated_at', thirtyDaysAgo)
          .limit(10);

        if (!staleBugs || staleBugs.length === 0) return { action, finding, success: true, details: 'No bugs old enough for auto-close (>30 days)' };

        const ids = staleBugs.map((b: any) => b.id);
        const { error } = await supabase.from('bug_reports').update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          workflow_stage: 'Closed',
          fix_status: 'auto_closed_by_watchdog',
        }).in('id', ids);

        return { action, finding, success: !error, details: error ? `Close failed: ${error.message}` : `Auto-closed ${ids.length} stale bugs (>30 days): ${staleBugs.map((b: any) => b.title).join(', ')}` };
      }

      case 'trigger_autonomous_loop': {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        const resp = await fetch(`${supabaseUrl}/functions/v1/autonomous-operations-loop`, {
          method: 'POST',
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered_by: 'watchdog' }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return { action, finding, success: resp.ok, details: resp.ok ? 'Autonomous operations loop re-triggered' : `Trigger returned ${resp.status}` };
      }

      default:
        return { action, finding, success: false, details: 'No automated remediation available for this issue' };
    }
  } catch (err) {
    return { action, finding, success: false, details: `Remediation failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

// ═══════════════════════════════════════════════════════════════
//                    EMAIL BUILDER
// ═══════════════════════════════════════════════════════════════

function buildAlertEmail(analysis: AIAnalysis, telemetry: TelemetryData, remediations: RemediationResult[], learningHistory: LearningHistory): string {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Edmonton' });

  const severityColor: Record<string, string> = { critical: '#7f1d1d', degraded: '#78350f', monitoring: '#1e3a5f', healthy: '#14532d' };
  const severityIcon: Record<string, string> = { critical: '🔴', degraded: '⚠️', monitoring: '🔍', healthy: '✅' };

  const resolved = analysis.findings.filter(f => f.remediationStatus === 'fixed');
  const chronic = analysis.findings.filter(f => f.remediationStatus === 'chronic');
  const unresolved = analysis.findings.filter(f => f.severity === 'critical' || f.severity === 'warning');
  const info = analysis.findings.filter(f => f.severity === 'info');

  const renderFinding = (f: Finding, color: string, borderColor: string, bgColor: string) => {
    const statusBadge = f.remediationStatus === 'fixed' ? '<span style="background: #14532d; color: #4ade80; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">✅ AUTO-FIXED</span>' :
      f.remediationStatus === 'partially_fixed' ? '<span style="background: #78350f; color: #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">⚡ PARTIAL FIX</span>' :
      f.remediationStatus === 'failed' ? '<span style="background: #7f1d1d; color: #fca5a5; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">❌ FIX FAILED</span>' :
      f.remediationStatus === 'chronic' ? '<span style="background: #4a1d96; color: #c4b5fd; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">🔁 CHRONIC</span>' :
      '';

    const recurringBadge = f.isRecurring ? '<span style="background: #1e3a5f; color: #93c5fd; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;">↻ recurring</span>' : '';

    return `
      <div style="background: ${bgColor}; border-left: 3px solid ${borderColor}; padding: 14px 18px; margin-bottom: 10px; border-radius: 4px;">
        <div style="margin-bottom: 6px;">
          <strong style="color: ${color}; font-size: 14px;">${f.title}</strong>${statusBadge}${recurringBadge}
          <span style="color: #666; font-size: 11px; text-transform: uppercase; float: right;">${f.category}</span>
        </div>
        <p style="margin: 0 0 8px; color: #d4d4d4; font-size: 13px; line-height: 1.5;">${f.analysis}</p>
        <p style="margin: 0; color: #93c5fd; font-size: 13px;">→ ${f.recommendation}</p>
        ${f.learningNote ? `<p style="margin: 6px 0 0; color: #a78bfa; font-size: 12px; font-style: italic;">🧠 ${f.learningNote}</p>` : ''}
      </div>`;
  };

  // Remediation summary
  const remediationSummary = remediations.length > 0 ? `
    <div style="background: #0f172a; border: 1px solid #1e3a5f; padding: 18px; margin-bottom: 20px; border-radius: 6px;">
      <h2 style="color: #60a5fa; font-size: 13px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 1.5px;">🔧 Autonomous Remediation Report</h2>
      ${remediations.map(r => `
        <div style="padding: 8px 0; border-bottom: 1px solid #1e293b;">
          <span style="color: ${r.success ? '#4ade80' : '#ef4444'}; font-size: 13px;">${r.success ? '✅' : '❌'} ${r.action}</span>
          <p style="margin: 4px 0 0; color: #94a3b8; font-size: 12px;">${r.details}</p>
        </div>
      `).join('')}
      <p style="margin: 12px 0 0; color: #64748b; font-size: 12px;">
        ${remediations.filter(r => r.success).length}/${remediations.length} remediation actions succeeded
      </p>
    </div>
  ` : '';

  // Self-improvement section
  const selfImprovementSection = (analysis.selfImprovementNotes && analysis.selfImprovementNotes.length > 0) ? `
    <div style="background: #1a0533; border: 1px solid #6d28d9; padding: 18px; margin-top: 20px; border-radius: 6px;">
      <h2 style="color: #a78bfa; font-size: 13px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 1.5px;">🧠 Watchdog Self-Improvement Notes</h2>
      ${analysis.selfImprovementNotes.map(note => `
        <p style="margin: 0 0 8px; color: #c4b5fd; font-size: 13px; line-height: 1.5;">• ${note}</p>
      `).join('')}
      <p style="margin: 12px 0 0; color: #7c3aed; font-size: 11px;">
        Learning from ${learningHistory.recentFindings.length} past findings • ${learningHistory.recurringIssues.length} chronic patterns tracked • Platform signals: ${learningHistory.platformGrowth.signalsTrend}
      </p>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; margin: 0;">
  <div style="max-width: 700px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 8px; overflow: hidden;">
    
    <div style="background: ${severityColor[analysis.severity] || '#78350f'}; padding: 22px 28px;">
      <h1 style="margin: 0; font-size: 18px; color: #fff;">
        ${severityIcon[analysis.severity] || '⚠️'} Fortress Watchdog Intelligence Report
      </h1>
      <p style="margin: 8px 0 0; font-size: 14px; color: #e0e0e0; line-height: 1.4;">${analysis.overallAssessment}</p>
      <p style="margin: 6px 0 0; font-size: 12px; color: #aaa;">${now} MT • Status: ${analysis.severity.toUpperCase()} ${resolved.length > 0 ? `• ${resolved.length} auto-resolved` : ''} ${chronic.length > 0 ? `• ${chronic.length} chronic` : ''}</p>
    </div>
    
    <div style="padding: 22px 28px;">
      ${remediationSummary}

      ${resolved.length > 0 ? `
        <h2 style="color: #4ade80; font-size: 13px; margin: 0 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">✅ Auto-Resolved</h2>
        ${resolved.map(f => renderFinding(f, '#4ade80', '#22c55e', '#052e16')).join('')}
      ` : ''}

      ${chronic.length > 0 ? `
        <h2 style="color: #a78bfa; font-size: 13px; margin: 20px 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">🔁 Chronic Issues (Needs Strategic Fix)</h2>
        ${chronic.map(f => renderFinding(f, '#c4b5fd', '#7c3aed', '#1a0533')).join('')}
      ` : ''}

      ${unresolved.length > 0 ? `
        <h2 style="color: #ef4444; font-size: 13px; margin: 20px 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">🔴 Requires Attention</h2>
        ${unresolved.map(f => renderFinding(f, f.severity === 'critical' ? '#fca5a5' : '#fcd34d', f.severity === 'critical' ? '#ef4444' : '#f59e0b', f.severity === 'critical' ? '#1a0505' : '#1a1005')).join('')}
      ` : ''}

      ${info.length > 0 ? `
        <h2 style="color: #60a5fa; font-size: 13px; margin: 20px 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">ℹ️ Observations</h2>
        ${info.map(f => renderFinding(f, '#93c5fd', '#3b82f6', '#0a1628')).join('')}
      ` : ''}

      ${analysis.trendNote ? `
        <div style="background: #0f172a; border: 1px solid #1e3a5f; padding: 14px 18px; margin-top: 20px; border-radius: 4px;">
          <strong style="color: #93c5fd; font-size: 12px; text-transform: uppercase;">📊 Trend Analysis</strong>
          <p style="margin: 6px 0 0; color: #cbd5e1; font-size: 13px;">${analysis.trendNote}</p>
        </div>
      ` : ''}

      ${selfImprovementSection}

      ${analysis.suppressedChecks?.length > 0 ? `
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #222;">
          <p style="color: #666; font-size: 12px; margin: 0;"><strong>Suppressed (normal):</strong> ${analysis.suppressedChecks.join(' • ')}</p>
        </div>
      ` : ''}
    </div>

    <div style="padding: 14px 28px; background: #0a0a0a; border-top: 1px solid #222;">
      <table style="width: 100%; font-size: 11px; color: #555;">
        <tr>
          <td>Signals (6h): ${telemetry.signalPipeline.recentSignalCount}</td>
          <td>Bugs: ${telemetry.bugReports.totalOpen}</td>
          <td>DB: ${telemetry.database.responseTimeMs}ms</td>
          <td>Auto-ops: ${telemetry.autonomousOps.recentActions}</td>
        </tr>
      </table>
      <p style="margin: 8px 0 0; font-size: 11px; color: #444;">Fortress Self-Healing & Self-Improving Watchdog • Detect → Fix → Learn → Evolve</p>
    </div>
  </div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
//                        MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@updates.lovableproject.com>';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    const runId = crypto.randomUUID();

    // Phase 0: Load learning history
    console.log('[Watchdog] 🧠 Phase 0: Loading learning history...');
    let learningHistory: LearningHistory;
    try {
      learningHistory = await loadLearningHistory(supabase);
      console.log(`[Watchdog] Loaded ${learningHistory.recentFindings.length} past findings, ${learningHistory.recurringIssues.length} recurring issues, ${learningHistory.effectivenessStats.length} effectiveness records`);
    } catch (e) {
      console.warn('[Watchdog] Failed to load learning history (first run?):', e);
      learningHistory = { recentFindings: [], recurringIssues: [], effectivenessStats: [], platformGrowth: { signalsTrend: 'unknown', entitiesTrend: 'unknown', usersTrend: 'unknown' }, pastSelfNotes: [] };
    }

    // Phase 1: Collect telemetry
    console.log('[Watchdog] 📡 Phase 1: Collecting telemetry...');
    const telemetry = await collectTelemetry(supabase, supabaseUrl, anonKey);
    console.log(`[Watchdog] Telemetry: signals6h=${telemetry.signalPipeline.recentSignalCount}, stale=${telemetry.signalPipeline.staleSources.length}, bugs=${telemetry.bugReports.totalOpen}`);

    // Phase 2: AI Analysis WITH learning context
    console.log('[Watchdog] 🧠 Phase 2: AI analysis with learning context...');
    const analysisInput = {
      telemetry,
      learningHistory: {
        recentFindings: learningHistory.recentFindings.slice(0, 20),
        recurringIssues: learningHistory.recurringIssues,
        effectivenessStats: learningHistory.effectivenessStats,
        platformGrowth: learningHistory.platformGrowth,
        pastSelfNotes: learningHistory.pastSelfNotes.slice(0, 5),
      },
    };

    let analysis: AIAnalysis;
    try {
      analysis = await callAI(
        FORTRESS_SYSTEM_KNOWLEDGE,
        `Analyze this telemetry AND your learning history to make informed decisions. Skip remediations with poor track records. Identify recurring patterns.\n\n${JSON.stringify(analysisInput, null, 2)}`
      );
    } catch (e) {
      console.error('[Watchdog] AI analysis failed:', e);
      analysis = {
        shouldAlert: true, overallAssessment: 'AI analysis engine failed — raw telemetry review needed.',
        severity: 'monitoring', findings: [], suppressedChecks: [], selfImprovementNotes: ['AI analysis failed — investigate gateway health'],
      };
    }
    console.log(`[Watchdog] AI verdict: severity=${analysis.severity}, findings=${analysis.findings.length}, remediable=${analysis.findings.filter(f => f.canAutoRemediate).length}`);

    // Phase 3: Auto-Remediate (with learning-informed decisions)
    const remediableFindings = analysis.findings.filter(f => f.canAutoRemediate && f.remediationAction && f.remediationAction !== 'none');
    const remediationResults: RemediationResult[] = [];

    if (remediableFindings.length > 0) {
      console.log(`[Watchdog] 🔧 Phase 3: Attempting ${remediableFindings.length} remediation(s)...`);
      for (const finding of remediableFindings) {
        const result = await executeRemediation(finding, supabase, supabaseUrl, anonKey, learningHistory);
        remediationResults.push(result);
        console.log(`[Watchdog] ${result.success ? '✅' : '❌'} ${result.action}: ${result.details}`);
      }

      // Phase 4: Re-verify with AI (include effectiveness context)
      console.log('[Watchdog] 🧠 Phase 4: AI re-verification with effectiveness history...');
      try {
        const verificationInput = {
          originalAnalysis: analysis,
          remediationResults: remediationResults.map(r => ({
            action: r.action,
            findingTitle: r.finding.title,
            success: r.success,
            details: r.details,
          })),
          effectivenessHistory: learningHistory.effectivenessStats,
          recurringIssues: learningHistory.recurringIssues,
        };
        const verified = await callAI(VERIFICATION_PROMPT, JSON.stringify(verificationInput, null, 2));
        analysis.overallAssessment = verified.overallAssessment || analysis.overallAssessment;
        analysis.severity = verified.severity || analysis.severity;
        analysis.findings = verified.findings || analysis.findings;
        analysis.shouldAlert = verified.shouldStillAlert ?? analysis.shouldAlert;
        analysis.suppressedChecks = verified.suppressedChecks || analysis.suppressedChecks;
        analysis.trendNote = verified.trendNote || analysis.trendNote;
        if (verified.selfImprovementNotes) {
          analysis.selfImprovementNotes = [...(analysis.selfImprovementNotes || []), ...verified.selfImprovementNotes];
        }
      } catch (e) {
        console.warn('[Watchdog] Re-verification failed, using original analysis:', e);
        for (const result of remediationResults) {
          const finding = analysis.findings.find(f => f.title === result.finding.title);
          if (finding) {
            finding.remediationStatus = result.success ? 'fixed' : 'failed';
            if (result.success) finding.severity = 'resolved';
          }
        }
      }
    } else {
      console.log('[Watchdog] No auto-remediable issues found — skipping remediation phase');
    }

    // Phase 5: Store learnings for future runs
    console.log('[Watchdog] 🧠 Phase 5: Storing learnings...');
    try {
      await storeLearnings(supabase, runId, analysis, remediationResults, learningHistory, telemetry);
    } catch (e) {
      console.warn('[Watchdog] Failed to store learnings:', e);
    }

    // Phase 6: Log metrics
    try {
      const healthScore = analysis.severity === 'healthy' ? 1.0 : analysis.severity === 'monitoring' ? 0.8 : analysis.severity === 'degraded' ? 0.5 : 0.2;
      await supabase.from('automation_metrics').insert({
        metric_date: new Date().toISOString().split('T')[0],
        accuracy_rate: healthScore,
        false_positive_rate: analysis.findings.filter(f => f.severity === 'critical').length / 10,
      });
    } catch { /* metrics logging is best-effort */ }

    // Log remediation actions
    for (const r of remediationResults) {
      try {
        await supabase.from('autonomous_actions_log').insert({
          action_type: 'watchdog_remediation',
          trigger_source: 'system-watchdog',
          action_details: { action: r.action, finding: r.finding.title, category: r.finding.category },
          status: r.success ? 'completed' : 'failed',
          error_message: r.success ? null : r.details,
          result: { details: r.details },
        });
      } catch { /* logging is best-effort */ }
    }

    // Phase 7: Email (always send if remediations were attempted, otherwise only on alert)
    const shouldEmail = analysis.shouldAlert || remediationResults.length > 0;

    if (shouldEmail) {
      const resend = new Resend(RESEND_API_KEY);
      const fixedCount = remediationResults.filter(r => r.success).length;
      const unresolvedCount = analysis.findings.filter(f => f.severity === 'critical' || f.severity === 'warning').length;
      const chronicCount = analysis.findings.filter(f => f.remediationStatus === 'chronic').length;

      let subject: string;
      if (fixedCount > 0 && unresolvedCount === 0 && chronicCount === 0) {
        subject = `✅ Fortress Watchdog: ${fixedCount} issue${fixedCount !== 1 ? 's' : ''} auto-resolved — all systems nominal`;
      } else if (chronicCount > 0) {
        subject = `🔁 Fortress: ${chronicCount} chronic issue${chronicCount !== 1 ? 's' : ''} ${fixedCount > 0 ? `+ ${fixedCount} fixed` : '— needs strategic intervention'}`;
      } else if (fixedCount > 0 && unresolvedCount > 0) {
        subject = `⚠️ Fortress: ${fixedCount} fixed, ${unresolvedCount} still need attention`;
      } else if (analysis.severity === 'critical') {
        subject = `🔴 Fortress Alert: ${analysis.overallAssessment}`;
      } else {
        subject = `⚠️ Fortress Watchdog: ${analysis.overallAssessment}`;
      }

      const { error: emailError } = await resend.emails.send({
        from: fromEmail,
        to: [ALERT_EMAIL],
        subject: subject.substring(0, 150),
        html: buildAlertEmail(analysis, telemetry, remediationResults, learningHistory),
      });

      if (emailError) console.error('[Watchdog] Email failed:', emailError);
      else console.log(`[Watchdog] 📧 Report sent to ${ALERT_EMAIL}`);

      return successResponse({
        success: true, severity: analysis.severity, runId,
        findings: analysis.findings.length, remediations: remediationResults.length,
        fixed: fixedCount, chronic: chronicCount, emailSent: !emailError,
        learningsStored: true,
      });
    }

    console.log('[Watchdog] ✅ All systems nominal — no email needed');
    return successResponse({ success: true, severity: analysis.severity, runId, findings: 0, emailSent: false, learningsStored: true, assessment: analysis.overallAssessment });

  } catch (error) {
    console.error('[Watchdog] Fatal error:', error);
    try {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@updates.lovableproject.com>';
      if (RESEND_API_KEY) {
        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: fromEmail, to: [ALERT_EMAIL],
          subject: '🔴 Fortress Watchdog Agent CRASHED',
          html: `<div style="font-family:sans-serif;background:#111;color:#e0e0e0;padding:24px"><h2 style="color:#ef4444">Watchdog Agent Failure</h2><p>The self-healing watchdog failed to complete its audit.</p><pre style="background:#1a1a1a;padding:16px;border-radius:4px;color:#fca5a5">${error instanceof Error ? error.stack || error.message : String(error)}</pre></div>`,
        });
      }
    } catch { /* last resort */ }
    return errorResponse(`Watchdog failed: ${error instanceof Error ? error.message : 'Unknown'}`, 500);
  }
});
