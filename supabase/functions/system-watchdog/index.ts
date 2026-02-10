/**
 * System Watchdog — AI-Powered Autonomous Health Agent
 * 
 * An intelligent agent that UNDERSTANDS how Fortress is supposed to work
 * and reasons about system health, not just checks binary up/down states.
 * 
 * Runs every 6 hours via pg_cron. Collects comprehensive telemetry,
 * feeds it to an AI model with deep system knowledge, and emails
 * ak@silentshieldsecurity.com ONLY when the AI determines action is needed.
 * 
 * The AI agent knows:
 * - The platform's mission (Fortune 500 security intelligence)
 * - Architecture (multi-tenant, AEGIS-first, autonomous SOC)
 * - Expected behaviors (signal flow, briefing cadence, AI quality)
 * - Historical patterns (what "normal" looks like)
 * - Silent Shield doctrine and operational standards
 */

import { Resend } from "npm:resend@2.0.0";
import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const ALERT_EMAIL = 'ak@silentshieldsecurity.com';

// ═══════════════════════════════════════════════════════════════
//                   SYSTEM KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════

const FORTRESS_SYSTEM_KNOWLEDGE = `
You are the Fortress System Watchdog Agent — an autonomous AI health monitor for a corporate security intelligence platform called Fortress, built by Silent Shield Security.

## YOUR MISSION
You monitor platform health every 6 hours. You receive raw telemetry data and must determine:
1. Is the system delivering value to users WITHOUT requiring human intervention?
2. Are there degradations that will compound if left unattended?
3. What specific actions should the operator (AK) take, if any?

## PLATFORM ARCHITECTURE
Fortress is an AI-powered security operations center (SOC) for Fortune 500 companies. It operates on a multi-tenant architecture with these core systems:

### Signal Pipeline (CRITICAL)
- Monitoring sources (RSS, social, threat intel, OSINT) continuously ingest signals
- Signals are deduplicated via SHA-256 content hashing with 24hr lookback
- AI Decision Engine categorizes, scores relevance, and routes signals
- Adaptive confidence system uses analyst feedback to improve over time
- Source reliability weighting (0.0-1.0) with 14-day temporal decay
- EXPECTED: Steady flow of signals. Zero signals for 6+ hours = pipeline stall

### AEGIS AI Assistant (CRITICAL)  
- Primary user interface — agent-mediated UI philosophy
- Powered by GPT-4o/Gemini 2.5 Pro/Flash with 21 operational tools
- Must maintain persona consistency (Active Enterprise Guardian & Intelligence System)
- Strictly forbidden from hallucinating capabilities or URLs
- EXPECTED: Responds coherently with tool usage. Empty/generic responses = degraded

### Daily Briefing System (HIGH)
- Sends AI-generated threat summary email at 06:00 Calgary time (13:00 UTC)
- Suppression rule: skips if no new intelligence in 24 hours (this is NORMAL, not a failure)
- Uses Silent Shield doctrine (core-10 tagged entries) for posture lines
- Recipients configured in scheduled_briefings table
- EXPECTED: Sends daily unless suppressed. Check AFTER 14:00 UTC only

### Autonomous Operations (HIGH)
- OODA loop engine evaluates auto-escalation rules
- Creates incidents and briefings independently based on risk thresholds
- Autonomous threat scans run on schedule
- EXPECTED: Periodic autonomous actions logged. Complete silence for days = possible stall

### Edge Functions (150+)
- 5 CRITICAL: get-user-tenants, agent-chat, dashboard-ai-assistant, system-health-check, ingest-signal
- Operational: send-daily-briefing, support-chat, ai-decision-engine, autonomous-operations-loop, monitor-travel-risks
- A 404 on critical functions = deployment failure = CRITICAL
- A 404 on operational functions = service degradation = WARNING

### Data Integrity
- Signals and entities should have client_id (except global category signals)
- Database triggers auto-generate signal titles (ensure_signal_title)
- Cascade-delete triggers clean orphaned feedback records
- EXPECTED: Zero orphaned records. Small counts = minor drift. Large counts = integrity failure

### Bug Reports & User Feedback
- Users report issues via support-chat UI
- Bug workflow: Reported → Investigating → Fix Proposed → Testing → Verified → Closed
- EXPECTED: Bugs should progress through stages. 5+ bugs stagnating >7 days = backlog problem

### Travel Security
- Real-time risk monitoring for executive travel itineraries
- Synthesizes internal signals + Perplexity intelligence
- Time-series risk assessments across 5 categories
- May fail E2E scans due to RLS context limitations (known issue, not a real failure)

## ANALYSIS GUIDELINES

### What constitutes a REAL problem:
- Critical edge functions not deployed (immediate user impact)
- Signal pipeline producing zero signals for 6+ hours (intelligence blackout)
- Daily briefing failed to send (not suppressed — actually failed)
- Database connectivity issues (platform-wide impact)
- Spike in bug reports (5+ in 1 hour = something broke)
- AI responses becoming empty or generic (quality degradation)

### What is NORMAL and should NOT be flagged:
- Daily briefing suppressed due to no new intelligence (working as designed)
- Travel security E2E tests failing due to RLS context (known limitation)
- Small number of orphaned records (minor drift, not urgent)
- 1-2 open bug reports (normal operational volume)
- Edge functions returning CORS errors on OPTIONS (means they're deployed)
- Monitoring sources with no recent scans IF those sources are seasonal/periodic

### Severity Assessment:
- CRITICAL: Immediate user impact, platform cannot deliver core value
- WARNING: Degradation that will compound, should be addressed within 24-48 hours
- INFO: Noteworthy but not actionable — include for context but don't alarm

## OUTPUT FORMAT
You must respond with ONLY valid JSON (no markdown, no backticks):
{
  "shouldAlert": true/false,
  "overallAssessment": "One sentence executive summary of system state",
  "severity": "healthy" | "monitoring" | "degraded" | "critical",
  "findings": [
    {
      "category": "Signal Pipeline" | "AEGIS AI" | "Daily Briefing" | "Edge Functions" | "Data Integrity" | "Bug Reports" | "Database" | "Autonomous Ops",
      "severity": "critical" | "warning" | "info",
      "title": "Short descriptive title",
      "analysis": "What you observed and WHY it matters (2-3 sentences max)",
      "recommendation": "Specific action to take (1 sentence)"
    }
  ],
  "suppressedChecks": ["List of things you checked but determined are normal/expected"],
  "trendNote": "Brief note on any patterns you see compared to historical baseline (optional)"
}

IMPORTANT: Set shouldAlert=false if everything is healthy or only has minor info-level observations. Only alert when there are warning+ findings that require human attention.
`;

// ═══════════════════════════════════════════════════════════════
//                    TELEMETRY COLLECTORS
// ═══════════════════════════════════════════════════════════════

interface TelemetryData {
  timestamp: string;
  edgeFunctions: { name: string; status: string; responseTime?: number; error?: string }[];
  signalPipeline: {
    recentSignalCount: number;
    staleSources: string[];
    last24hCategories: Record<string, number>;
  };
  dailyBriefing: {
    sentToday: boolean;
    suppressionLikely: boolean;
    recipientCount: number;
  };
  dataIntegrity: {
    orphanedSignals: number;
    orphanedEntities: number;
  };
  bugReports: {
    totalOpen: number;
    staleCount: number;
    recentSpike: number;
    oldestOpenDays: number;
  };
  database: {
    connected: boolean;
    responseTimeMs: number;
  };
  autonomousOps: {
    recentActions: number;
    lastActionAge: string;
  };
  aiHealth: {
    systemHealthCheckStatus: number | null;
  };
  historicalBaseline: {
    avgDailySignals: number;
    avgWeeklyBugs: number;
  };
}

const CRITICAL_FUNCTIONS = [
  'get-user-tenants', 'agent-chat', 'dashboard-ai-assistant',
  'system-health-check', 'ingest-signal',
];
const OPERATIONAL_FUNCTIONS = [
  'send-daily-briefing', 'support-chat', 'ai-decision-engine',
  'autonomous-operations-loop', 'monitor-travel-risks',
];

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
      edgeFunctions.push({
        name: fn,
        status: response.status === 404 ? 'not_deployed' : 'ok',
        responseTime: Date.now() - start,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      if (msg.includes('CORS') || msg.includes('NetworkError')) {
        edgeFunctions.push({ name: fn, status: 'ok', responseTime: Date.now() - start });
      } else {
        edgeFunctions.push({ name: fn, status: 'error', error: msg, responseTime: Date.now() - start });
      }
    }
  }

  // Parallel DB queries
  const [
    recentSignalsResult,
    staleSourcesResult,
    signalCategoriesResult,
    todayBriefingsResult,
    briefingConfigResult,
    recentNewSignalsResult,
    orphanedSignalsResult,
    orphanedEntitiesResult,
    openBugsResult,
    staleBugsResult,
    recentBugsResult,
    oldestBugResult,
    autonomousActionsResult,
    lastAutonomousResult,
    avgSignalsResult,
    avgBugsResult,
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

  // Category breakdown
  const categoryBreakdown: Record<string, number> = {};
  if (signalCategoriesResult.data) {
    for (const s of signalCategoriesResult.data) {
      categoryBreakdown[s.category || 'uncategorized'] = (categoryBreakdown[s.category || 'uncategorized'] || 0) + 1;
    }
  }

  // Suppression detection
  const noNewIntel = (recentNewSignalsResult.count || 0) === 0;
  const briefingSentToday = (todayBriefingsResult.data?.length || 0) > 0;

  // Oldest bug age
  let oldestOpenDays = 0;
  if (oldestBugResult.data?.[0]?.created_at) {
    oldestOpenDays = Math.floor((now.getTime() - new Date(oldestBugResult.data[0].created_at).getTime()) / 86400000);
  }

  // Last autonomous action age
  let lastActionAge = 'unknown';
  if (lastAutonomousResult.data?.[0]?.created_at) {
    const hoursAgo = Math.floor((now.getTime() - new Date(lastAutonomousResult.data[0].created_at).getTime()) / 3600000);
    lastActionAge = hoursAgo < 24 ? `${hoursAgo}h ago` : `${Math.floor(hoursAgo / 24)}d ago`;
  }

  // DB health
  const dbStart = Date.now();
  let dbConnected = true;
  try {
    const { error } = await supabase.from('signals').select('id').limit(1);
    if (error) dbConnected = false;
  } catch { dbConnected = false; }
  const dbResponseTime = Date.now() - dbStart;

  // AI health check
  let aiHealthStatus: number | null = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(`${supabaseUrl}/functions/v1/system-health-check`, {
      method: 'POST',
      headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: controller.signal,
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
    dailyBriefing: {
      sentToday: briefingSentToday,
      suppressionLikely: noNewIntel,
      recipientCount: briefingConfigResult.data?.length || 0,
    },
    dataIntegrity: {
      orphanedSignals: orphanedSignalsResult.data?.length || 0,
      orphanedEntities: orphanedEntitiesResult.data?.length || 0,
    },
    bugReports: {
      totalOpen: openBugsResult.count || 0,
      staleCount: staleBugsResult.count || 0,
      recentSpike: recentBugsResult.count || 0,
      oldestOpenDays,
    },
    database: {
      connected: dbConnected,
      responseTimeMs: dbResponseTime,
    },
    autonomousOps: {
      recentActions: autonomousActionsResult.count || 0,
      lastActionAge,
    },
    aiHealth: {
      systemHealthCheckStatus: aiHealthStatus,
    },
    historicalBaseline: {
      avgDailySignals: Math.round((avgSignalsResult.count || 0) / 30),
      avgWeeklyBugs: Math.round((avgBugsResult.count || 0) / 4.3),
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//                    AI ANALYSIS ENGINE
// ═══════════════════════════════════════════════════════════════

interface AIAnalysis {
  shouldAlert: boolean;
  overallAssessment: string;
  severity: 'healthy' | 'monitoring' | 'degraded' | 'critical';
  findings: {
    category: string;
    severity: string;
    title: string;
    analysis: string;
    recommendation: string;
  }[];
  suppressedChecks: string[];
  trendNote?: string;
}

async function analyzeWithAI(telemetry: TelemetryData): Promise<AIAnalysis> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: FORTRESS_SYSTEM_KNOWLEDGE },
        {
          role: 'user',
          content: `Analyze the following Fortress system telemetry and determine if the operator needs to be alerted. Remember: only alert for genuine issues that require human attention. Normal operational patterns should be suppressed.\n\nTELEMETRY DATA:\n${JSON.stringify(telemetry, null, 2)}`
        },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI analysis failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    console.error('[Watchdog] Failed to parse AI response:', content);
    // Fallback: treat as alert-worthy since we can't parse
    return {
      shouldAlert: true,
      overallAssessment: 'Watchdog AI analysis returned unparseable response — manual review recommended.',
      severity: 'monitoring',
      findings: [{
        category: 'Watchdog Internal',
        severity: 'warning',
        title: 'AI analysis response unparseable',
        analysis: 'The watchdog AI returned a response that could not be parsed as JSON. This may indicate a model issue or prompt problem.',
        recommendation: 'Review watchdog logs to diagnose the parsing failure.',
      }],
      suppressedChecks: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════
//                    EMAIL BUILDER
// ═══════════════════════════════════════════════════════════════

function buildIntelligentAlertEmail(analysis: AIAnalysis, telemetry: TelemetryData): string {
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Edmonton' });
  const critical = analysis.findings.filter(f => f.severity === 'critical');
  const warnings = analysis.findings.filter(f => f.severity === 'warning');
  const info = analysis.findings.filter(f => f.severity === 'info');

  const severityColor = {
    critical: '#7f1d1d',
    degraded: '#78350f',
    monitoring: '#1e3a5f',
    healthy: '#14532d',
  }[analysis.severity] || '#78350f';

  const severityIcon = {
    critical: '🔴',
    degraded: '⚠️',
    monitoring: '🔍',
    healthy: '✅',
  }[analysis.severity] || '⚠️';

  const renderFindings = (findings: typeof analysis.findings, color: string, borderColor: string, bgColor: string) =>
    findings.map(f => `
      <div style="background: ${bgColor}; border-left: 3px solid ${borderColor}; padding: 14px 18px; margin-bottom: 10px; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <strong style="color: ${color}; font-size: 14px;">${f.title}</strong>
          <span style="color: #666; font-size: 11px; text-transform: uppercase;">${f.category}</span>
        </div>
        <p style="margin: 0 0 8px; color: #d4d4d4; font-size: 13px; line-height: 1.5;">${f.analysis}</p>
        <p style="margin: 0; color: #93c5fd; font-size: 13px;">→ ${f.recommendation}</p>
      </div>
    `).join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; margin: 0;">
  <div style="max-width: 680px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 8px; overflow: hidden;">
    
    <div style="background: ${severityColor}; padding: 22px 28px;">
      <h1 style="margin: 0; font-size: 18px; color: #fff;">
        ${severityIcon} Fortress Watchdog Intelligence Report
      </h1>
      <p style="margin: 8px 0 0; font-size: 14px; color: #e0e0e0; line-height: 1.4;">
        ${analysis.overallAssessment}
      </p>
      <p style="margin: 6px 0 0; font-size: 12px; color: #aaa;">${now} MT • System Status: ${analysis.severity.toUpperCase()}</p>
    </div>
    
    <div style="padding: 22px 28px;">
      ${critical.length > 0 ? `
        <h2 style="color: #ef4444; font-size: 13px; margin: 0 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">🔴 Critical Findings</h2>
        ${renderFindings(critical, '#fca5a5', '#ef4444', '#1a0505')}
      ` : ''}
      
      ${warnings.length > 0 ? `
        <h2 style="color: #f59e0b; font-size: 13px; margin: 20px 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">⚠️ Warnings</h2>
        ${renderFindings(warnings, '#fcd34d', '#f59e0b', '#1a1005')}
      ` : ''}

      ${info.length > 0 ? `
        <h2 style="color: #60a5fa; font-size: 13px; margin: 20px 0 14px; text-transform: uppercase; letter-spacing: 1.5px;">ℹ️ Observations</h2>
        ${renderFindings(info, '#93c5fd', '#3b82f6', '#0a1628')}
      ` : ''}

      ${analysis.trendNote ? `
        <div style="background: #0f172a; border: 1px solid #1e3a5f; padding: 14px 18px; margin-top: 20px; border-radius: 4px;">
          <strong style="color: #93c5fd; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">📊 Trend Analysis</strong>
          <p style="margin: 6px 0 0; color: #cbd5e1; font-size: 13px; line-height: 1.5;">${analysis.trendNote}</p>
        </div>
      ` : ''}

      ${analysis.suppressedChecks.length > 0 ? `
        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #222;">
          <p style="color: #666; font-size: 12px; margin: 0;">
            <strong>Suppressed (normal):</strong> ${analysis.suppressedChecks.join(' • ')}
          </p>
        </div>
      ` : ''}
    </div>

    <div style="padding: 14px 28px; background: #0a0a0a; border-top: 1px solid #222;">
      <table style="width: 100%; font-size: 11px; color: #555;">
        <tr>
          <td>Signals (6h): ${telemetry.signalPipeline.recentSignalCount}</td>
          <td>Bugs open: ${telemetry.bugReports.totalOpen}</td>
          <td>DB: ${telemetry.database.responseTimeMs}ms</td>
          <td>Auto-ops (24h): ${telemetry.autonomousOps.recentActions}</td>
        </tr>
      </table>
      <p style="margin: 8px 0 0; font-size: 11px; color: #444;">
        Fortress AI Watchdog • Autonomous intelligence-driven health monitoring
      </p>
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

    console.log('[Watchdog] 🧠 Starting AI-powered system health audit...');

    // Phase 1: Collect comprehensive telemetry
    const telemetry = await collectTelemetry(supabase, supabaseUrl, anonKey);
    console.log('[Watchdog] Telemetry collected:', JSON.stringify({
      signals6h: telemetry.signalPipeline.recentSignalCount,
      staleSources: telemetry.signalPipeline.staleSources.length,
      bugsOpen: telemetry.bugReports.totalOpen,
      dbMs: telemetry.database.responseTimeMs,
      functionsChecked: telemetry.edgeFunctions.length,
    }));

    // Phase 2: AI analysis
    const analysis = await analyzeWithAI(telemetry);
    console.log(`[Watchdog] AI verdict: severity=${analysis.severity}, shouldAlert=${analysis.shouldAlert}, findings=${analysis.findings.length}`);

    // Phase 3: Log metrics for trend tracking
    try {
      const healthScore = analysis.severity === 'healthy' ? 1.0 :
        analysis.severity === 'monitoring' ? 0.8 :
        analysis.severity === 'degraded' ? 0.5 : 0.2;
      await supabase.from('automation_metrics').insert({
        metric_date: new Date().toISOString().split('T')[0],
        accuracy_rate: healthScore,
        false_positive_rate: analysis.findings.filter(f => f.severity === 'critical').length / 10,
      });
    } catch (e) {
      console.warn('[Watchdog] Failed to log metrics:', e);
    }

    // Phase 4: Send email only if AI says to alert
    if (analysis.shouldAlert && analysis.findings.length > 0) {
      const resend = new Resend(RESEND_API_KEY);
      const criticalCount = analysis.findings.filter(f => f.severity === 'critical').length;

      const subject = analysis.severity === 'critical'
        ? `🔴 Fortress: ${criticalCount} critical issue${criticalCount !== 1 ? 's' : ''} — ${analysis.overallAssessment}`
        : `⚠️ Fortress Watchdog: ${analysis.overallAssessment}`;

      const { error: emailError } = await resend.emails.send({
        from: fromEmail,
        to: [ALERT_EMAIL],
        subject: subject.substring(0, 150),
        html: buildIntelligentAlertEmail(analysis, telemetry),
      });

      if (emailError) {
        console.error('[Watchdog] Email send failed:', emailError);
        return errorResponse(`Email failed: ${JSON.stringify(emailError)}`, 500);
      }

      console.log(`[Watchdog] 📧 Intelligence alert sent to ${ALERT_EMAIL}`);
      return successResponse({
        success: true,
        severity: analysis.severity,
        findingsCount: analysis.findings.length,
        emailSent: true,
        analysis,
      });
    }

    console.log('[Watchdog] ✅ AI assessment: all systems nominal — no alert needed');
    return successResponse({
      success: true,
      severity: analysis.severity,
      findingsCount: analysis.findings.length,
      emailSent: false,
      assessment: analysis.overallAssessment,
      suppressedChecks: analysis.suppressedChecks,
    });

  } catch (error) {
    console.error('[Watchdog] Fatal error:', error);

    // Emergency fallback email
    try {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@updates.lovableproject.com>';
      if (RESEND_API_KEY) {
        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: fromEmail,
          to: [ALERT_EMAIL],
          subject: '🔴 Fortress Watchdog Agent CRASHED',
          html: `
            <div style="font-family: sans-serif; background: #111; color: #e0e0e0; padding: 24px;">
              <h2 style="color: #ef4444;">Watchdog Agent Failure</h2>
              <p>The AI-powered watchdog agent failed to complete its health audit.</p>
              <pre style="background: #1a1a1a; padding: 16px; border-radius: 4px; overflow-x: auto; color: #fca5a5;">
${error instanceof Error ? error.stack || error.message : String(error)}
              </pre>
              <p style="color: #888; font-size: 13px;">This is an automated emergency alert. The watchdog itself needs attention.</p>
            </div>
          `,
        });
      }
    } catch { /* can't send fallback */ }

    return errorResponse(`Watchdog agent failed: ${error instanceof Error ? error.message : 'Unknown'}`, 500);
  }
});
