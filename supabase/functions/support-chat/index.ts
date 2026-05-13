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
      model: "gpt-4o-mini",
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
        model: "gpt-4o-mini",
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
        bugReportContext = `\n\n**BUG DETECTION ACTIVE — READY TO FILE**
You have enough information to file a bug report:
- Title: ${bugDetails.title}
- Severity: ${bugDetails.severity}

CRITICAL: To make the "Submit Bug Report" button appear in the UI, you
MUST include the literal token \`[BUG_READY]\` somewhere in your reply.
The widget watches for this marker — without it, the user has no way
to actually submit. Do NOT say "submitting now" or "I'll submit this"
— you cannot submit. Only the user clicks the button. Your job is to
(1) confirm the title/severity, (2) emit [BUG_READY], (3) tell the
user to click the green "Submit Bug Report" button.`;
      } else {
        bugReportContext = `\n\n**BUG DETECTION ACTIVE**
The user seems to be reporting an issue. Ask clarifying questions about:
1. What exactly isn't working?
2. What were they trying to do?
3. What happened instead?`;
      }
    }

    // Fetch knowledge base. Core articles (tag='core') always come first
    // so the seeded platform documentation is never dropped when the KB
    // grows past 30 entries. Falls back to other published articles for
    // the rest of the 30-row budget.
    const [{ data: coreArticles }, { data: otherArticles }] = await Promise.all([
      supabase
        .from('knowledge_base_articles')
        .select('title, summary, tags')
        .eq('is_published', true)
        .contains('tags', ['core'])
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('knowledge_base_articles')
        .select('title, summary, tags')
        .eq('is_published', true)
        .order('view_count', { ascending: false })
        .limit(20),
    ]);

    const seenTitles = new Set<string>();
    const kbCombined: any[] = [];
    for (const a of [...(coreArticles || []), ...(otherArticles || [])]) {
      if (seenTitles.has(a.title)) continue;
      seenTitles.add(a.title);
      kbCombined.push(a);
      if (kbCombined.length >= 30) break;
    }

    const kbContext = kbCombined.map(article =>
      `## ${article.title}\n${article.summary}`
    ).join('\n\n') || '';

    // ── Live platform context injection ─────────────────────────
    // If the user's most recent message references a specific signal,
    // brief, or incident, prefetch it (tenant-scoped) and inject the
    // verified state into the system prompt so the assistant can answer
    // from real data rather than guess. The user never has to copy-paste
    // signal text — pasting the ID is enough.
    let liveContext = '';

    // ── Platform pulse — always injected so the bot can answer
    //    operational questions ("why no signals?") with real numbers
    //    instead of generic advice. Pulled in parallel to keep latency
    //    low. Hard cap at 50 rows per query.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since1h = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    let pulseContext = '';
    try {
      const [
        signals24h,
        filtered24h,
        heartbeats,
        sources,
      ] = await Promise.all([
        supabase.from('signals')
          .select('client_id, severity, raw_json, clients(name)', { count: 'exact', head: false })
          .gte('created_at', since24h)
          .neq('is_test', true)
          .limit(2000),
        supabase.from('filtered_signals')
          .select('filter_reason', { count: 'exact', head: false })
          .gte('created_at', since24h)
          .limit(2000),
        supabase.from('cron_heartbeat')
          .select('job_name, status, completed_at, started_at')
          .gte('started_at', since1h)
          .order('started_at', { ascending: false })
          .limit(50),
        supabase.from('sources')
          .select('name, status, last_ingested_at, monitor_type')
          .eq('status', 'active')
          .order('last_ingested_at', { ascending: false, nullsFirst: false })
          .limit(50),
      ]);

      const totalSignals = signals24h.data?.length || 0;
      const byClient: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      for (const s of (signals24h.data as any[]) || []) {
        const c = s.clients?.name || 'unassigned';
        byClient[c] = (byClient[c] || 0) + 1;
        const src = s.raw_json?.source || s.raw_json?.monitor || 'unknown';
        bySource[src] = (bySource[src] || 0) + 1;
      }

      const totalFiltered = filtered24h.data?.length || 0;
      const filterReasons: Record<string, number> = {};
      for (const f of (filtered24h.data as any[]) || []) {
        const r = (f.filter_reason || 'unspecified').slice(0, 60);
        filterReasons[r] = (filterReasons[r] || 0) + 1;
      }
      const topFilterReasons = Object.entries(filterReasons)
        .sort(([, a], [, b]) => b - a).slice(0, 5);

      const heartbeatsRecent = (heartbeats.data as any[]) || [];
      const heartbeatFails = heartbeatsRecent.filter((h) => h.status === 'failed').length;
      const heartbeatOk = heartbeatsRecent.filter((h) => h.status === 'completed').length;

      const sourcesData = (sources.data as any[]) || [];
      const staleSources = sourcesData.filter((s) =>
        !s.last_ingested_at || new Date(s.last_ingested_at).getTime() < Date.now() - 6 * 60 * 60 * 1000
      );

      pulseContext = `

═══════════════════════════════════════════════════════════════════
LIVE PLATFORM PULSE (auto-injected — quote these numbers when the
user asks operational questions like "why no signals" or "is X working")
═══════════════════════════════════════════════════════════════════

SIGNALS (last 24h, excluding test):
- Total admitted: ${totalSignals}
- By client: ${Object.entries(byClient).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}
- By source: ${Object.entries(bySource).slice(0, 6).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}

FILTER GATE (last 24h):
- Total rejected: ${totalFiltered}
- Admit ratio: ${totalSignals + totalFiltered > 0 ? Math.round(100 * totalSignals / (totalSignals + totalFiltered)) + '%' : 'n/a'}
- Top rejection reasons: ${topFilterReasons.map(([r, c]) => `"${r}" (${c})`).join('; ') || '(none)'}

CRON HEARTBEATS (last 1h):
- Completed: ${heartbeatOk}, Failed: ${heartbeatFails}
${heartbeatFails > 0 ? '- Failed jobs: ' + heartbeatsRecent.filter((h) => h.status === 'failed').slice(0, 5).map((h) => h.job_name).join(', ') : ''}

ACTIVE SOURCES (${sourcesData.length} total active):
- Stale (>6h since last_ingested_at): ${staleSources.length}
${staleSources.length > 0 ? '- Stale source names: ' + staleSources.slice(0, 8).map((s) => s.name).join(', ') : ''}
`;
    } catch (e) {
      console.error('[support-chat] pulse fetch failed', e);
      pulseContext = '\n(Platform pulse fetch failed — answer from general knowledge.)\n';
    }
    const lastUserText = (() => {
      const last = messages?.slice().reverse().find((m: any) => m.role === 'user');
      return typeof last?.content === 'string' ? last.content : '';
    })();

    // Three lookup strategies in priority order: signal ID → URL → title prefix
    // Two ID formats:
    //   - signal_number form: SIG-2026-001543 (database canonical)
    //   - UUID-prefix form: SIG-b4e5df91 (what the awaiting-review UI shows)
    const sigNumbers = Array.from(new Set((lastUserText.match(/SIG-\d{4}-\d{6}/gi) || []).map((s: string) => s.toUpperCase())));
    const sigUuidPrefixes = Array.from(new Set(
      (lastUserText.match(/SIG-[a-f0-9]{8}\b/gi) || []).map((s: string) => s.slice(4).toLowerCase())
    ));

    // URL detection: capture full URL but also strip query params for
    // prefix matching, since stored source_url may differ in query strings.
    const urlFull = Array.from(new Set(lastUserText.match(/https?:\/\/[^\s<>"\)\]]+/g) || [])).slice(0, 3);
    const urlPrefixes = urlFull.map((u: string) => u.split('?')[0].split('#')[0]).filter((u: string) => u.length > 12);

    const formatSig = (s: any) => {
      let block = `\n### ${s.signal_number} — ${(s.title || '').slice(0, 100)}\n`;
      block += `- client: ${(s.clients as any)?.name || 'unassigned'}\n`;
      block += `- severity: ${s.severity} (${s.category})\n`;
      block += `- relevance_score: ${s.relevance_score}; confidence: ${s.confidence}\n`;
      block += `- created: ${s.created_at}; event_date: ${s.event_date}\n`;
      block += `- source: ${s.raw_json?.source || '(unknown)'}\n`;
      block += `- source_url: ${s.source_url || '(none)'}\n`;
      block += `- body (truncated): ${(s.normalized_text || '').slice(0, 500)}\n`;
      return block;
    };

    let matchedSigs: any[] = [];
    let lookupAttempted: 'sig_number' | 'sig_uuid_prefix' | 'url' | 'title_prefix' | null = null;
    const SIG_COLS = 'id, signal_number, title, normalized_text, severity, category, relevance_score, confidence, source_url, created_at, event_date, client_id, raw_json, clients(name)';
    const dedupeIds = (arr: any[]) => {
      const seen = new Set<string>();
      return arr.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
    };

    // 1. SIG-YYYY-NNNNNN canonical signal_number
    if (sigNumbers.length > 0) {
      lookupAttempted = 'sig_number';
      const { data: sigs } = await supabase
        .from('signals')
        .select(SIG_COLS)
        .in('signal_number', sigNumbers.slice(0, 3));
      if (sigs) matchedSigs.push(...sigs);
    }

    // 1b. SIG-XXXXXXXX UI display format (first 8 hex chars of signals.id)
    //     PostgREST can't ilike a uuid column, so fetch a recent window and
    //     match the prefix client-side. Falls back to filtered_signals if
    //     the AI gate rejected it.
    if (matchedSigs.length === 0 && sigUuidPrefixes.length > 0) {
      lookupAttempted = 'sig_uuid_prefix';
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { data: sigs, error: sigErr } = await supabase
        .from('signals')
        .select(SIG_COLS)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);
      console.log('[support-chat] sig_uuid_prefix lookup', {
        prefixes: sigUuidPrefixes,
        rowsFetched: sigs?.length || 0,
        error: sigErr?.message,
      });
      if (sigs) {
        const matched = (sigs as any[]).filter((s) =>
          sigUuidPrefixes.some((p: string) => String(s.id).toLowerCase().startsWith(p))
        ).slice(0, 5);
        matchedSigs.push(...matched);
        console.log('[support-chat] sig_uuid_prefix matched', { count: matched.length, ids: matched.map((m: any) => m.id) });
      }

      // Fallback to filtered_signals if the AI gate rejected this signal
      if (matchedSigs.length === 0) {
        const { data: filtered } = await supabase
          .from('filtered_signals')
          .select('id, title, normalized_text, source_url, created_at, filter_reason, relevance_score, raw_json')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(5000);
        if (filtered) {
          const matchedFiltered = (filtered as any[]).filter((s) =>
            sigUuidPrefixes.some((p: string) => String(s.id).toLowerCase().startsWith(p))
          ).slice(0, 3);
          if (matchedFiltered.length > 0) {
            liveContext += '\n\n## FILTERED SIGNAL MATCH (rejected by AI relevance gate)\n';
            for (const f of matchedFiltered) {
              liveContext += `\n### ${String(f.id).slice(0, 8)} — ${(f.title || '').slice(0, 100)}\n`;
              liveContext += `- filter_reason: ${f.filter_reason || '(unknown)'}\n`;
              liveContext += `- relevance_score: ${f.relevance_score}\n`;
              liveContext += `- created: ${f.created_at}\n`;
              liveContext += `- source_url: ${f.source_url || '(none)'}\n`;
              liveContext += `- body (truncated): ${(f.normalized_text || '').slice(0, 400)}\n`;
            }
            liveContext += '\nTell the user this signal was REJECTED by the AI relevance gate (lives in filtered_signals, not the live feed). Cite the filter_reason and relevance_score.\n';
            lookupAttempted = null; // suppress the NO MATCH block below since we did find context
          }
        }
      }
    }

    // 2. URL — match by prefix (everything before ? or #) since stored URLs
    //    may have different query params than what the user pasted.
    if (matchedSigs.length === 0 && urlPrefixes.length > 0) {
      lookupAttempted = 'url';
      for (const u of urlPrefixes.slice(0, 3)) {
        const { data: sigs } = await supabase
          .from('signals')
          .select(SIG_COLS)
          .ilike('source_url', `${u}%`)
          .limit(3);
        console.log('[support-chat] url lookup', { url: u, rows: sigs?.length || 0 });
        if (sigs) matchedSigs.push(...sigs);
      }
    }

    matchedSigs = dedupeIds(matchedSigs);

    // 3. Title prefix — fall back to first 40 chars of the user message
    if (matchedSigs.length === 0 && sigNumbers.length === 0 && sigUuidPrefixes.length === 0 && urlPrefixes.length === 0 && lastUserText.length >= 15) {
      lookupAttempted = 'title_prefix';
      // Strip leading question prefixes that aren't part of a real title
      const prefixStripped = lastUserText
        .replace(/^(why|what|how|where|when|tell me about|look up|find|i see|i'm seeing|i am seeing|can you|please|i think|i don't)\b[^A-Z0-9]*/i, '')
        .trim();
      const titleGuess = prefixStripped.slice(0, 40).trim();
      if (titleGuess.length >= 10) {
        const { data: sigs } = await supabase
          .from('signals')
          .select(SIG_COLS)
          .ilike('title', `%${titleGuess}%`)
          .order('created_at', { ascending: false })
          .limit(3);
        if (sigs) matchedSigs = sigs;
      }
    }

    if (matchedSigs.length > 0) {
      liveContext += '\n\n## LIVE SIGNAL CONTEXT (verified from platform state)\n';
      liveContext += `Looked up via: ${lookupAttempted}\n`;
      for (const s of matchedSigs) liveContext += formatSig(s);
    } else if (lookupAttempted) {
      liveContext += `\n\n## SIGNAL LOOKUP — NO MATCH\nAttempted lookup via ${lookupAttempted} but no signals matched. Tell the user plainly that you couldn't find the specific signal in the database, and ask them for the signal ID (looks like SIG-2026-XXXXXX), the source URL, or the exact title text. Do NOT offer to "check further" or "look into this" — you have no other tool to find it.\n`;
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
KNOWLEDGE BASE — published articles available at /knowledge-base
═══════════════════════════════════════════════════════════════════
When you answer from one of these articles, cite the article title in
your reply ("see KB article *Title*…") and point the user to the
Knowledge Base page (/knowledge-base) for the full content. The page
has search by title/summary/content + category sidebar. Use these
article summaries as authoritative reference — quote facts from them
rather than paraphrasing from general knowledge.
${kbContext}
${pulseContext}
${liveContext}
${bugReportContext}

═══════════════════════════════════════════════════════════════════
YOUR RULES OF ENGAGEMENT — STRICT
═══════════════════════════════════════════════════════════════════

LENGTH:
- Default: **2-3 sentences**. Crisp answer, no preamble, no "Great question!"
- Lists/bullets only when explicitly walking a multi-step procedure or
  comparing 3+ concrete options. Never use bullets for a 2-sentence answer.
- No markdown headers (no "**Source Inclusion:**" / "## Steps") in normal
  replies. Save structured formatting for actual procedures.

REFERRING TO THE KB:
When a question is best answered by a longer document, give the
short answer (1-2 sentences) AND link the user to /knowledge-base —
either with the specific article title if one of the KB titles above
matches, or a general "search the Knowledge Base at /knowledge-base"
otherwise. Don't paste long extracts; trust the user to read.

OPERATIONAL QUESTIONS — REQUIRED:
When the user asks ANY operational question ("why no signals", "is X
working", "are monitors running", "what's broken", "I'm not seeing X",
source/client/cron health, volume questions) — ANSWER FROM THE LIVE
PLATFORM PULSE block above. Quote the actual numbers (signal count
last 24h, admit ratio, failed heartbeat job names, stale source names).
NEVER respond with generic platitudes like "check sources.status" or
"verify your keywords" when the data is right there. If the pulse
shows 5 signals in 24h with 70 filter rejections and a stale Twitter
source, SAY THAT.

LOOKUP DISCIPLINE — REQUIRED:
- If a LIVE SIGNAL CONTEXT block appears above, ANSWER FROM IT directly.
  Quote the signal's actual severity/relevance_score/source/category in
  your answer.
- If a SIGNAL LOOKUP — NO MATCH block appears, tell the user plainly that
  you couldn't find the specific signal. Accepted ID formats are:
    • SIG-2026-XXXXXX (canonical signal_number — DB-assigned)
    • SIG-XXXXXXXX (UI display format — first 8 hex of the UUID, e.g.
      SIG-b4e5df91)
  Both are valid — never tell the user one is "wrong format". If they
  already gave you a SIG-XXXXXXXX ID and you couldn't find it, say so
  plainly and ask for ONE of:
    1. the source URL
    2. the exact title text
    3. a screenshot of the signal card
  Do NOT say "let me check further" or "I'll look into this" — you have
  no tool to check beyond what was already attempted. Asking the user for
  more input is the only forward move.
- If neither block appears, the user hasn't given you a referenceable
  artifact. If their question is general (how-to, troubleshooting,
  concept), answer normally. If they're asking about a specific signal,
  ask for the ID/URL/title.

CANNOT DO — say so plainly:
- Modify any signal, brief, incident, agent, or config
- Deploy code, run migrations, change cron schedules
- Override the AI gate, adjust thresholds, or unblock signals
- Approve or reject items in any queue

CAN DO — your one writable action: **file a bug report / ticket**.
If the user asks "can you generate a ticket", "open a ticket",
"create a ticket", "log this issue", "escalate this", or anything
similar — say YES. The bug-report flow IS the ticket system; bug
reports route to the operator (Aaron) for follow-up. Never tell the
user you "cannot generate tickets" — that's misleading.

How the ticket flow actually works:
1. Gather title + description + severity from the user
2. When you have those, include the literal token \`[BUG_READY]\` in
   your reply (the UI watches for this and shows a "Submit Bug Report"
   button only after it appears)
3. Tell the user to click the green button to submit
4. Never claim "submitting now" or "I'll send it" — you have no submit
   tool. The user clicks the button. If you fake the submission, no
   ticket is filed and the user is misled.

CANNOT KNOW — say so plainly:
- Real-time platform state beyond signals already prefetched above
- Other tenants' data
- The user's UI state (what page they're on, what they clicked)

If the user wants the operator (Aaron), trigger the bug-report flow with
a clear severity. Don't try to handle escalations yourself.

Tone: professional, direct, friendly. Senior SRE who's seen this
system fifty times — short answer, real specifics, no fluff.`;

    const streamResult = await callAiGatewayStream({
      model: "gpt-4o-mini",
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
