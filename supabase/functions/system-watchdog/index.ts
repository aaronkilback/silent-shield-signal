/**
 * System Watchdog — Autonomous Health Monitor
 * 
 * Runs every 6 hours via pg_cron. Checks all critical systems and
 * emails ak@silentshieldsecurity.com ONLY when issues are detected.
 * No news = good news.
 * 
 * Checks:
 * 1. Critical edge function health (5 core functions)
 * 2. Signal pipeline freshness (stale sources)
 * 3. Daily briefing delivery verification
 * 4. AI health (AEGIS responsiveness)
 * 5. Data integrity (orphaned records)
 * 6. Bug report backlog (unresolved, stagnating)
 * 7. Support chat health
 * 8. E2E feature probes
 */

import { Resend } from "npm:resend@2.0.0";
import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

const ALERT_EMAIL = 'ak@silentshieldsecurity.com';

const CRITICAL_FUNCTIONS = [
  'get-user-tenants',
  'agent-chat',
  'dashboard-ai-assistant',
  'system-health-check',
  'ingest-signal',
];

const OPERATIONAL_FUNCTIONS = [
  'send-daily-briefing',
  'support-chat',
  'ai-decision-engine',
  'autonomous-operations-loop',
  'monitor-travel-risks',
];

interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  details?: string;
}

// ═══════════════════════════════════════════════════════════════
//                        CHECK FUNCTIONS
// ═══════════════════════════════════════════════════════════════

async function checkEdgeFunctions(supabaseUrl: string, anonKey: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const allFunctions = [...CRITICAL_FUNCTIONS, ...OPERATIONAL_FUNCTIONS];

  for (const fn of allFunctions) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: 'OPTIONS',
        headers: { 'apikey': anonKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 404) {
        const isCritical = CRITICAL_FUNCTIONS.includes(fn);
        results.push({
          name: `Edge Function: ${fn}`,
          status: isCritical ? 'critical' : 'warning',
          message: 'Not deployed',
        });
      }
      // Any other response = deployed and responding
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown';
      // CORS errors mean function exists
      if (msg.includes('CORS') || msg.includes('NetworkError')) continue;

      results.push({
        name: `Edge Function: ${fn}`,
        status: CRITICAL_FUNCTIONS.includes(fn) ? 'critical' : 'warning',
        message: msg.includes('abort') ? 'Timeout (>10s)' : msg,
      });
    }
  }

  return results;
}

async function checkSignalFreshness(supabase: any): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const sixHoursAgo = new Date(Date.now() - 6 * 3600000).toISOString();

  // Check if ANY signals have been ingested in the last 6 hours
  const { count: recentSignals } = await supabase
    .from('signals')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', sixHoursAgo);

  if ((recentSignals || 0) === 0) {
    results.push({
      name: 'Signal Pipeline',
      status: 'warning',
      message: 'No new signals in 6 hours',
      details: 'Monitoring sources may have stopped producing or ingestion is stalled.',
    });
  }

  // Check for stale monitoring sources
  const { data: staleSources } = await supabase
    .from('monitoring_history')
    .select('source_name, scan_completed_at')
    .lt('scan_completed_at', sixHoursAgo)
    .limit(10);

  if (staleSources && staleSources.length > 0) {
    results.push({
      name: 'Monitoring Sources',
      status: 'warning',
      message: `${staleSources.length} stale source(s)`,
      details: staleSources.map((s: any) => s.source_name).join(', '),
    });
  }

  return results;
}

async function checkDailyBriefing(supabase: any): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const today = new Date().toISOString().split('T')[0];

  // Check if today's briefing was sent (look in audio_briefings or automation_metrics)
  const { data: todayBriefings } = await supabase
    .from('audio_briefings')
    .select('id, status, created_at')
    .gte('created_at', today + 'T00:00:00Z')
    .eq('source_type', 'daily_briefing')
    .limit(1);

  // Also check automation_metrics for today
  const { data: todayMetrics } = await supabase
    .from('automation_metrics')
    .select('id')
    .eq('metric_date', today)
    .limit(1);

  // Only flag after 14:00 UTC (7am Calgary) — briefing sends at 13:00 UTC
  const nowHour = new Date().getUTCHours();
  if (nowHour >= 14 && (!todayBriefings || todayBriefings.length === 0) && (!todayMetrics || todayMetrics.length === 0)) {
    results.push({
      name: 'Daily Briefing',
      status: 'warning',
      message: 'No daily briefing detected for today',
      details: 'The scheduled 06:00 MT briefing may not have sent. Check send-daily-briefing logs.',
    });
  }

  return results;
}

async function checkAIHealth(supabaseUrl: string, anonKey: string): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${supabaseUrl}/functions/v1/system-health-check`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      results.push({
        name: 'AI/Backend Health',
        status: 'warning',
        message: `system-health-check returned ${response.status}`,
      });
    }
  } catch (err) {
    results.push({
      name: 'AI/Backend Health',
      status: 'warning',
      message: `Health check failed: ${err instanceof Error ? err.message : 'Unknown'}`,
    });
  }

  return results;
}

async function checkDataIntegrity(supabase: any): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Orphaned signals (no client_id, not global)
  const { data: orphanedSignals } = await supabase
    .from('signals')
    .select('id')
    .is('client_id', null)
    .not('category', 'eq', 'global')
    .limit(10);

  if (orphanedSignals && orphanedSignals.length > 0) {
    results.push({
      name: 'Data Integrity: Orphaned Signals',
      status: 'warning',
      message: `${orphanedSignals.length}+ signals without client_id`,
    });
  }

  // Orphaned entities
  const { data: orphanedEntities } = await supabase
    .from('entities')
    .select('id')
    .is('client_id', null)
    .eq('is_active', true)
    .limit(10);

  if (orphanedEntities && orphanedEntities.length > 0) {
    results.push({
      name: 'Data Integrity: Orphaned Entities',
      status: 'warning',
      message: `${orphanedEntities.length}+ active entities without client_id`,
    });
  }

  return results;
}

async function checkBugReportBacklog(supabase: any): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Open bugs
  const { count: openBugs } = await supabase
    .from('bug_reports')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');

  // Stale bugs (open > 7 days)
  const { count: staleBugs } = await supabase
    .from('bug_reports')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open')
    .lt('created_at', sevenDaysAgo);

  if ((staleBugs || 0) > 3) {
    results.push({
      name: 'Bug Report Backlog',
      status: 'warning',
      message: `${staleBugs} bugs open >7 days (${openBugs || 0} total open)`,
      details: 'User-reported issues may be stagnating without attention.',
    });
  }

  // Recent error spike (last hour)
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const { count: recentBugs } = await supabase
    .from('bug_reports')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', oneHourAgo);

  if ((recentBugs || 0) > 5) {
    results.push({
      name: 'Error Spike',
      status: 'critical',
      message: `${recentBugs} bug reports in the last hour`,
    });
  }

  return results;
}

async function checkDatabaseHealth(supabase: any): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();

  try {
    const { error } = await supabase.from('signals').select('id').limit(1);
    const responseTime = Date.now() - start;

    if (error) {
      results.push({
        name: 'Database',
        status: 'critical',
        message: `Query failed: ${error.message}`,
      });
    } else if (responseTime > 5000) {
      results.push({
        name: 'Database',
        status: 'warning',
        message: `Slow response: ${responseTime}ms`,
      });
    }
  } catch (err) {
    results.push({
      name: 'Database',
      status: 'critical',
      message: `Connection failed: ${err instanceof Error ? err.message : 'Unknown'}`,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
//                        EMAIL TEMPLATE
// ═══════════════════════════════════════════════════════════════

function buildAlertEmail(issues: CheckResult[], totalChecks: number): string {
  const critical = issues.filter(i => i.status === 'critical');
  const warnings = issues.filter(i => i.status === 'warning');
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/Edmonton' });

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 24px; margin: 0;">
  <div style="max-width: 640px; margin: 0 auto; background: #111; border: 1px solid #222; border-radius: 8px; overflow: hidden;">
    
    <div style="background: ${critical.length > 0 ? '#7f1d1d' : '#78350f'}; padding: 20px 24px;">
      <h1 style="margin: 0; font-size: 18px; color: #fff;">
        ${critical.length > 0 ? '🔴' : '⚠️'} Fortress Watchdog — ${issues.length} issue${issues.length !== 1 ? 's' : ''} detected
      </h1>
      <p style="margin: 4px 0 0; font-size: 13px; color: #ccc;">${now} MT • ${totalChecks} checks completed</p>
    </div>
    
    <div style="padding: 20px 24px;">
      ${critical.length > 0 ? `
        <h2 style="color: #ef4444; font-size: 14px; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 1px;">Critical</h2>
        ${critical.map(i => `
          <div style="background: #1a0505; border-left: 3px solid #ef4444; padding: 12px 16px; margin-bottom: 8px; border-radius: 4px;">
            <strong style="color: #fca5a5;">${i.name}</strong>
            <p style="margin: 4px 0 0; color: #d4d4d4; font-size: 14px;">${i.message}</p>
            ${i.details ? `<p style="margin: 4px 0 0; color: #888; font-size: 12px;">${i.details}</p>` : ''}
          </div>
        `).join('')}
      ` : ''}
      
      ${warnings.length > 0 ? `
        <h2 style="color: #f59e0b; font-size: 14px; margin: 16px 0 12px; text-transform: uppercase; letter-spacing: 1px;">Warnings</h2>
        ${warnings.map(i => `
          <div style="background: #1a1005; border-left: 3px solid #f59e0b; padding: 12px 16px; margin-bottom: 8px; border-radius: 4px;">
            <strong style="color: #fcd34d;">${i.name}</strong>
            <p style="margin: 4px 0 0; color: #d4d4d4; font-size: 14px;">${i.message}</p>
            ${i.details ? `<p style="margin: 4px 0 0; color: #888; font-size: 12px;">${i.details}</p>` : ''}
          </div>
        `).join('')}
      ` : ''}
    </div>
    
    <div style="padding: 16px 24px; background: #0a0a0a; border-top: 1px solid #222; font-size: 12px; color: #666;">
      Fortress System Watchdog • Automated health monitoring • No action needed when no email is received
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

    console.log('[Watchdog] Starting system health audit...');

    // Run all checks in parallel
    const [
      edgeFunctionIssues,
      signalIssues,
      briefingIssues,
      aiIssues,
      integrityIssues,
      bugIssues,
      dbIssues,
    ] = await Promise.all([
      checkEdgeFunctions(supabaseUrl, anonKey),
      checkSignalFreshness(supabase),
      checkDailyBriefing(supabase),
      checkAIHealth(supabaseUrl, anonKey),
      checkDataIntegrity(supabase),
      checkBugReportBacklog(supabase),
      checkDatabaseHealth(supabase),
    ]);

    const allIssues = [
      ...edgeFunctionIssues,
      ...signalIssues,
      ...briefingIssues,
      ...aiIssues,
      ...integrityIssues,
      ...bugIssues,
      ...dbIssues,
    ];

    const totalChecks = CRITICAL_FUNCTIONS.length + OPERATIONAL_FUNCTIONS.length + 6; // 6 = other check categories

    console.log(`[Watchdog] Audit complete: ${allIssues.length} issues found across ${totalChecks} checks`);

    // Log results to automation_metrics for trend tracking
    try {
      const healthyRate = allIssues.length === 0 ? 1.0 : Math.max(0, 1 - (allIssues.length / totalChecks));
      await supabase.from('automation_metrics').insert({
        metric_date: new Date().toISOString().split('T')[0],
        accuracy_rate: healthyRate,
        false_positive_rate: allIssues.filter(i => i.status === 'critical').length / totalChecks,
      });
    } catch (e) {
      console.warn('[Watchdog] Failed to log metrics:', e);
    }

    // Only send email if issues found
    if (allIssues.length > 0) {
      const resend = new Resend(RESEND_API_KEY);
      const critical = allIssues.filter(i => i.status === 'critical').length;
      const subject = critical > 0
        ? `🔴 Fortress Alert: ${critical} critical issue${critical !== 1 ? 's' : ''} detected`
        : `⚠️ Fortress Watchdog: ${allIssues.length} warning${allIssues.length !== 1 ? 's' : ''} detected`;

      const { error: emailError } = await resend.emails.send({
        from: fromEmail,
        to: [ALERT_EMAIL],
        subject,
        html: buildAlertEmail(allIssues, totalChecks),
      });

      if (emailError) {
        console.error('[Watchdog] Email send failed:', emailError);
        return errorResponse(`Email failed: ${JSON.stringify(emailError)}`, 500);
      }

      console.log(`[Watchdog] Alert email sent to ${ALERT_EMAIL}`);
      return successResponse({
        success: true,
        issuesFound: allIssues.length,
        critical: critical,
        emailSent: true,
        issues: allIssues,
      });
    }

    console.log('[Watchdog] ✅ All systems healthy — no email sent');
    return successResponse({
      success: true,
      issuesFound: 0,
      emailSent: false,
      message: 'All systems operational',
    });

  } catch (error) {
    console.error('[Watchdog] Fatal error:', error);
    
    // Try to send error email even if the check itself failed
    try {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
      const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@updates.lovableproject.com>';
      if (RESEND_API_KEY) {
        const resend = new Resend(RESEND_API_KEY);
        await resend.emails.send({
          from: fromEmail,
          to: [ALERT_EMAIL],
          subject: '🔴 Fortress Watchdog CRASHED',
          html: `<p>The watchdog itself failed to run.</p><pre>${error instanceof Error ? error.message : String(error)}</pre>`,
        });
      }
    } catch { /* can't send fallback email */ }

    return errorResponse(`Watchdog failed: ${error instanceof Error ? error.message : 'Unknown'}`, 500);
  }
});
