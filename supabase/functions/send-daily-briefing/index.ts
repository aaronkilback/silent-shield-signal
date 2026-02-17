/**
 * Send Daily Briefing Email
 */

import { Resend } from "npm:resend@2.0.0";
import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { getCriticalDateContext } from "../_shared/anti-hallucination.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@updates.lovableproject.com>';

    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');

    const resend = new Resend(RESEND_API_KEY);
    const dateContext = getCriticalDateContext();

    console.log(`[DailyBriefing] Generating for ${dateContext.currentDateISO}`);

    const { data: briefingConfigs } = await supabase
      .from('scheduled_briefings')
      .select('*')
      .eq('is_active', true)
      .eq('briefing_type', 'daily_email');

    if (!briefingConfigs || briefingConfigs.length === 0) {
      return successResponse({ success: true, message: 'No active daily email briefings configured', sent: 0 });
    }

    const cutoff24h = new Date(Date.now() - 24 * 3600000).toISOString();

    const [
      { data: recentSignals },
      { data: openIncidents },
      { data: recentScans },
      { data: recentActions },
      { data: doctrineEntries },
    ] = await Promise.all([
      supabase.from('signals').select('id, category, severity, title, normalized_text, created_at, quality_score, relevance_score, triage_override, event_date, confidence')
        .gte('created_at', cutoff24h)
        .neq('status', 'false_positive')
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('incidents').select('id, priority, status, opened_at')
        .eq('status', 'open').limit(50),
      supabase.from('autonomous_scan_results').select('risk_score, findings, created_at')
        .order('created_at', { ascending: false }).limit(1),
      supabase.from('autonomous_actions_log').select('action_type, action_details, created_at')
        .gte('created_at', cutoff24h).limit(20),
      supabase.from('doctrine_library').select('title, content_text, content_type, tags')
        .eq('is_active', true).order('created_at', { ascending: false }).limit(30),
    ]);

    // Filter signals for briefing quality: exclude historical, low-quality, and low-relevance
    const briefingSignals = (recentSignals || []).filter((s: any) => {
      // Exclude historical signals
      if (s.triage_override === 'historical') return false;
      // Exclude signals with event dates > 90 days old
      if (s.event_date) {
        const eventDate = new Date(s.event_date);
        const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
        if (eventDate < ninetyDaysAgo) return false;
      }
      // Exclude low quality signals
      if (s.quality_score !== null && s.quality_score < 0.4) return false;
      // Exclude low relevance signals
      if (s.relevance_score !== null && s.relevance_score < 0.4) return false;
      return true;
    });

    const metrics = {
      signals_24h: briefingSignals.length,
      total_ingested_24h: (recentSignals || []).length,
      filtered_out: (recentSignals || []).length - briefingSignals.length,
      critical_signals: briefingSignals.filter((s: any) => s.severity === 'critical').length,
      high_signals: briefingSignals.filter((s: any) => s.severity === 'high').length,
      open_incidents: (openIncidents || []).length,
      risk_score: recentScans?.[0]?.risk_score || 0,
      autonomous_actions: (recentActions || []).length,
    };

    // DEDUP GUARD — use 20-hour lookback (timezone-safe)
    const dedupCutoff = new Date(Date.now() - 20 * 3600000).toISOString();
    const { data: alreadySent } = await supabase
      .from('autonomous_actions_log')
      .select('id')
      .eq('action_type', 'daily_email_briefing')
      .in('status', ['completed', 'partial'])
      .gte('created_at', dedupCutoff)
      .limit(1);

    if (alreadySent && alreadySent.length > 0) {
      console.log('[DailyBriefing] Already sent within 20h — dedup blocked');
      return successResponse({ success: true, message: 'Briefing already sent within 20 hours', sent: 0, deduplicated: true });
    }

    const hasNewActivity = metrics.signals_24h > 0 || metrics.open_incidents > 0 || metrics.autonomous_actions > 0;
    
    if (!hasNewActivity) {
      await supabase.from('autonomous_actions_log').insert({
        action_type: 'daily_email_briefing', trigger_source: 'cron',
        action_details: { skipped: true, reason: 'no_new_activity', date: dateContext.currentDateISO }, status: 'skipped',
      });

      for (const config of briefingConfigs) {
        await supabase.from('scheduled_briefings').update({ last_run_at: new Date().toISOString() }).eq('id', config.id);
      }

      return successResponse({ success: true, message: 'No new activity — briefing skipped', sent: 0, skipped: true });
    }

    // Generate doctrine line
    let doctrineLine = '';
    try {
      const coreEntries = (doctrineEntries || []).filter((d: any) => d.tags?.includes('core-10') && d.content_text);
      const otherEntries = (doctrineEntries || []).filter((d: any) => !d.tags?.includes('core-10') && d.content_text);
      const prioritized = coreEntries.length > 0 ? coreEntries : otherEntries;
      const doctrineContext = prioritized.map((d: any) => `- ${d.title}: ${d.content_text}`).join('\n');

      const doctrineResult = await callAiGateway({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: `You are the Silent Shield doctrine advisor. Pick ONE entry from the library and rephrase it as a sharp, memorable one-liner (max 20 words).\n\nSILENT SHIELD DOCTRINE LIBRARY:\n${doctrineContext}\n\nOUTPUT: JSON with one field "doctrine_line". Respond ONLY with valid JSON.` },
          { role: 'user', content: 'Generate today\'s doctrine line.' },
        ],
        functionName: 'send-daily-briefing/doctrine',
        extraBody: { temperature: 0.5 },
      });

      if (doctrineResult.content) {
        let content = doctrineResult.content.trim();
        if (content.startsWith('```')) content = content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        const parsed = JSON.parse(content);
        doctrineLine = parsed.doctrine_line || '';
      }
    } catch (err) {
      console.error('[DailyBriefing] Doctrine line generation failed:', err);
    }

    // Generate briefing content
    const briefingResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are Fortress AI, the senior intelligence officer for a corporate security operations center. Generate a daily security briefing email that reads like a classified intelligence product — not a dashboard summary.

CRITICAL RULES:
- Do NOT mention historical events (>90 days old) as current threats. They have already been filtered out.
- Do NOT pad the briefing with generic security advice. Every sentence must be grounded in TODAY's data.
- If there are few signals, say so honestly. A quiet day is valuable intelligence.
- Prioritize: What changed? What's new? What requires action?
- Name specific entities, locations, and categories. Vague language like "various threats were detected" is unacceptable.

Current date: ${dateContext.currentDateFormatted}, ${dateContext.currentTime24h} ${dateContext.currentTimezone}.

Structure:
1. SITUATION OVERVIEW (2-3 sentences — what is the overall posture and why)
2. KEY METRICS (bullet-style numbers with context, not just raw counts)
3. PRIORITY SIGNALS (top 3-5 actionable signals with specifics: what, where, severity, and why it matters)
4. EMERGING PATTERNS (any trends or clusters — if none, say "No notable patterns detected")
5. RECOMMENDED POSTURE (specific actions, not generic advice)

Tone: Calm, authoritative, measured. Like a senior intelligence officer delivering a classified briefing. Zero filler words.`,
        },
        {
          role: 'user',
          content: `Generate today's daily briefing.\n\nMETRICS:\n${JSON.stringify(metrics, null, 2)}\n\nACTIONABLE SIGNALS (filtered for quality and recency — ${briefingSignals.length} of ${(recentSignals || []).length} total):\n${JSON.stringify(briefingSignals.slice(0, 10).map((s: any) => ({ severity: s.severity, category: s.category, title: s.title, normalized_text: (s.normalized_text || '').substring(0, 200), confidence: s.confidence, quality_score: s.quality_score })), null, 2)}\n\nAUTONOMOUS ACTIONS:\n${JSON.stringify((recentActions || []).map((a: any) => a.action_type), null, 2)}`,
        },
      ],
      functionName: 'send-daily-briefing',
      extraBody: { max_tokens: 1500, temperature: 0.2 },
      dlqOnFailure: true,
      dlqPayload: { date: dateContext.currentDateISO, metrics },
    });

    if (briefingResult.error) {
      throw new Error(`AI generation failed: ${briefingResult.error}`);
    }

    const briefingText = briefingResult.content || 'Unable to generate briefing content.';

    const appUrl = Deno.env.get('APP_URL') || Deno.env.get('SITE_URL') || 'https://silent-shield-signal.lovable.app';
    const feedbackBaseUrl = `${appUrl}/briefing-feedback`;

    const emailHtml = buildBriefingEmail(briefingText, metrics, dateContext, doctrineLine, feedbackBaseUrl);

    let sentCount = 0;
    const errors: string[] = [];

    for (const config of briefingConfigs) {
      const recipients = config.recipient_emails || [];
      
      for (const email of recipients) {
        try {
          await resend.emails.send({
            from: fromEmail, to: [email],
            subject: `🛡️ Fortress Daily Briefing — ${dateContext.currentDateFormatted}`,
            html: emailHtml,
          });
          sentCount++;
        } catch (err) {
          console.error(`[DailyBriefing] Failed to send to ${email}:`, err);
          errors.push(`${email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      await supabase.from('scheduled_briefings').update({ last_run_at: new Date().toISOString() }).eq('id', config.id);
    }

    await supabase.from('autonomous_actions_log').insert({
      action_type: 'daily_email_briefing', trigger_source: 'cron',
      action_details: { sent_count: sentCount, errors, date: dateContext.currentDateISO },
      status: errors.length === 0 ? 'completed' : 'partial',
    });

    // Generate audio version of the daily briefing
    let audioUrl: string | null = null;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
      const audioResponse = await fetch(`${supabaseUrl}/functions/v1/generate-briefing-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          content: briefingText,
          title: `Daily Briefing ${dateContext.currentDateFormatted}`,
          user_id: 'system',
        }),
      });

      if (audioResponse.ok) {
        const audioResult = await audioResponse.json();
        audioUrl = audioResult.audio_url;

        // Record in audio_briefings table
        await supabase.from('audio_briefings').insert({
          title: `Daily Intelligence Briefing — ${dateContext.currentDateFormatted}`,
          content_text: briefingText,
          audio_url: audioUrl,
          source_type: 'daily_briefing',
          source_id: dateContext.currentDateISO,
          status: 'completed',
          chunks_processed: audioResult.chunks_processed || 1,
          duration_seconds: audioResult.duration_estimate || null,
          user_id: briefingConfigs[0]?.created_by || '00000000-0000-0000-0000-000000000000',
        });

        console.log(`[DailyBriefing] Audio briefing generated: ${audioUrl}`);
      } else {
        const errText = await audioResponse.text();
        console.error(`[DailyBriefing] Audio generation failed: ${errText}`);
      }
    } catch (audioErr) {
      console.error('[DailyBriefing] Audio generation error (non-blocking):', audioErr);
    }

    return successResponse({ success: true, sent: sentCount, audio_url: audioUrl, errors: errors.length > 0 ? errors : undefined, date: dateContext.currentDateISO });
  } catch (error) {
    console.error('[DailyBriefing] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});

function formatBriefingLines(text: string): string {
  return text.split('\n').map(line => {
    if (!line.trim()) return '<br>';
    if (line.trim().match(/^[A-Z\s]{4,}:?$/)) {
      return '<h3 style="color:#f1f5f9; font-size:13px; text-transform:uppercase; letter-spacing:1px; margin:20px 0 8px; border-bottom:1px solid #334155; padding-bottom:6px;">' + line.trim() + '</h3>';
    }
    if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
      return '<p style="margin:4px 0; padding-left:16px; color:#94a3b8;">› ' + line.trim().slice(2) + '</p>';
    }
    return '<p style="margin:6px 0;">' + line + '</p>';
  }).join('\n');
}

function buildBriefingEmail(
  briefingText: string, metrics: Record<string, number>,
  dateContext: { currentDateFormatted: string; currentTime24h: string; currentTimezone: string; currentDateISO: string },
  doctrineLine: string, feedbackBaseUrl: string
): string {
  const riskColor = metrics.risk_score >= 70 ? '#dc2626' : metrics.risk_score >= 40 ? '#f59e0b' : '#059669';
  const riskLabel = metrics.risk_score >= 70 ? 'ELEVATED' : metrics.risk_score >= 40 ? 'MODERATE' : 'NORMAL';

  const thumbsUpUrl = `${feedbackBaseUrl}?f=positive&d=${dateContext.currentDateISO}`;
  const thumbsDownUrl = `${feedbackBaseUrl}?f=negative&d=${dateContext.currentDateISO}`;

  const doctrineSection = doctrineLine ? `
    <div style="padding:16px 30px; border-top:1px solid #334155; text-align:center;">
      <p style="color:#94a3b8; font-size:13px; margin:0; line-height:1.6; font-style:italic;">"${doctrineLine}"</p>
    </div>` : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#0f172a; font-family: 'Segoe UI', Arial, sans-serif;">
  <div style="max-width:600px; margin:0 auto; background:#1e293b; border-radius:12px; overflow:hidden; margin-top:20px; margin-bottom:20px;">
    <div style="background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding:30px 30px 20px; border-bottom:1px solid #334155;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:40px; height:40px; background:linear-gradient(135deg, #3b82f6, #06b6d4); border-radius:8px; display:flex; align-items:center; justify-content:center;">
          <span style="font-size:20px;">🛡️</span>
        </div>
        <div>
          <h1 style="color:#f1f5f9; margin:0; font-size:20px; font-weight:600;">Fortress Daily Briefing</h1>
          <p style="color:#94a3b8; margin:4px 0 0; font-size:13px;">${dateContext.currentDateFormatted} · ${dateContext.currentTime24h} ${dateContext.currentTimezone}</p>
        </div>
      </div>
    </div>
    <div style="padding:16px 30px; background:${riskColor}15; border-bottom:1px solid #334155;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:10px; height:10px; background:${riskColor}; border-radius:50%;"></div>
        <span style="color:${riskColor}; font-weight:600; font-size:14px;">THREAT POSTURE: ${riskLabel}</span>
        <span style="color:#64748b; font-size:13px; margin-left:auto;">Score: ${metrics.risk_score}/100</span>
      </div>
    </div>
    <div style="padding:20px 30px; display:flex; gap:12px; border-bottom:1px solid #334155;">
      <div style="flex:1; background:#0f172a; border-radius:8px; padding:12px; text-align:center;">
        <div style="color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Signals</div>
        <div style="color:#f1f5f9; font-size:24px; font-weight:700; margin-top:4px;">${metrics.signals_24h}</div>
      </div>
      <div style="flex:1; background:#0f172a; border-radius:8px; padding:12px; text-align:center;">
        <div style="color:#94a3b8; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Incidents</div>
        <div style="color:#f1f5f9; font-size:24px; font-weight:700; margin-top:4px;">${metrics.open_incidents}</div>
      </div>
      <div style="flex:1; background:#0f172a; border-radius:8px; padding:12px; text-align:center;">
        <div style="color:#dc2626; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">Critical</div>
        <div style="color:#dc2626; font-size:24px; font-weight:700; margin-top:4px;">${metrics.critical_signals}</div>
      </div>
    </div>
    <div style="padding:24px 30px; color:#cbd5e1; font-size:14px; line-height:1.7;">
      ${formatBriefingLines(briefingText)}
    </div>
    ${doctrineSection}
    <div style="padding:20px 30px; border-top:1px solid #334155; text-align:center;">
      <p style="color:#64748b; font-size:12px; margin:0 0 12px; text-transform:uppercase; letter-spacing:0.5px;">Was this briefing useful?</p>
      <div style="display:inline-flex; gap:16px;">
        <a href="${thumbsUpUrl}" style="display:inline-block; padding:10px 24px; background:#059669; color:#fff; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">👍 Useful</a>
        <a href="${thumbsDownUrl}" style="display:inline-block; padding:10px 24px; background:#334155; color:#94a3b8; text-decoration:none; border-radius:8px; font-size:14px; font-weight:600;">👎 Not Useful</a>
      </div>
      <p style="color:#475569; font-size:11px; margin:10px 0 0;">Your feedback trains Fortress to deliver better intelligence.</p>
    </div>
    <div style="padding:20px 30px; background:#0f172a; border-top:1px solid #334155; text-align:center;">
      <p style="color:#475569; font-size:11px; margin:0;">Automated intelligence briefing from Fortress AI · Delivered ${dateContext.currentDateFormatted}</p>
      <p style="color:#334155; font-size:10px; margin:8px 0 0;">To adjust delivery preferences, update your scheduled briefings in Fortress.</p>
    </div>
  </div>
</body>
</html>`;
}