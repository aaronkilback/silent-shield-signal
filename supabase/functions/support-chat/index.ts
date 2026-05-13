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
      model: "gemini-2.5-flash",
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
        model: "gemini-2.5-flash",
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

    // ── Live platform context injection ─────────────────────────
    // If the user's most recent message references a specific signal,
    // brief, or incident, prefetch it (tenant-scoped) and inject the
    // verified state into the system prompt so the assistant can answer
    // from real data rather than guess. The user never has to copy-paste
    // signal text — pasting the ID is enough.
    let liveContext = '';
    const lastUserText = (() => {
      const last = messages?.slice().reverse().find((m: any) => m.role === 'user');
      return typeof last?.content === 'string' ? last.content : '';
    })();

    // Signal number pattern: SIG-2026-001543 (8-char hex prefix also tolerated)
    const sigNumbers = Array.from(new Set((lastUserText.match(/SIG-\d{4}-\d{6}/gi) || []).map((s: string) => s.toUpperCase())));
    // Tenant scoping will be added when CRT-as-tenant lands. For now any
    // authenticated user (or service-role test call) can see any signal.
    if (sigNumbers.length > 0) {
      const { data: sigs } = await supabase
        .from('signals')
        .select('id, signal_number, title, normalized_text, severity, category, relevance_score, confidence, source_url, created_at, event_date, client_id, raw_json, clients(name)')
        .in('signal_number', sigNumbers.slice(0, 3));
      if (sigs && sigs.length) {
        liveContext += '\n\n## LIVE SIGNAL CONTEXT (verified from platform state)\n';
        for (const s of sigs as any[]) {
          // Also pull the filter log if this signal was ever rejected
          const { data: filters } = await supabase
            .from('filtered_signals')
            .select('filter_reason, relevance_score, relevance_reason')
            .or(`source_url.eq.${s.source_url || 'none'}`)
            .limit(2);
          liveContext += `\n### ${s.signal_number} — ${(s.title || '').slice(0, 100)}\n`;
          liveContext += `- client: ${(s.clients as any)?.name || 'unassigned'}\n`;
          liveContext += `- severity: ${s.severity} (${s.category})\n`;
          liveContext += `- relevance_score: ${s.relevance_score}; confidence: ${s.confidence}\n`;
          liveContext += `- created: ${s.created_at}; event_date: ${s.event_date}\n`;
          liveContext += `- source: ${s.raw_json?.source || '(unknown)'}\n`;
          liveContext += `- source_url: ${s.source_url || '(none)'}\n`;
          liveContext += `- body (truncated): ${(s.normalized_text || '').slice(0, 500)}\n`;
          if (filters && filters.length) {
            liveContext += `- related-content filter history: ${filters.map((f: any) => `[${f.filter_reason}@${f.relevance_score}] ${f.relevance_reason}`).join(' | ')}\n`;
          }
        }
      } else if (sigNumbers.length > 0) {
        liveContext += `\n\n## LIVE SIGNAL LOOKUP\nUser referenced ${sigNumbers.join(', ')} but no signals matched in the database. Note this for them — the ID may be wrong, OR the signal may have been deleted, OR it may belong to a different tenant.\n`;
      }
    }

    const systemPrompt = `You are the FORTRESS platform's support assistant. FORTRESS is an AI-powered protective-intelligence platform that monitors OSINT sources, produces signals + incidents + briefs, and helps security teams detect and respond to threats against their clients.

═══════════════════════════════════════════════════════════════════
PLATFORM ARCHITECTURE — THE FLOW
═══════════════════════════════════════════════════════════════════

1. SOURCES — feeds the platform monitors (RSS, news APIs, social media,
   government alerts, court registries, cyber advisories). Each source
   has status (active/paused) and last_ingested_at.

2. MONITORS — scheduled edge functions that fetch from sources:
   • monitor-news-google (hourly) — Google CSE queries per client+keyword
   • monitor-rss-sources (every 15 min) — fetches 70+ RSS feeds
   • monitor-twitter (every 30 min) — Twitter API v2, entity + keyword queries
   • monitor-instagram (every 2 hours) — Google CSE-based IG search
   • monitor-naad-alerts (every 15 min) — Canadian Emergency CAP-XML alerts
   • monitor-wildfires (every 15 min) — CWFIS + BCWS fire data
   • monitor-community-outreach (hourly) — local energy/First Nations news
   • monitor-court-registry (4h), monitor-csis (6h), monitor-darkweb (6h)
   • monitor-github (6h), monitor-cisa-kev (12h), monitor-threat-intel (15m)
   • monitor-canadian-sources, monitor-news, monitor-social-unified,
     monitor-macro-indicators
   • A few are paused or run on demand

3. INGESTION — every monitor calls ingest-signal. ingest-signal:
   • Dedups by content_hash + URL + title-prefix-within-24h
   • Calls classify-signal (AI) for category + severity + entity_tags
   • Runs an AI Relevance Gate scored 0-1 (threshold ~0.30, per-source
     credibility-adjusted; floor 0.25, ceiling 0.55)
   • Rejected → filtered_signals table; admitted → signals table
   • Old-event-date signals (>2y, or >3y for cyber CVEs) auto-route to
     historical bucket (rejected from live feed)

4. PROCESSING — some monitors go through ingested_documents instead:
   • monitor-rss-sources, monitor-instagram, monitor-canadian-sources
   • Documents are processed by process-intelligence-document which:
     - matches client via direct keyword OR tier-2 fuzzy (industry+region)
     - extracts signals via AI
     - sends each extracted signal through ingest-signal

5. CORRELATION + INCIDENTS — signals can be grouped into incidents when
   conditions trigger (severity + category + recency). Incidents have
   priorities (P1, P2, P3) and require analyst action.

6. AGENT NETWORK — specialist agents (TIER2-REVIEW, AEGIS-CMD, sector
   experts) review signals and propose actions. Two-tier permissions:
   • Auto-tier: file follow-ups, schedule rescans — execute immediately
   • Propose-tier: severity changes, escalations — go to action queue
   Recent design: consensus from 2+ agents auto-executes; stale safe-
   direction proposals auto-approve after 24h.

7. BRIEFS — Executive Intelligence Briefs roll up signals per client.
   Generated daily (cron) or on-demand. Contain: Executive Flash,
   Risk Assessment Matrix, Action Items (each tied to a signal ID),
   Issues of Specific Concern, Strategic Deductions.

═══════════════════════════════════════════════════════════════════
KEY CONCEPTS — UNDERSTANDING SIGNALS, INCIDENTS, ENTITIES
═══════════════════════════════════════════════════════════════════

• SIGNAL: a single observed intelligence event. Has client_id, severity
  (critical/high/medium/low/info), category (protest, sabotage,
  litigation, environmental, cyber, etc.), relevance_score (0-1),
  confidence (0-1), source_url, event_date. Identified as
  SIG-YYYY-NNNNNN.

• FILTERED_SIGNAL: a signal candidate the AI gate rejected. Stored for
  audit. Contains the rejection reason — useful when answering
  "why didn't X show up?"

• INCIDENT: an escalated signal cluster requiring action. Has priority
  (P1/P2/P3), status (open/in_progress/resolved), assigned analyst.

• ENTITY: a tracked person, organization, or location. Each has
  client_id, type, aliases, attributes, threat_score, active monitoring
  flag. Entities drive monitor-twitter person-threat queries and
  monitor-instagram profile scans.

• CLIENT: an end customer being monitored. Each has monitoring_keywords,
  high_value_assets, locations, industry, status (active/inactive).
  Multi-tenant via tenant_id.

• SOURCE: an OSINT input feed. RSS, API, etc. Has status + monitor_type.

═══════════════════════════════════════════════════════════════════
COMMON TROUBLESHOOTING — WHAT USERS ASK
═══════════════════════════════════════════════════════════════════

"Why didn't signal X show up in my feed?"
→ Check (in order):
  1. Did the source produce it? Search filtered_signals for the URL/text
  2. Did the AI gate reject it? Look at filtered_signals.relevance_reason
  3. Did the keyword match fail? "No client matches" means tier-2 fuzzy
     match didn't fire either
  4. Was it deduped against a near-identical signal already in the feed?
  5. Did it route to historical bucket (>2y old event)?
  6. Is the source itself active (sources.status = 'active')?

"Why IS signal X here? It looks tangential."
→ Tell user: the AI gate scored it at signal.relevance_score and
  reasoned about it in raw_json.relevance_reason. If genuinely wrong,
  user can thumbs-down to feed the analyst-feedback learning loop OR
  file a bug.

"Severity looks wrong on signal X"
→ classify-signal sets base severity. Agents may propose corrections
  via the action queue. Tell user they can adjust via signal detail
  view or wait for an agent to flag.

"X source isn't producing"
→ Check sources.last_ingested_at and status. The most common cause is
  upstream feed change (URL changed, rate-limited, or the source itself
  stopped publishing). Daily-Oil-Bulletin, Vancouver Sun BC Energy,
  Narwhal Energy, etc. were all running but yielding 0 signals because
  the AI gate was rejecting their content — fixed 2026-05-12 with the
  tier-2 fuzzy match in process-intelligence-document.

"I'm not seeing X from Twitter/Instagram"
→ X/Twitter requires bearer token + specific keyword/entity matches.
  Instagram coverage is structurally limited (Meta API restrictions);
  best yield is via the CSE-based monitor-instagram.

═══════════════════════════════════════════════════════════════════
CONFIGURING SOURCES + AUTOMATION
═══════════════════════════════════════════════════════════════════

ADDING A SOURCE — Admin → Sources (or direct DB insert):
{
  name: 'My Feed Name',
  type: 'rss' or 'api_feed',
  monitor_type: 'monitor-rss' or 'api_feed',
  config: { url: 'https://...', ... },
  status: 'active'
}
Once active, the matching monitor cron picks it up on its next run.

ADDING A CLIENT — Admin → Clients:
• name, industry, status='active'
• monitoring_keywords: array of asset/topic strings to track
• high_value_assets: named assets to protect
• locations: ops geographies
• monitoring_config.ngo_keywords: for fuzzy NGO+asset matching

TUNING — most behavior is driven by config:
• AI Relevance Gate threshold per-source (auto-adjusts from credibility)
• Per-client priority_keywords boost severity
• Per-client negative_keywords exclude
• Agent learning loop adjusts learnedThresholdAdjustment over time

═══════════════════════════════════════════════════════════════════
KNOWLEDGE BASE (published articles)
═══════════════════════════════════════════════════════════════════
${kbContext}
${liveContext}
${bugReportContext}

═══════════════════════════════════════════════════════════════════
YOUR RULES OF ENGAGEMENT
═══════════════════════════════════════════════════════════════════

1. Be concise. Most answers are 2-4 sentences. Bullet points only when
   the user is comparing options or you're walking through a flow.
2. Cite specific data when LIVE SIGNAL CONTEXT is provided above.
   Quote the signal's own relevance_reason / category / severity when
   explaining its disposition.
3. If you don't know — say so. Never fabricate signal IDs, severities,
   thresholds, or platform behaviors. Offer to file a ticket for the
   operator (Aaron) to investigate.
4. NEVER claim to make changes you can't make. You cannot deploy code,
   change config, adjust thresholds, edit signals, or modify agent
   behavior. Your only writable action is filing a bug/issue/ticket.
5. If the user explicitly wants a human, file a bug with severity
   matching urgency and tell them the operator has been pinged.
6. Be honest about platform state. If the audit shows monitor-news-google
   had stuck heartbeats, say so when asked. Pretending it's fine erodes
   trust.

Tone: professional, direct, friendly. Like a senior SRE who knows the
system inside out and wants to help the user understand it.`;

    const streamResult = await callAiGatewayStream({
      model: "gemini-2.5-flash",
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
