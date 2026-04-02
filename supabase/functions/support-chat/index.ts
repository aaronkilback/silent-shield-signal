import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway, callAiGatewayStream } from "../_shared/ai-gateway.ts";
import { validateMessages, validateString, validateEnum, validateAll } from "../_shared/input-validation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface BugReport {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  steps_to_reproduce?: string;
  expected_behavior?: string;
  actual_behavior?: string;
}

function detectBugReport(messages: any[]): boolean {
  if (!messages || messages.length === 0) return false;
  const lastUserMessage = messages.filter((m: any) => m.role === 'user').pop();
  if (!lastUserMessage) return false;
  
  const content = typeof lastUserMessage.content === 'string' 
    ? lastUserMessage.content.toLowerCase() 
    : '';
  
  const bugPatterns = [
    /\bbug\b/i, /\bissue\b/i, /\berror\b/i, /\bbroken\b/i,
    /\bdoesn'?t work/i, /\bnot working/i, /\bcrash/i, /\bfail/i,
    /\bproblem\b/i, /\bglitch/i, /\bwrong\b/i, /\bincorrect/i,
  ];
  
  return bugPatterns.some(pattern => pattern.test(content));
}

async function extractBugDetails(messages: any[]): Promise<BugReport | null> {
  try {
    const result = await callAiGateway({
      model: "google/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract bug report details from the conversation. Return a JSON object with:
{
  "title": "Brief title (max 100 chars)",
  "description": "Full description of the issue",
  "severity": "low|medium|high|critical",
  "steps_to_reproduce": "Steps if mentioned",
  "expected_behavior": "What should happen",
  "actual_behavior": "What actually happens",
  "is_complete": true/false
}
Return ONLY valid JSON, no markdown.`
        },
        ...messages.slice(-10),
      ],
      functionName: 'support-chat:extract-bug',
      extraBody: { response_format: { type: "json_object" } },
    });

    if (!result.content) return null;
    
    const parsed = JSON.parse(result.content);
    if (!parsed.is_complete) return null;
    
    return {
      title: parsed.title || "Bug report from chat",
      description: parsed.description || "",
      severity: parsed.severity || "medium",
      steps_to_reproduce: parsed.steps_to_reproduce,
      expected_behavior: parsed.expected_behavior,
      actual_behavior: parsed.actual_behavior,
    };
  } catch (error) {
    console.error("Error extracting bug details:", error);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { messages, action, bugData } = body;

    // Input validation
    const validation = validateAll(
      validateMessages(messages, 'messages', { required: !action, maxMessages: 50 }),
      validateString(action, 'action', { maxLength: 50 }),
    );
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate bug data if submitting
    if (action === 'submit_bug' && bugData) {
      const bugValidation = validateAll(
        validateString(bugData.title, 'bugData.title', { required: true, maxLength: 200 }),
        validateString(bugData.description, 'bugData.description', { required: true, maxLength: 5000 }),
        validateEnum(bugData.severity, 'bugData.severity', ['low', 'medium', 'high', 'critical']),
      );
      if (!bugValidation.valid) {
        return new Response(
          JSON.stringify({ error: bugValidation.error }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    let userId: string | null = null;
    let userEmail: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (token !== anonKey) {
        try {
          const { data: { user } } = await supabase.auth.getUser(token);
          if (user) {
            userId = user.id;
            userEmail = user.email || null;
          }
        } catch {}
      }
    }

    // Handle bug submission
    if (action === 'submit_bug') {
      if (!bugData) {
        return new Response(
          JSON.stringify({ error: "Bug data required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let fullDescription = bugData.description || '';
      if (bugData.steps_to_reproduce) {
        fullDescription += `\n\n**Steps to Reproduce:**\n${bugData.steps_to_reproduce}`;
      }
      if (bugData.expected_behavior) {
        fullDescription += `\n\n**Expected Behavior:**\n${bugData.expected_behavior}`;
      }
      if (bugData.actual_behavior) {
        fullDescription += `\n\n**Actual Behavior:**\n${bugData.actual_behavior}`;
      }

      const { data: bug, error: bugError } = await supabase
        .from('bug_reports')
        .insert({
          user_id: userId,
          reporter_email: userEmail || bugData.email,
          title: bugData.title,
          description: fullDescription,
          severity: bugData.severity || 'medium',
          page_url: bugData.page_url,
          browser_info: bugData.browser_info,
          conversation_log: messages,
          workflow_stage: 'reported',
          status: 'open',
        })
        .select('id')
        .single();

      if (bugError) {
        console.error("Bug submission error:", bugError);
        return new Response(
          JSON.stringify({ error: "Failed to submit bug report" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          bug_id: bug.id,
          message: "Bug report submitted successfully." 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fast path for simple acknowledgments
    const isSimpleAcknowledgment = (msgs: any[]): boolean => {
      if (!msgs || msgs.length === 0) return false;
      const lastUserMessage = msgs.filter((m: any) => m.role === 'user').pop();
      if (!lastUserMessage) return false;
      
      const content = typeof lastUserMessage.content === 'string' 
        ? lastUserMessage.content.trim().toLowerCase() 
        : '';
      
      if (content.length > 50) return false;
      
      const patterns = [
        /^(ok|okay|k|kk)$/i,
        /^(great|good|thanks|thank you|cool|perfect|awesome)$/i,
        /^(sounds good|got it|understood|roger|noted)$/i,
        /^(yes|yeah|yep|sure|certainly)$/i,
        /^(👍|👌|✅|💯)+$/,
      ];
      
      return patterns.some(pattern => pattern.test(content));
    };

    if (isSimpleAcknowledgment(messages)) {
      const ackResult = await callAiGatewayStream({
        model: "google/gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a helpful support assistant. The user sent a simple acknowledgment. Respond BRIEFLY - just 1-2 short sentences. Simply acknowledge and offer to help with anything else.`
          },
          ...messages.slice(-3),
        ],
        functionName: 'support-chat:ack',
        timeoutMs: 10000,
      });

      if (ackResult.stream) {
        return new Response(ackResult.stream, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }
    }

    // Check for bug report
    const isBugReport = detectBugReport(messages);
    let bugReportContext = '';
    
    if (isBugReport) {
      const bugDetails = await extractBugDetails(messages);
      
      if (bugDetails) {
        bugReportContext = `\n\n**BUG DETECTION ACTIVE**
You've detected enough information to create a bug report:
- Title: ${bugDetails.title}
- Severity: ${bugDetails.severity}
Tell the user you have enough info and ask if they want to add anything else or submit.`;
      } else {
        bugReportContext = `\n\n**BUG DETECTION ACTIVE**
The user seems to be reporting an issue. Ask clarifying questions about:
1. What exactly isn't working?
2. What were they trying to do?
3. What happened instead?`;
      }
    }

    // Fetch knowledge base
    const { data: kbArticles } = await supabase
      .from('knowledge_base_articles')
      .select('title, summary, tags')
      .eq('is_published', true)
      .limit(30);

    const kbContext = kbArticles?.map(article => 
      `## ${article.title}\n${article.summary}`
    ).join('\n\n') || '';

    const systemPrompt = `You are a helpful support assistant for FORTRESS, an AI-powered security operations platform.

PLATFORM OVERVIEW:
FORTRESS helps organizations monitor, detect, and respond to security threats through autonomous intelligence gathering.

KEY FEATURES:
- Signals: Security events from OSINT sources
- Incidents: Escalated events requiring investigation
- Entities: Tracked persons, organizations, locations
- Clients: Multi-tenant management
- Task Force: Multi-agent collaborative operations
- Threat Radar: Advanced visualization
- Travel Security: Personnel protection
- AI Agents: Specialized intelligence agents

KNOWLEDGE BASE:
${kbContext}
${bugReportContext}

Be helpful, concise, and professional. If you don't know something, say so.`;

    const streamResult = await callAiGatewayStream({
      model: "google/gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.slice(-20),
      ],
      functionName: 'support-chat',
    });

    if (streamResult.error) {
      console.error("AI Gateway stream error:", streamResult.error);
      throw new Error(`AI Gateway error: ${streamResult.error}`);
    }

    return new Response(streamResult.stream!, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });

  } catch (error) {
    console.error("Support chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
