import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ToolArgs = Record<string, any>;

// Tenant scope: derived from the caller's VERIFIED JWT membership in tenant_users.
// A client-supplied tenant_id is honored only if the user is a member of it.
// Multiple memberships + none supplied -> data-richest membership. null -> fail closed.
async function resolveScope(
  supabase: any,
  req: Request,
  clientTenantId: string | null,
): Promise<{ tenantId: string; clientIds: string[] } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) { console.warn("[Voice Tool v2] scope: no bearer token"); return null; }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) { console.warn("[Voice Tool v2] scope: token did not resolve"); return null; }
  const { data: memberships } = await supabase.from("tenant_users").select("tenant_id").eq("user_id", user.id);
  const tenantIds = (memberships || []).map((m: { tenant_id: string }) => m.tenant_id).filter(Boolean);
  if (tenantIds.length === 0) { console.warn(`[Voice Tool v2] scope: user ${user.id} no memberships`); return null; }
  let tenantId: string | null = null;
  if (clientTenantId && tenantIds.includes(clientTenantId)) {
    tenantId = clientTenantId;
  } else if (tenantIds.length === 1) {
    tenantId = tenantIds[0];
  } else {
    let best = tenantIds[0]; let bestCount = -1;
    for (const tid of tenantIds) {
      const { count } = await supabase.from("signals").select("*", { count: "exact", head: true }).eq("tenant_id", tid);
      if ((count ?? 0) > bestCount) { bestCount = count ?? 0; best = tid; }
    }
    tenantId = best;
  }
  if (!tenantId) return null;
  const { data: clients } = await supabase.from("clients").select("id").eq("tenant_id", tenantId);
  const clientIds = (clients || []).map((c: { id: string }) => c.id);
  console.log(`[Voice Tool v2] scope resolved: tenant=${tenantId} clients=${clientIds.length}`);
  return { tenantId, clientIds };
}

// Tokenise a free-text query into matchable words (drops 1-char tokens + punctuation).
function queryWords(raw: string): string[] {
  return String(raw || "").replace(/[^a-zA-Z0-9 \-]/g, " ").split(/\s+/).map((w) => w.trim()).filter((w) => w.length > 1);
}

// Resolve the authenticated caller's user id from the bearer token (for per-user memory).
async function getCallerUserId(supabase: any, req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  return data?.user?.id ?? null;
}

const TENANT_MISSING = {
  found: false,
  error: "TENANT_CONTEXT_MISSING",
  message: "I couldn't establish your tenant scope from this session, so I'm not returning any data rather than risk showing the wrong client's information. Please re-authenticate or select your tenant and try again.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const payload = await req.json().catch(() => ({}));
    const tool_name = payload?.tool_name as string | undefined;
    const toolArgs = (payload?.arguments || {}) as ToolArgs;
    if (!tool_name) {
      return new Response(JSON.stringify({ error: "Missing tool_name" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const assertOk = (op: string, error: any) => { if (error) { console.error(`[Voice Tool v2] ${op} failed:`, error); throw new Error(`${op} failed: ${error.message || "Unknown error"}`); } };
    const clientTenantId =
      (typeof (payload as any)?.tenant_id === "string" && (payload as any).tenant_id ? (payload as any).tenant_id : null) ??
      (typeof toolArgs?.tenant_id === "string" && toolArgs.tenant_id ? toolArgs.tenant_id : null);
    const scope = await resolveScope(supabase, req, clientTenantId);
    let result: unknown;
    switch (tool_name) {
      // ---- Persistent memory (shared with chat via conversation_memory) ----
      case "get_user_memory": {
        const uid = await getCallerUserId(supabase, req);
        if (!uid) { result = { success: false, message: "Sign in to access memory." }; break; }
        const { data: mems } = await supabase
          .from("conversation_memory")
          .select("memory_type, content, context_tags, importance_score, client_id, created_at")
          .eq("user_id", uid)
          .or("importance_score.gte.6,created_at.gte." + new Date(Date.now() - 30 * 864e5).toISOString())
          .order("importance_score", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(30);
        result = {
          success: true,
          memory_count: (mems || []).length,
          memories: (mems || []).map((m: any) => ({ type: m.memory_type, content: m.content, tags: m.context_tags, when: m.created_at })),
          guidance: (mems || []).length
            ? "Persisted memory from prior conversations with THIS operator (names, locations, preferences, ongoing matters). Use what's relevant naturally; do not recite the whole list."
            : "No saved memory for this operator yet.",
        };
        break;
      }

      case "remember_this":
      case "update_user_preferences":
      case "manage_project_context": {
        const uid = await getCallerUserId(supabase, req);
        if (!uid) { result = { success: false, message: "Sign in to save memory." }; break; }
        const content = (typeof toolArgs.content === "string" && toolArgs.content.trim())
          || (typeof toolArgs.preference === "string" && toolArgs.preference.trim())
          || (typeof toolArgs.note === "string" && toolArgs.note.trim()) || "";
        if (!content) { result = { success: false, message: "Nothing to remember — what should I note?" }; break; }
        const memType = tool_name === "update_user_preferences" ? "preference"
          : tool_name === "manage_project_context" ? "project"
          : (typeof toolArgs.memory_type === "string" && toolArgs.memory_type ? toolArgs.memory_type : "fact");
        const { data, error } = await supabase.from("conversation_memory").insert({
          user_id: uid,
          memory_type: memType,
          content,
          context_tags: Array.isArray(toolArgs.context_tags) ? toolArgs.context_tags : [],
          importance_score: typeof toolArgs.importance_score === "number" ? toolArgs.importance_score : 6,
          client_id: (scope && scope.clientIds[0]) || (typeof toolArgs.client_id === "string" ? toolArgs.client_id : null),
        }).select("id").single();
        if (error) { console.error("[remember_this]", error); result = { success: false, message: "Couldn't save that to memory." }; break; }
        result = { success: true, message: `Committed to memory: "${content.slice(0, 60)}${content.length > 60 ? "…" : ""}"`, memory_id: data?.id, memory_type: memType };
        break;
      }
      case "get_current_threats": {
        if (!scope) { result = TENANT_MISSING; break; }
        const { data: recentSignals, error: e1 } = await supabase.from("signals")
          .select("id, title, severity, description, source_id, created_at, rule_category, status")
          .eq("tenant_id", scope.tenantId).in("severity", ["critical", "high"]).in("status", ["new", "triaged"])
          .order("created_at", { ascending: false }).limit(10);
        assertOk("get_current_threats.signals", e1);
        const { data: openIncidents, error: e2 } = await supabase.from("incidents")
          .select("id, title, severity_level, status, incident_type, priority, created_at, opened_at")
          .eq("tenant_id", scope.tenantId).in("status", ["open", "acknowledged"])
          .order("created_at", { ascending: false }).limit(10);
        assertOk("get_current_threats.incidents", e2);
        const cats: Record<string, number> = {};
        recentSignals?.forEach((s: any) => { const c = s.rule_category || "Uncategorized"; cats[c] = (cats[c] || 0) + 1; });
        result = {
          high_priority_signals: recentSignals?.map((s: any) => ({ id: s.id, title: s.title, severity: s.severity, source: s.source_id, category: s.rule_category, status: s.status, created_at: s.created_at })) || [],
          open_incidents: openIncidents?.map((i: any) => ({ id: i.id, title: i.title, severity: i.severity_level, priority: i.priority, type: i.incident_type, status: i.status, opened_at: i.opened_at })) || [],
          threat_patterns: Object.entries(cats).map(([category, count]) => ({ category, count })),
          summary: `${recentSignals?.length || 0} high-priority signals, ${openIncidents?.length || 0} open incidents`,
        };
        break;
      }
      case "analyze_threat_radar": {
        if (!scope) { result = TENANT_MISSING; break; }
        const lookbackDays = Number(toolArgs.lookback_days ?? 7);
        const cutoff = new Date(Date.now() - lookbackDays * 864e5).toISOString();
        const { data: signals, error: e } = await supabase.from("signals")
          .select("id, severity, rule_category, created_at").eq("tenant_id", scope.tenantId)
          .gte("created_at", cutoff).order("created_at", { ascending: false }).limit(200);
        assertOk("analyze_threat_radar.signals", e);
        const sev = { critical: 0, high: 0, medium: 0, low: 0 };
        const cb: Record<string, number> = {};
        signals?.forEach((s: any) => { if (s.severity in sev) sev[s.severity as keyof typeof sev]++; const c = s.rule_category || "Other"; cb[c] = (cb[c] || 0) + 1; });
        const score = sev.critical * 10 + sev.high * 5 + sev.medium * 2 + sev.low;
        let lvl = "LOW"; if (score > 50) lvl = "CRITICAL"; else if (score > 30) lvl = "HIGH"; else if (score > 15) lvl = "ELEVATED"; else if (score > 5) lvl = "MODERATE";
        result = { overall_threat_level: lvl, threat_score: score, signal_breakdown: sev, top_categories: Object.entries(cb).sort(([, a], [, b]) => b - a).slice(0, 5).map(([category, count]) => ({ category, count })), analysis_period: `${lookbackDays} days`, generated_at: new Date().toISOString() };
        break;
      }
      case "query_fortress_data": {
        if (!scope) { result = TENANT_MISSING; break; }
        const limit = Number(toolArgs.limit ?? 20);
        const daysBack = Number(toolArgs.time_range_days ?? 30);
        const cutoff = new Date(Date.now() - daysBack * 864e5).toISOString();
        const results: any = { signals: [], incidents: [], entities: [], documents: [] };
        const { data: signals } = await supabase.from("signals")
          .select("id, title, severity, source_id, created_at, rule_category, status")
          .eq("tenant_id", scope.tenantId).gte("created_at", cutoff)
          .order("created_at", { ascending: false }).limit(limit);
        results.signals = signals || [];
        const { data: incidents } = await supabase.from("incidents")
          .select("id, title, severity_level, status, priority, incident_type, created_at, opened_at")
          .eq("tenant_id", scope.tenantId).gte("created_at", cutoff)
          .order("created_at", { ascending: false }).limit(limit);
        results.incidents = incidents || [];
        const { data: entities } = await supabase.from("entities")
          .select("id, name, type, risk_level, active_monitoring_enabled")
          .eq("tenant_id", scope.tenantId).limit(limit);
        results.entities = entities || [];
        let documentCount = 0;
        let reportContent: any = null;
        if (scope.clientIds.length > 0) {
          const { count } = await supabase.from("archival_documents").select("*", { count: "exact", head: true }).in("client_id", scope.clientIds);
          documentCount = count ?? 0;
          const words = queryWords(Array.isArray(toolArgs.keywords) ? toolArgs.keywords.join(" ") : (typeof toolArgs.query === "string" ? toolArgs.query : ""));
          let dq = supabase.from("archival_documents")
            .select("id, filename, summary, upload_date, processing_status")
            .in("client_id", scope.clientIds).order("upload_date", { ascending: false }).limit(60);
          if (words.length) dq = dq.or(words.flatMap((w) => [`filename.ilike.%${w}%`, `summary.ilike.%${w}%`]).join(","));
          const { data: documents } = await dq;
          const scored = (documents || []).map((d: any) => {
            const fn = String(d.filename || "").toLowerCase();
            const hits = words.reduce((n: number, w: string) => n + (fn.includes(w.toLowerCase()) ? 1 : 0), 0);
            return { d, hits };
          }).sort((a: any, b: any) => b.hits - a.hits);
          results.documents = (scored.length ? scored.map((s: any) => s.d) : (documents || [])).slice(0, limit);
          if (words.length && scored.length && scored[0].hits > 0) {
            const top = scored[0].d;
            const { data: full } = await supabase.from("archival_documents").select("filename, upload_date, content_text").eq("id", top.id).maybeSingle();
            const raw = String(full?.content_text || "").trim();
            const ok = raw.length >= 800 && !/exceeds .*processing limit|no extracted text/i.test(raw);
            reportContent = {
              filename: full?.filename, upload_date: full?.upload_date, content_available: ok,
              content_text: ok ? raw.slice(0, 12000) : null,
              guidance: ok
                ? "The operator asked about this specific report. Brief it BLUF: bottom line up front, then 3-5 key points, then risk/implications, then gaps. Ground every point strictly in this text."
                : "This report's full text isn't extracted yet — tell the operator it isn't fully processed and do NOT summarize its contents.",
            };
          }
        }
        const totalCount = results.signals.length + results.incidents.length + results.entities.length + results.documents.length;
        result = { found: totalCount > 0, time_range_days: daysBack, total_count: totalCount, document_count: documentCount, ...results, report_content: reportContent, summary: `Found ${results.signals.length} signals, ${results.incidents.length} incidents, ${results.entities.length} entities, ${documentCount} documents` };
        break;
      }
      case "get_document_content": {
        if (!scope) { result = TENANT_MISSING; break; }
        if (scope.clientIds.length === 0) { result = { found: false, message: "No documents are accessible for your tenant." }; break; }
        const rawTerm = (typeof toolArgs.query === "string" && toolArgs.query.trim()) || (typeof toolArgs.document_name === "string" && toolArgs.document_name.trim()) || (Array.isArray(toolArgs.keywords) ? toolArgs.keywords.join(" ") : "");
        const words = queryWords(rawTerm);
        let dq = supabase.from("archival_documents")
          .select("id, filename, summary, upload_date, processing_status, content_text")
          .in("client_id", scope.clientIds).order("upload_date", { ascending: false }).limit(60);
        if (words.length) dq = dq.or(words.flatMap((w) => [`filename.ilike.%${w}%`, `summary.ilike.%${w}%`]).join(","));
        const { data: docs } = await dq;
        if (!docs || docs.length === 0) { result = { found: false, message: `No document found matching "${rawTerm || "(no query)"}".` }; break; }
        const scored = docs.map((d: any) => {
          const fn = String(d.filename || "").toLowerCase();
          const hits = words.reduce((n: number, w: string) => n + (fn.includes(w.toLowerCase()) ? 1 : 0), 0);
          return { d, hits };
        }).sort((a: any, b: any) => b.hits - a.hits);
        const doc: any = scored[0].d;
        const raw = String(doc.content_text || "").trim();
        const isPlaceholder = raw.length < 800 || /exceeds .*processing limit|no extracted text/i.test(raw);
        result = {
          found: true, filename: doc.filename, upload_date: doc.upload_date, processing_status: doc.processing_status,
          content_available: !isPlaceholder, content_text: isPlaceholder ? null : raw.slice(0, 12000),
          guidance: isPlaceholder
            ? "Full text not extracted yet — tell the operator this report isn't fully processed and do NOT summarize its contents."
            : "Brief this content BLUF: bottom line up front, then 3-5 key points, then risks/implications, then gaps. Ground every point strictly in this text.",
          other_matches: scored.slice(1, 4).map((s: any) => ({ filename: s.d.filename, upload_date: s.d.upload_date })),
        };
        break;
      }
      // External web search via Perplexity. EXTERNAL ONLY — no tenant data is sent or
      // returned, so this is safe regardless of tenant scope. The model must present
      // results as open-source web findings, kept separate from tenant intelligence.
      case "search_web":
      case "perform_external_web_search": {
        const q = (typeof toolArgs.query === "string" && toolArgs.query.trim())
          || (Array.isArray(toolArgs.keywords) ? toolArgs.keywords.join(" ") : "");
        if (!String(q).trim()) { result = { error: "No search query provided." }; break; }
        const GKEY = Deno.env.get("GOOGLE_SEARCH_API_KEY");
        const GCX = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");
        if (!GKEY || !GCX) { result = { error: "Web search is not configured." }; break; }
        const cse = async (query: string, num: number) => {
          const u = `https://www.googleapis.com/customsearch/v1?key=${GKEY}&cx=${GCX}&q=${encodeURIComponent(query)}&num=${num}`;
          const rr = await fetch(u);
          if (!rr.ok) { console.error("[search_web] cse error:", rr.status, await rr.text()); return []; }
          const dd = await rr.json();
          return (dd.items || []).map((i: any) => ({
            title: i.title, url: i.link, snippet: i.snippet, source: i.displayLink,
            published: i.pagemap?.metatags?.[0]?.["article:published_time"] || i.pagemap?.metatags?.[0]?.["datePublished"] || null,
          }));
        };
        try {
          const lc = String(q).toLowerCase();
          // Detect statistics / court-records intent → bias toward authoritative official sources.
          const isStats = /(statistic|crime rate|\brates?\b|how many|number of|\bdata\b|trend|baseline|per capita|incidence)/.test(lc);
          const isCourt = /(court|charge|conviction|sentenc|registr|docket|accused|prosecut|\bcase\b|criminal record|offender)/.test(lc);
          const authSites: string[] = [];
          if (isStats) authSites.push("statcan.gc.ca", "rcmp-grc.gc.ca", "www2.gov.bc.ca");
          if (isCourt) authSites.push("bccourts.ca", "justice.gov.bc.ca", "courtsofbc.ca", "canlii.org");
          const primary = await cse(String(q), 8);
          let authoritative: any[] = [];
          if (authSites.length > 0) {
            const biased = `${q} (${authSites.map((s) => `site:${s}`).join(" OR ")})`;
            authoritative = await cse(biased, 5);
          }
          // Authoritative results first, then general; dedupe by URL.
          const seen = new Set<string>();
          const merged = [...authoritative, ...primary].filter((it) => {
            const k = it.url || it.title; if (!k || seen.has(k)) return false; seen.add(k); return true;
          }).slice(0, 12);
          result = {
            query: String(q),
            results: merged,
            result_count: merged.length,
            authoritative_count: authoritative.length,
            data_source: "external_web",
            guidance: merged.length
              ? "LIVE EXTERNAL web sources (open-source), NOT this tenant's internal intelligence. Deliver an INTELLIGENCE ASSESSMENT, not a chatbot reply or link list: (1) BLUF — the key judgment in 1-2 sentences; (2) synthesised findings, attributing each claim to its source (e.g. 'per Statistics Canada'); (3) SO-WHAT for the operator; (4) CONFIDENCE and GAPS. Cite sources by name/domain. No filler, no preamble."
                + (authSites.length ? " STATISTICS/COURT query: prioritise the authoritative sources (Statistics Canada, RCMP, BC Courts, CanLII) and clearly separate OFFICIAL data from news/commentary. If official figures or court records are NOT present in these results, say so plainly as a collection gap — never estimate, interpolate, or fabricate numbers, charges, or case outcomes." : "")
              : "No external web results for this query. State it plainly as a collection gap; do not fabricate or fall back to general knowledge presented as findings.",
          };
        } catch (err) {
          console.error("[search_web] error:", err);
          result = { error: "Web search failed." };
        }
        break;
      }

      default:
        result = { error: `Unknown tool: ${tool_name}`, available_tools: ["search_web", "get_current_threats", "get_entity_info", "query_legal_database", "query_fortress_data", "get_document_content", "generate_intelligence_summary", "analyze_threat_radar", "get_user_memory", "remember_this", "update_user_preferences", "manage_project_context"] };
    }
    return new Response(JSON.stringify({ result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[Voice Tool v2] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
