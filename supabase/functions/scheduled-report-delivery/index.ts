/**
 * Scheduled Report Delivery
 * 
 * Triggered by cron. Checks report_schedules, generates reports for those
 * that are due, persists them, and emails PDFs to recipients via Resend.
 */

import { Resend } from "npm:resend@2.0.0";
import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'Fortress AI <notifications@updates.lovableproject.com>';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const resend = new Resend(RESEND_API_KEY);
    const now = new Date();

    // Find schedules that are due
    const { data: dueSchedules, error: schedError } = await supabase
      .from('report_schedules')
      .select('*, clients(name, industry, locations, high_value_assets)')
      .eq('is_active', true)
      .lte('next_run_at', now.toISOString());

    if (schedError) throw schedError;
    if (!dueSchedules || dueSchedules.length === 0) {
      console.log('[ScheduledReports] No schedules due');
      return successResponse({ success: true, processed: 0 });
    }

    console.log(`[ScheduledReports] Processing ${dueSchedules.length} due schedules`);

    let processed = 0;
    let errors = 0;

    for (const schedule of dueSchedules) {
      try {
        const periodDays = schedule.config?.period_days || 7;
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - periodDays);

        // Generate report by calling the appropriate generation function
        const functionName = schedule.report_type === 'executive' 
          ? 'generate-executive-report' 
          : 'generate-report';

        const bodyPayload = schedule.report_type === 'executive'
          ? { client_id: schedule.client_id, period_days: periodDays }
          : { report_type: '72h-snapshot', period_hours: periodDays * 24 };

        const reportResponse = await fetch(
          `${supabaseUrl}/functions/v1/${functionName}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(bodyPayload),
          }
        );

        if (!reportResponse.ok) {
          console.error(`[ScheduledReports] Report generation failed for schedule ${schedule.id}: HTTP ${reportResponse.status}`);
          errors++;
          continue;
        }

        const reportData = await reportResponse.json();
        const htmlContent = reportData.html || reportData.data?.html;

        if (!htmlContent) {
          console.error(`[ScheduledReports] No HTML content from report generation for schedule ${schedule.id}`);
          errors++;
          continue;
        }

        const clientName = schedule.clients?.name || 'Unknown Client';
        const reportTitle = `${schedule.report_type === 'executive' ? 'Executive Intelligence Report' : '72-Hour Risk Snapshot'} — ${clientName}`;
        const reportDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

        // Persist the report
        await supabase.from('generated_reports').insert({
          user_id: schedule.user_id,
          client_id: schedule.client_id,
          report_type: schedule.report_type,
          title: `${reportTitle} (${reportDate})`,
          period_start: periodStart.toISOString(),
          period_end: now.toISOString(),
          html_content: htmlContent,
          metadata: { 
            scheduled: true, 
            schedule_id: schedule.id,
            client_name: clientName,
          },
        });

        // Email to recipients
        if (schedule.email_recipients && schedule.email_recipients.length > 0) {
          const emailHtml = buildScheduledReportEmail(reportTitle, reportDate, clientName, schedule.report_type);

          for (const recipient of schedule.email_recipients) {
            try {
              await resend.emails.send({
                from: fromEmail,
                to: recipient,
                subject: `📊 ${reportTitle} — ${reportDate}`,
                html: emailHtml,
                attachments: [{
                  filename: `${schedule.report_type}-report-${now.toISOString().split('T')[0]}.html`,
                  content: Buffer.from(htmlContent).toString('base64'),
                  contentType: 'text/html',
                }],
              });
              console.log(`[ScheduledReports] Sent to ${recipient}`);
            } catch (emailErr) {
              console.error(`[ScheduledReports] Failed to email ${recipient}:`, emailErr);
            }
          }
        }

        // Calculate next run
        const nextRun = calculateNextRun(schedule.frequency, schedule.day_of_week, schedule.hour_utc);

        await supabase
          .from('report_schedules')
          .update({ last_run_at: now.toISOString(), next_run_at: nextRun.toISOString() })
          .eq('id', schedule.id);

        processed++;
        console.log(`[ScheduledReports] Completed schedule ${schedule.id}, next run: ${nextRun.toISOString()}`);

      } catch (scheduleError) {
        console.error(`[ScheduledReports] Error processing schedule ${schedule.id}:`, scheduleError);
        errors++;
      }
    }

    return successResponse({ success: true, processed, errors });
  } catch (error) {
    console.error('[ScheduledReports] Fatal error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Scheduled report delivery failed', 500);
  }
});

function calculateNextRun(frequency: string, dayOfWeek: number, hourUtc: number): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);

  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly':
      do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() !== dayOfWeek);
      break;
    case 'biweekly':
      do { next.setUTCDate(next.getUTCDate() + 1); } while (next.getUTCDay() !== dayOfWeek);
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      break;
    default:
      next.setUTCDate(next.getUTCDate() + 7);
  }
  return next;
}

function buildScheduledReportEmail(title: string, date: string, clientName: string, reportType: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="background:linear-gradient(135deg,#1a1a1a,#0f172a);border-radius:12px;padding:32px;border:1px solid #2a2a2a;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">FORTRESS</div>
        <div style="font-size:11px;color:#00d9ff;letter-spacing:3px;text-transform:uppercase;margin-top:4px;">Intelligence Platform</div>
      </div>
      <div style="border-top:2px solid #00d9ff;margin:16px 0;"></div>
      <h2 style="color:#ffffff;font-size:18px;margin:16px 0 8px;">${title}</h2>
      <p style="color:#9ca3af;font-size:14px;margin:0 0 16px;">Generated: ${date}</p>
      <p style="color:#d1d5db;font-size:14px;line-height:1.6;">
        Your scheduled ${reportType === 'executive' ? 'Executive Intelligence' : 'Risk Snapshot'} report for 
        <strong style="color:#ffffff;">${clientName}</strong> is attached to this email as an HTML file.
      </p>
      <p style="color:#9ca3af;font-size:13px;margin-top:24px;">
        Open the attached file in any browser for the full interactive report. 
        You can also find this report in your Fortress archive.
      </p>
    </div>
    <p style="color:#4b5563;font-size:11px;text-align:center;margin-top:16px;">
      Fortress Intelligence Platform • Automated Report Delivery
    </p>
  </div>
</body>
</html>`;
}
