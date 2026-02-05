import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface BlockedTerm {
  id: string;
  term: string;
  category: string;
  severity: string;
  is_regex: boolean;
}

interface ContentCheckResult {
  allowed: boolean;
  violations: Array<{
    term: string;
    category: string;
    severity: string;
  }>;
  action: 'allow' | 'warn' | 'block' | 'escalate';
  message?: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const authHeader = req.headers.get("Authorization");
    
    const supabase = createServiceClient();

    // Get user from auth header
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    const { content, content_type, tenant_id, action_type } = await req.json();

    if (!content) {
      return errorResponse("Content is required", 400);
    }

    // Rate limit check if user is authenticated
    if (userId && action_type) {
      const { data: withinLimit } = await supabase.rpc('check_rate_limit', {
        p_user_id: userId,
        p_action_type: action_type,
        p_max_requests: 60, // 60 requests per window
        p_window_minutes: 5  // 5 minute window
      });

      if (withinLimit === false) {
        console.log(`[Guardian] Rate limit exceeded for user ${userId}, action: ${action_type}`);
        return new Response(
          JSON.stringify({ 
            allowed: false, 
            action: 'block',
            message: "Rate limit exceeded. Please slow down and try again in a few minutes.",
            violations: [{ term: 'rate_limit', category: 'rate_limit', severity: 'block' }]
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Fetch active blocked terms
    const { data: blockedTerms, error: termsError } = await supabase
      .from('blocked_terms')
      .select('id, term, category, severity, is_regex')
      .eq('is_active', true);

    if (termsError) {
      console.error('[Guardian] Error fetching blocked terms:', termsError);
      // Fail open - allow content if we can't check
      return successResponse({ allowed: true, violations: [], action: 'allow' });
    }

    // Check content against blocked terms
    const contentLower = content.toLowerCase();
    const violations: Array<{ term: string; category: string; severity: string; termId: string }> = [];

    for (const term of (blockedTerms || []) as BlockedTerm[]) {
      let matched = false;

      if (term.is_regex) {
        try {
          const regex = new RegExp(term.term, 'i');
          matched = regex.test(content);
        } catch (e) {
          console.error(`[Guardian] Invalid regex pattern: ${term.term}`);
        }
      } else {
        matched = contentLower.includes(term.term.toLowerCase());
      }

      if (matched) {
        violations.push({
          term: term.term,
          category: term.category,
          severity: term.severity,
          termId: term.id
        });
      }
    }

    // Determine action based on highest severity violation
    let action: 'allow' | 'warn' | 'block' | 'escalate' = 'allow';
    let message: string | undefined;

    if (violations.length > 0) {
      const severityOrder = { 'warning': 1, 'block': 2, 'escalate': 3 };
      const maxSeverity = violations.reduce((max, v) => 
        severityOrder[v.severity as keyof typeof severityOrder] > severityOrder[max as keyof typeof severityOrder] 
          ? v.severity 
          : max
      , 'warning');

      if (maxSeverity === 'escalate') {
        action = 'escalate';
        message = "This content has been flagged for review. Severe policy violations may result in account action.";
      } else if (maxSeverity === 'block') {
        action = 'block';
        message = "This content cannot be posted as it violates our content policy.";
      } else {
        action = 'warn';
        message = "Please review your message. It may contain sensitive information.";
      }

      // Record violation if user is authenticated
      if (userId) {
        const excerpt = content.length > 200 ? content.substring(0, 200) + '...' : content;
        
        for (const violation of violations) {
          await supabase.rpc('record_violation', {
            p_user_id: userId,
            p_tenant_id: tenant_id || null,
            p_content_type: content_type || 'chat_message',
            p_content_excerpt: excerpt,
            p_category: violation.category,
            p_severity: violation.severity,
            p_matched_pattern: violation.term
          });
        }

        console.log(`[Guardian] Recorded ${violations.length} violation(s) for user ${userId}, action: ${action}`);
      }
    }

    const result: ContentCheckResult = {
      allowed: action === 'allow' || action === 'warn',
      violations: violations.map(v => ({ term: v.term, category: v.category, severity: v.severity })),
      action,
      message
    };

    return successResponse(result);

  } catch (error) {
    console.error("[Guardian] Error:", error);
    // Fail open on errors
    return successResponse({ allowed: true, violations: [], action: 'allow' });
  }
});
