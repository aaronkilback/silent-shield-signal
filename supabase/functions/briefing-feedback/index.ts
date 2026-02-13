/**
 * Briefing Feedback Handler
 * 
 * Lightweight endpoint for email briefing feedback (thumbs up/down links).
 * Records feedback and triggers learning profile updates.
 * Returns a simple HTML thank-you page.
 */

import { createServiceClient, corsHeaders, handleCors } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const supabase = createServiceClient();

    // Support both GET (email link clicks) and POST (API calls)
    let briefingId: string | null = null;
    let feedback: string | null = null;
    let date: string | null = null;
    let userId: string | null = null;
    let notes: string | null = null;
    let correction: string | null = null;
    let reasonContext: Record<string, string> | null = null;

    if (req.method === 'GET') {
      // From email link clicks
      briefingId = url.searchParams.get('id');
      feedback = url.searchParams.get('f'); // 'positive' or 'negative'
      date = url.searchParams.get('d');
      userId = url.searchParams.get('u');
    } else {
      const body = await req.json();
      briefingId = body.briefingId || body.objectId;
      feedback = body.feedback;
      date = body.date;
      userId = body.userId;
      notes = body.notes;
      correction = body.correction;
      // Accept contextual reason from in-app feedback
      reasonContext = body.feedbackContext || null;
      if (reasonContext && !notes && reasonContext.reason_label) {
        notes = reasonContext.reason_label;
      }
    }

    if (!feedback) {
      return new Response('Missing feedback parameter', { status: 400, headers: corsHeaders });
    }

    // Normalize feedback values
    const normalizedFeedback = feedback === 'up' || feedback === 'positive' || feedback === 'relevant' 
      ? 'positive' 
      : 'negative';

    console.log(`[BriefingFeedback] ${normalizedFeedback} for briefing ${briefingId || date || 'unknown'}`);

    // Check for duplicate feedback (same user, same briefing, same day)
    if (briefingId || date) {
      const { data: existing } = await supabase
        .from('feedback_events')
        .select('id')
        .eq('object_type', 'daily_briefing')
        .eq('feedback', normalizedFeedback)
        .eq('object_id', briefingId || `briefing_${date}`)
        .limit(1);

      if (existing && existing.length > 0) {
        console.log('[BriefingFeedback] Duplicate feedback — already recorded');
        if (req.method === 'GET') {
          return renderThankYouPage('already_recorded');
        }
        return new Response(JSON.stringify({ success: true, message: 'Already recorded' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Store feedback
    const objectId = briefingId || `briefing_${date || new Date().toISOString().slice(0, 10)}`;
    
    await supabase.from('feedback_events').insert({
      object_type: 'daily_briefing',
      object_id: objectId,
      feedback: normalizedFeedback,
      user_id: userId || null,
      notes: notes || null,
      correction: correction || null,
      source_function: 'send-daily-briefing',
      feedback_context: {
        date: date || new Date().toISOString().slice(0, 10),
        source: req.method === 'GET' ? 'email_link' : 'api',
        ...(reasonContext || {}),
      },
    });

    // Update learning profiles
    await upsertBriefingLearning(supabase, normalizedFeedback, date);

    // Log learning action
    await supabase.from('universal_learning_log').insert({
      object_type: 'daily_briefing',
      learning_action: `briefing_feedback_${normalizedFeedback}`,
      profile_types_updated: ['briefing_quality', `${normalizedFeedback === 'positive' ? 'approved' : 'rejected'}_briefing_patterns`],
      details: { feedback: normalizedFeedback, date, source: req.method === 'GET' ? 'email' : 'api' },
    });

    console.log(`[BriefingFeedback] Recorded and learning profiles updated`);

    // Return HTML page for email clicks, JSON for API calls
    if (req.method === 'GET') {
      return renderThankYouPage(normalizedFeedback);
    }

    return new Response(JSON.stringify({ success: true, feedback: normalizedFeedback }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[BriefingFeedback] Error:', error);
    if (req.method === 'GET') {
      return renderThankYouPage('error');
    }
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function upsertBriefingLearning(supabase: ReturnType<typeof createServiceClient>, feedback: string, date?: string | null) {
  try {
    const { data: existing } = await supabase
      .from('learning_profiles')
      .select('*')
      .eq('profile_type', 'briefing_quality')
      .single();

    const newFeatures: Record<string, number> = {
      [`feedback_${feedback}`]: 1,
      total_briefing_feedback: 1,
    };

    if (existing) {
      const features = (existing.features as Record<string, number>) || {};
      Object.entries(newFeatures).forEach(([k, v]) => { features[k] = (features[k] || 0) + v; });
      await supabase.from('learning_profiles').update({
        features,
        sample_count: ((existing.sample_count as number) || 0) + 1,
        last_updated: new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('learning_profiles').insert({
        profile_type: 'briefing_quality',
        features: newFeatures,
        sample_count: 1,
      });
    }
  } catch (err) {
    console.error('[BriefingFeedback] Learning profile error:', err);
  }
}

function renderThankYouPage(status: string): Response {
  const isPositive = status === 'positive';
  const isAlready = status === 'already_recorded';
  const isError = status === 'error';

  const emoji = isError ? '⚠️' : isAlready ? '✅' : isPositive ? '👍' : '👎';
  const title = isError ? 'Something went wrong' : isAlready ? 'Already Recorded' : 'Thank You';
  const message = isError
    ? 'We couldn\'t record your feedback. Please try again later.'
    : isAlready
    ? 'Your feedback for this briefing was already recorded. We appreciate your input!'
    : isPositive
    ? 'Your positive feedback helps us refine briefing quality. We\'ll keep delivering actionable intelligence.'
    : 'Your feedback is noted. We\'ll adjust future briefings to better meet your needs.';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fortress - Briefing Feedback</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;">
  <div style="background:#1e293b;border-radius:16px;padding:48px;text-align:center;max-width:420px;box-shadow:0 25px 50px rgba(0,0,0,0.5);">
    <div style="font-size:48px;margin-bottom:16px;">${emoji}</div>
    <h1 style="color:#f1f5f9;font-size:24px;margin:0 0 12px;">${title}</h1>
    <p style="color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 24px;">${message}</p>
    <div style="width:40px;height:2px;background:linear-gradient(90deg,#3b82f6,#06b6d4);margin:0 auto 16px;border-radius:1px;"></div>
    <p style="color:#475569;font-size:12px;margin:0;">Fortress AI · Intelligence That Learns</p>
  </div>
</body></html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
