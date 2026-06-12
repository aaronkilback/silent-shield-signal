import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ToolArgs = Record<string, any>;

// P0 CONTAINMENT (2026-06-11): voice may NOT read global / cross-client data.
//
// Scope is fail-closed and CLIENT-specific. It requires ALL of:
//   1. a VERIFIED caller JWT (auth.getUser on the bearer token),
//   2. an explicit tenant_id supplied by the caller that the user is a MEMBER
//      of (tenant_users) — never a grant, never inferred,
//   3. an explicit client_id supplied by the caller that BELONGS to that tenant.
//
// There is NO data-richest fallback, NO single-membership fallback, NO NULL
// fallback, and NO tenant-wide read. Any missing/unvalidated piece -> null ->
// the data tools refuse. Every data read is scoped by BOTH tenant_id AND
// client_id, so voice can only ever see the operator's currently-selected
// client.
async function resolveScope(
  supabase: any,
  req: Request,
  reqTenantId: string | null,
  reqClientId: string | null,
): Promise<{ tenantId: string; clientId: string; userId: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) { console.warn("[Voice Tool v2] scope: no bearer token"); return null; }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) { console.warn("[Voice Tool v2] scope: token did not resolve"); return null; }
  // Both tenant_id AND client_id MUST be supplied by the caller. No fallback.
  if (!reqTenantId || typeof reqTenantId !== "string") { console.warn("[Voice Tool v2] scope: no tenant_id supplied"); return null; }
  if (!reqClientId || typeof reqClientId !== "string") { console.warn("[Voice Tool v2] scope: no client_id supplied"); return null; }
  // The caller must be a MEMBER of the supplied tenant.
  const { data: membership } = await supabase
    .from("tenant_users").select("tenant_id")
    .eq("user_id", user.id).eq("tenant_id", reqTenantId).limit(1);
  if (!membership || membership.length === 0) { console.warn(`[Voice Tool v2] scope: user ${user.id} not a member of ${reqTenantId}`); return null; }
  // The supplied client MUST belong to that tenant.
  const { data: client } = await supabase
    .from("clients").select("id")
    .eq("id", reqClientId).eq("tenant_id", reqTenantId).limit(1).maybeSingle();
  if (!client) { console.warn(`[Voice Tool v2] scope: client ${reqClientId} not in tenant ${reqTenantId}`); return null; }
  console.log(`[Voice Tool v2] scope resolved: tenant=${reqTenantId} client=${reqClientId}`);
  return { tenantId: reqTenantId, clientId: reqClientId, userId: user.id };
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

// Fail-closed refusal returned by every data tool when client scope is absent.
const SCOPE_MISSING = {
  found: false,
  error: "CLIENT_CONTEXT_MISSING",
  message: "I do not have a selected client context for that data.",
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
    const pick = (...vals: any[]) => vals.find((v) => typeof v === "string" && v) ?? null;
    const reqTenantId = pick((payload as any)?.tenant_id, toolArgs?.tenant_id);
    const reqClientId = pick((payload as any)?.client_id, toolArgs?.client_id);
    const scope = await resolveScope(supabase, req, reqTenantId, reqClientId);
    let result: unknown;
    switch (tool_name) {
      // ---- Persistent memory (per-USER, not tenant data; no client scope needed) ----
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
          client_id: scope?.clientId ?? null,
        }).select("id").single();
        if (error) { console.error("[remember_this]", error); result = { success: false, message: "Couldn't save that to memory." }; break; }
        result = { success: true, message: `Committed to memory: "${content.slice(0, 60)}${content.length > 60 ? "…" : ""}"`, memory_id: data?.id, memory_type: memType };
        break;
      }
      case "get_current_threats": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const { data: recentSignals, error: e1 } = await supabase.from("signals")
          .select("id, title, severity, description, source_id, created_at, rule_category, status")
          .eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId)
          .in("severity", ["critical", "high"]).in("status", ["new", "triaged"])
          .order("created_at", { ascending: false }).limit(10);
        assertOk("get_current_threats.signals", e1);
        const { data: openIncidents, error: e2 } = await supabase.from("incidents")
          .select("id, title, severity_level, status, incident_type, priority, created_at, opened_at")
          .eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId)
          .in("status", ["open", "acknowledged"])
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
        if (!scope) { result = SCOPE_MISSING; break; }
        const lookbackDays = Number(toolArgs.lookback_days ?? 7);
        const cutoff = new Date(Date.now() - lookbackDays * 864e5).toISOString();
        const { data: signals, error: e } = await supabase.from("signals")
          .select("id, severity, rule_category, created_at")
          .eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId)
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
      case "get_travel_status": {
        // L1C: travel scoped to the validated client (scope.clientId); any user in
        // the client may ask about any traveller in that client. Fail closed.
        if (!scope) { result = SCOPE_MISSING; break; }
        const nameFilter = String(toolArgs.traveler_name ?? "").trim();
        let tq = supabase.from("travelers")
          .select("id, name, status, current_location, current_country")
          .eq("client_id", scope.clientId).order("name");
        if (nameFilter) tq = tq.ilike("name", `%${nameFilter}%`);
        const { data: trav, error: te } = await tq;
        assertOk("get_travel_status.travelers", te);
        const { data: itins, error: ie } = await supabase.from("itineraries")
          .select("id, trip_name, trip_type, status, risk_level, origin_city, destination_city, departure_date, journey_overdue, next_check_in_due_at, travelers:traveler_id(name)")
          .eq("client_id", scope.clientId).order("departure_date", { ascending: false }).limit(50);
        assertOk("get_travel_status.itineraries", ie);
        const { data: tAlerts, error: ae } = await supabase.from("travel_alerts")
          .select("title, severity, alert_type, location, created_at, travelers:traveler_id!inner(name, client_id)")
          .eq("travelers.client_id", scope.clientId).eq("is_active", true)
          .order("created_at", { ascending: false }).limit(20);
        assertOk("get_travel_status.alerts", ae);
        const tnow = Date.now();
        const tOverdue = (itins || []).filter((i: any) => i.trip_type === "ground" && (i.journey_overdue || (i.next_check_in_due_at && new Date(i.next_check_in_due_at).getTime() < tnow)));
        result = {
          travelers: (trav || []).map((t: any) => ({ name: t.name, status: t.status, location: t.current_location, country: t.current_country })),
          journeys: (itins || []).map((i: any) => ({ name: i.trip_name, type: i.trip_type, lead: i.travelers?.name, status: i.status, risk: i.risk_level, from: i.origin_city, to: i.destination_city, overdue: !!i.journey_overdue })),
          active_alerts: (tAlerts || []).map((a: any) => ({ title: a.title, severity: a.severity, type: a.alert_type, location: a.location, traveler: a.travelers?.name })),
          overdue_checkins: tOverdue.map((i: any) => ({ journey: i.trip_name, lead: i.travelers?.name, due: i.next_check_in_due_at })),
          summary: `${trav?.length || 0} travellers, ${itins?.length || 0} journeys, ${tAlerts?.length || 0} active alerts, ${tOverdue.length} overdue check-ins`,
        };
        break;
      }
      case "query_fortress_data": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const limit = Number(toolArgs.limit ?? 20);
        const daysBack = Number(toolArgs.time_range_days ?? 30);
        const cutoff = new Date(Date.now() - daysBack * 864e5).toISOString();
        const results: any = { signals: [], incidents: [], entities: [], documents: [] };
        const { data: signals } = await supabase.from("signals")
          .select("id, title, severity, source_id, created_at, rule_category, status")
          .eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId).gte("created_at", cutoff)
          .order("created_at", { ascending: false }).limit(limit);
        results.signals = signals || [];
        const { data: incidents } = await supabase.from("incidents")
          .select("id, title, severity_level, status, priority, incident_type, created_at, opened_at")
          .eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId).gte("created_at", cutoff)
          .order("created_at", { ascending: false }).limit(limit);
        results.incidents = incidents || [];
        const { data: entities } = await supabase.from("entities")
          .select("id, name, type, risk_level, active_monitoring_enabled")
          .eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId).limit(limit);
        results.entities = entities || [];
        let documentCount = 0;
        let reportContent: any = null;
        const { count } = await supabase.from("archival_documents").select("*", { count: "exact", head: true }).eq("client_id", scope.clientId);
        documentCount = count ?? 0;
        const words = queryWords(Array.isArray(toolArgs.keywords) ? toolArgs.keywords.join(" ") : (typeof toolArgs.query === "string" ? toolArgs.query : ""));
        let dq = supabase.from("archival_documents")
          .select("id, filename, summary, upload_date, processing_status")
          .eq("client_id", scope.clientId).order("upload_date", { ascending: false }).limit(60);
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
          const { data: full } = await supabase.from("archival_documents").select("filename, upload_date, content_text").eq("id", top.id).eq("client_id", scope.clientId).maybeSingle();
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
        const totalCount = results.signals.length + results.incidents.length + results.entities.length + results.documents.length;
        result = { found: totalCount > 0, time_range_days: daysBack, total_count: totalCount, document_count: documentCount, ...results, report_content: reportContent, summary: `Found ${results.signals.length} signals, ${results.incidents.length} incidents, ${results.entities.length} entities, ${documentCount} documents` };
        break;
      }
      case "get_document_content": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const rawTerm = (typeof toolArgs.query === "string" && toolArgs.query.trim()) || (typeof toolArgs.document_name === "string" && toolArgs.document_name.trim()) || (Array.isArray(toolArgs.keywords) ? toolArgs.keywords.join(" ") : "");
        const words = queryWords(rawTerm);
        let dq = supabase.from("archival_documents")
          .select("id, filename, summary, upload_date, processing_status, content_text")
          .eq("client_id", scope.clientId).order("upload_date", { ascending: false }).limit(60);
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
      // External web search via Google CSE. EXTERNAL ONLY — no tenant data is sent or
      // returned, so this is safe regardless of client scope. The model must present
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

      // ---- Record mutations (entities) — client+tenant-scoped, fail closed ----
      case "create_entity": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const name = (typeof toolArgs.name === "string" && toolArgs.name.trim()) ? toolArgs.name.trim() : "";
        if (!name) { result = { success: false, message: "I need a name to create an entity." }; break; }
        const { data: existing } = await supabase.from("entities").select("id, name").eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId).ilike("name", name).limit(1).maybeSingle();
        if (existing) { result = { success: false, message: `Entity "${existing.name}" already exists.`, entity_id: existing.id }; break; }
        const { data: sug, error } = await supabase.from("entity_suggestions").insert({
          tenant_id: scope.tenantId,
          client_id: scope.clientId,
          suggested_name: name,
          suggested_type: (typeof toolArgs.type === "string" && toolArgs.type) ? toolArgs.type : "person",
          suggested_aliases: Array.isArray(toolArgs.aliases) ? toolArgs.aliases : null,
          suggested_attributes: toolArgs.description ? { description: String(toolArgs.description) } : null,
          source_type: "voice_assistant",
          source_id: crypto.randomUUID(),
          confidence: 0.85,
          context: `Created via voice: ${toolArgs.description || "no description provided"}`,
          status: "pending",
        }).select("id, suggested_name, suggested_type").single();
        if (error) { console.error("[create_entity]", error); result = { success: false, message: "Couldn't create that entity." }; break; }
        result = { success: true, message: `Proposed new ${sug.suggested_type} "${sug.suggested_name}" — queued for analyst approval.`, suggestion_id: sug.id, status: "pending_approval" };
        break;
      }
      case "update_entity": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const name = (typeof toolArgs.name === "string" && toolArgs.name.trim()) ? toolArgs.name.trim() : "";
        if (!name) { result = { success: false, message: "Which entity should I update?" }; break; }
        const { data: ent } = await supabase.from("entities").select("id, name").eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId).ilike("name", `%${name}%`).order("threat_score", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        if (!ent) { result = { success: false, message: `No entity matching "${name}" for this client.` }; break; }
        const patch: any = { updated_at: new Date().toISOString() };
        if (typeof toolArgs.risk_level === "string") patch.risk_level = toolArgs.risk_level;
        if (typeof toolArgs.threat_score === "number") patch.threat_score = toolArgs.threat_score;
        if (typeof toolArgs.description === "string") patch.description = toolArgs.description;
        if (typeof toolArgs.active_monitoring_enabled === "boolean") patch.active_monitoring_enabled = toolArgs.active_monitoring_enabled;
        if (Object.keys(patch).length === 1) { result = { success: false, message: "Nothing to change — specify risk level, monitoring, threat score, or description." }; break; }
        const { error } = await supabase.from("entities").update(patch).eq("id", ent.id).eq("tenant_id", scope.tenantId).eq("client_id", scope.clientId);
        if (error) { console.error("[update_entity]", error); result = { success: false, message: "Couldn't update that entity." }; break; }
        result = { success: true, message: `Updated ${ent.name}.`, entity_id: ent.id, applied: Object.keys(patch).filter((k) => k !== "updated_at") };
        break;
      }

      // ---- Record mutations (incidents) — reuse manage-incident-ticket backend ----
      case "manage_incident_ticket": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const action = typeof toolArgs.action === "string" ? toolArgs.action.toLowerCase().trim() : "";
        const valid = ["create", "update", "escalate", "close", "resolve", "acknowledge", "add_timeline"];
        if (!valid.includes(action)) { result = { success: false, message: "Specify an action: create, update, escalate, or close." }; break; }
        const reqStatus = typeof toolArgs.status === "string" ? toolArgs.status.toLowerCase().trim() : "";
        const closesOrResolves = action === "close" || action === "resolve"
          || reqStatus === "closed" || reqStatus === "close" || reqStatus === "resolved" || reqStatus === "resolve";
        if (closesOrResolves && toolArgs.confirm !== true) {
          result = { success: false, needs_confirmation: true, message: "Closing or resolving an incident needs the operator's spoken confirmation — confirm, then call again with confirm=true. This applies even via action=update with status closed/resolved." };
          break;
        }
        if (action === "create" && !(typeof toolArgs.title === "string" && toolArgs.title.trim())) {
          result = { success: false, message: "I need a title to open an incident." }; break;
        }
        const { data: tr, error } = await supabase.functions.invoke("manage-incident-ticket", {
          body: {
            tenant_id: scope.tenantId,
            action,
            ticket_system_id: toolArgs.ticket_system_id,
            title: toolArgs.title,
            description: toolArgs.description,
            severity: toolArgs.severity,
            priority: toolArgs.priority,
            status: toolArgs.status,
            incident_type: toolArgs.incident_type,
            client_id: scope.clientId,
            recommended_actions: Array.isArray(toolArgs.recommended_actions) ? toolArgs.recommended_actions : [],
            source: "Fortress AI (Aegis voice)",
          },
        });
        if (error) { console.error("[manage_incident_ticket]", error); result = { success: false, message: `Couldn't ${action} the incident.` }; break; }
        result = { success: true, action, ...(tr || {}), guidance: `Incident ${action} completed — brief the operator on the result, including the incident id/priority.` };
        break;
      }

      // ---- Record mutations (monitoring keywords) — clients.monitoring_keywords ----
      case "manage_monitoring_keywords": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const op = (typeof toolArgs.action === "string" ? toolArgs.action.toLowerCase().trim() : "add") === "remove" ? "remove" : "add";
        const kws = (Array.isArray(toolArgs.keywords) ? toolArgs.keywords : (typeof toolArgs.keywords === "string" ? [toolArgs.keywords] : []))
          .map((k: any) => String(k).trim()).filter((k: string) => k.length > 0);
        if (!kws.length) { result = { success: false, message: "Which keywords should I add or remove?" }; break; }
        const { data: cli } = await supabase.from("clients").select("id, name, monitoring_keywords").eq("id", scope.clientId).eq("tenant_id", scope.tenantId).maybeSingle();
        if (!cli) { result = { success: false, message: "That client isn't in your tenant." }; break; }
        const current: string[] = Array.isArray(cli.monitoring_keywords) ? cli.monitoring_keywords : [];
        let next: string[];
        if (op === "remove") {
          const rm = new Set(kws.map((k: string) => k.toLowerCase()));
          next = current.filter((k) => !rm.has(String(k).toLowerCase()));
        } else {
          const have = new Set(current.map((k) => String(k).toLowerCase()));
          next = [...current, ...kws.filter((k: string) => !have.has(k.toLowerCase()))];
        }
        const { error } = await supabase.from("clients").update({ monitoring_keywords: next, updated_at: new Date().toISOString() }).eq("id", scope.clientId).eq("tenant_id", scope.tenantId);
        if (error) { console.error("[manage_monitoring_keywords]", error); result = { success: false, message: "Couldn't update monitoring keywords." }; break; }
        result = { success: true, action: op, client: cli.name, keyword_count: next.length, changed: kws, message: `${op === "remove" ? "Removed" : "Added"} ${kws.length} keyword(s) for ${cli.name}. Now monitoring ${next.length} terms.` };
        break;
      }

      // ---- Record mutations (reports) — reuse generate-report backend ----
      case "generate_report": {
        if (!scope) { result = SCOPE_MISSING; break; }
        const rtype = (typeof toolArgs.report_type === "string" && toolArgs.report_type) ? toolArgs.report_type : "executive";
        const periodHours = typeof toolArgs.period_hours === "number" ? toolArgs.period_hours
          : (typeof toolArgs.period_days === "number" ? toolArgs.period_days * 24 : 168);
        const { data: rr, error } = await supabase.functions.invoke("generate-report", {
          body: { report_type: rtype, period_hours: periodHours, client_id: scope.clientId },
        });
        if (error) { console.error("[generate_report]", error); result = { success: false, message: "Couldn't generate that report." }; break; }
        result = { success: true, report_type: rtype, ...(rr || {}), guidance: "Report generated. Tell the operator it's ready and how to access it from the Reports area; do NOT invent a download URL." };
        break;
      }

      default:
        // Any other advertised tool (get_entity_info, query_legal_database,
        // generate_intelligence_summary, etc.) is NOT implemented and must not
        // touch tenant data — refuse rather than fall through to anything global.
        result = { error: `Tool not available in voice: ${tool_name}` };
    }
    return new Response(JSON.stringify({ result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[Voice Tool v2] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Tool execution failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
