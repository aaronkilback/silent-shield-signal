/**
 * Process Bug Report
 * AI triage + auto-remediation for user-submitted bug reports.
 * Called fire-and-forget from BugReportDialog after insert.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json();
    const { bug_id, title, description, severity, page_url } = body;

    if (!bug_id || !title) {
      return errorResponse('bug_id and title are required', 400);
    }

    const supabase = createServiceClient();
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('[ProcessBug] OPENAI_API_KEY not configured');
      return errorResponse('OPENAI_API_KEY not configured', 500);
    }

    const triagePrompt = `You are the Fortress platform QA system. A user just reported a bug.

Title: "${title}"
Description: "${description}"
Severity: "${severity}"
Page: "${page_url}"

Respond with JSON only:
{
  "category": "signal_pipeline | agent_system | report_generation | ui_display | authentication | data_quality | performance | vip_travel | briefing | unknown",
  "auto_remediate": true or false,
  "remediation_action": "function name to invoke or null",
  "remediation_params": {} or null,
  "plain_english_diagnosis": "One sentence: what broke and likely why",
  "estimated_severity": "critical | high | medium | low",
  "affects_client_facing": true or false,
  "watchdog_note": "One sentence for the Watchdog daily email"
}

Auto-remediable issues:
- Signal feed blank → monitor-rss-sources
- Daily briefing missing → generate-daily-briefing
- Duplicate signals → cleanup-duplicate-signals
- Agent not responding → system-ops with action: health-check
- Sources not updating → monitor-rss-sources`;

    // AI triage
    let triage: any;
    try {
      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: triagePrompt },
            { role: 'user', content: `Bug report submitted. Title: ${title}. Description: ${description}` }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!aiResponse.ok) throw new Error(`OpenAI error ${aiResponse.status}`);
      const aiData = await aiResponse.json();
      triage = JSON.parse(aiData.choices?.[0]?.message?.content || '{}');
    } catch (e: any) {
      console.error('[ProcessBug] AI triage failed:', e.message);
      triage = {
        category: 'unknown',
        auto_remediate: false,
        remediation_action: null,
        plain_english_diagnosis: 'Unable to auto-diagnose — needs manual review.',
        estimated_severity: severity || 'medium',
        affects_client_facing: false,
        watchdog_note: `User reported: ${title}`
      };
    }

    // Attempt auto-remediation if flagged
    if (triage.auto_remediate && triage.remediation_action) {
      try {
        const remResult = await supabase.functions.invoke(triage.remediation_action, {
          body: triage.remediation_params || {}
        });

        await supabase.from('bug_reports').update({
          status: remResult.error ? 'remediation_failed' : 'auto_resolved',
          resolution_notes: remResult.error
            ? `Auto-remediation attempted but failed: ${remResult.error.message}`
            : `Auto-resolved by invoking ${triage.remediation_action}`,
          resolved_at: remResult.error ? null : new Date().toISOString()
        }).eq('id', bug_id);

        console.log(`[ProcessBug] Auto-remediation ${remResult.error ? 'FAILED' : 'SUCCESS'}: ${triage.remediation_action}`);
      } catch (e: any) {
        console.error('[ProcessBug] Auto-remediation exception:', e.message);
      }
    }

    // Store triage results
    await supabase.from('bug_reports').update({
      ai_category: triage.category,
      ai_diagnosis: triage.plain_english_diagnosis,
      ai_severity: triage.estimated_severity,
      affects_client_facing: triage.affects_client_facing,
      watchdog_note: triage.watchdog_note,
      triaged_at: new Date().toISOString()
    }).eq('id', bug_id);

    // Escalate critical client-facing bugs to watchdog learnings
    if (triage.affects_client_facing && triage.estimated_severity === 'critical') {
      await supabase.from('watchdog_learnings').insert({
        finding_title: `User-reported critical bug: ${title}`,
        finding_detail: triage.plain_english_diagnosis,
        severity: 'critical',
        source: 'user_bug_report'
      });
      console.log('[ProcessBug] Escalated critical client-facing bug to watchdog learnings');
    }

    console.log(`[ProcessBug] Triage complete for bug ${bug_id}: category=${triage.category}, severity=${triage.estimated_severity}, client_facing=${triage.affects_client_facing}`);

    return successResponse({
      success: true,
      bug_id,
      category: triage.category,
      severity: triage.estimated_severity,
      affects_client_facing: triage.affects_client_facing,
      auto_remediated: triage.auto_remediate && !!triage.remediation_action
    });
  } catch (error: any) {
    console.error('[ProcessBug] Fatal error:', error);
    return errorResponse(`process-bug-report failed: ${error.message}`, 500);
  }
});
