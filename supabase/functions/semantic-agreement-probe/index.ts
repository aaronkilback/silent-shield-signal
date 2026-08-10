// semantic-agreement-probe — ONE-OFF operator analysis (slice-6 item 4, 2026-08-10).
//
// Runs the EXACT semantic-leg classifier (same buildPrompt + clientContext + gpt-4o-mini +
// CONF_THRESHOLD as classify-shadow-semantic-nightly) over the stored text of the held sets,
// and reports whether the semantic leg's accept/reject AGREES with the deterministic verdict.
//   • This is evidence ABOUT THE SEMANTIC LEG (does it reach the same conclusion?), NOT a
//     re-verdict — the correction lands on the deterministic result regardless.
//   • Write-isolated: reads signals + clients, classifies, RETURNS JSON. Persists NOTHING
//     (one-off analysis; no durable table per no-persistence-without-named-consumer).
//   • match (>=1 client at conf>=0.60) => semantic ACCEPT ; empty => semantic REJECT.
//
// Body: { set: "611" | "665", sample?: number }
//   611 = Kilbacks phase-1 quarantine (deterministic: 610 REJECT / 1 ACCEPT)
//   665 = PECL no-anchor active   (deterministic: ~635 REJECT / 51 ACCEPT)

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const MODEL = "gpt-4o-mini";
const CONF_THRESHOLD = 0.60;
const CONCURRENCY = 8;
const BUDGET_MS = 150_000;

interface ClientRow { id: string; name: string; monitoring_keywords?: string[] | null; competitor_names?: string[] | null; high_value_assets?: string[] | null; locations?: string[] | null; }

function clientContext(clients: ClientRow[]): string {
  return clients.map((c) => {
    const kw = (c.monitoring_keywords || []).slice(0, 20).join(", ");
    const assets = (c.high_value_assets || []).slice(0, 10).join(", ");
    const locs = (c.locations || []).slice(0, 10).join(", ");
    return `- id=${c.id} | name="${c.name}"${kw ? ` | keywords: ${kw}` : ""}${assets ? ` | assets: ${assets}` : ""}${locs ? ` | locations: ${locs}` : ""}`;
  }).join("\n");
}

function buildPrompt(ctx: string, title: string, body: string): string {
  return `You are a relevance classifier for a security-monitoring platform. Decide which monitored client(s), if any, a news item GENUINELY concerns — i.e. it is substantively about that client's organization, people, assets, locations, or monitored topics. Incidental keyword overlap or generic industry news is NOT a match.

MONITORED CLIENTS:
${ctx}

NEWS ITEM:
title: ${title || "(none)"}
body: ${body || "(none)"}

Return STRICT JSON only, no prose:
{"matches":[{"client_id":"<one of the ids above>","confidence":0.0-1.0}]}
Use an empty array when no client genuinely applies. Only include a client at confidence >= 0.6 if you are reasonably sure.`;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const { set = "611", sample = 120 } = await req.json().catch(() => ({}));
    const supabase = createServiceClient();

    const { data: clients, error: cErr } = await supabase
      .from("clients").select("id, name, monitoring_keywords, competitor_names, high_value_assets, locations")
      .eq("status", "active");
    if (cErr) throw new Error(`load clients failed: ${cErr.message}`);
    const clientList = (clients || []) as ClientRow[];
    const validClientIds = new Set(clientList.map((c) => c.id));
    const byId = new Map(clientList.map((c) => [c.id, c.name]));
    const ctx = clientContext(clientList);
    const peclId = clientList.find((c) => c.name === "Petronas Canada")?.id ?? null;

    // Candidate set — deterministic-bucket definitions (see header).
    let q = supabase.from("signals").select("id, title, normalized_text, raw_json, client_id");
    if (set === "611") {
      q = q.ilike("quarantine_reason", "fabricated_client_match_phase1%");
    } else {
      // 665: PECL, active (not quarantined), attributed with NO direct anchor
      // (matched only via competitor:/tier2:/geo — no client_name:/keyword:/asset:/entity:).
      q = q.eq("client_id", peclId).not("quality_status", "eq", "quarantined");
    }
    const { data: rows, error: rErr } = await q.limit(3000);
    if (rErr) throw new Error(`load candidates failed: ${rErr.message}`);

    let candidates = (rows || []) as any[];
    if (set === "665") {
      const hasDirect = (mk: any[]) => (mk || []).some((k: string) =>
        /^(client_name:|keyword:|asset:|entity:)/i.test(k) && !/tier2:/i.test(k));
      candidates = candidates.filter((r) => !hasDirect((r.raw_json?.matched_keywords || [])));
    }
    const total = candidates.length;
    // deterministic bucket for 665 accepts: competitor vs geo/other (from matched_keywords).
    const bucketOf = (r: any): string => {
      if (set === "611") return "kilbacks_phase1";
      const mk = ((r.raw_json?.matched_keywords || [])) as string[];
      if (mk.some((k) => /^competitor:/i.test(k))) return "competitor";
      if (mk.some((k) => /geo|proximity|lat|place/i.test(k))) return "geo";
      return "other_no_anchor";
    };

    // Sample (census when total <= sample).
    const items = candidates.slice(0, Math.max(1, sample));

    const classifyOne = async (item: any) => {
      try {
        const res = await callAiGateway({
          model: MODEL, functionName: "semantic-agreement-probe", skipGuardrails: true,
          messages: [{ role: "user", content: buildPrompt(ctx, item.title || "", (item.normalized_text || "").slice(0, 4000)) }],
        });
        if (!res.content) return { id: item.id, bucket: bucketOf(item), semantic: "error", clients: [] as string[] };
        const parsed = JSON.parse((res.content.match(/[\[{][\s\S]*[\]}]/) || [res.content])[0]);
        const matches = (Array.isArray(parsed?.matches) ? parsed.matches : [])
          .filter((m: any) => m && validClientIds.has(m.client_id) && typeof m.confidence === "number" && m.confidence >= CONF_THRESHOLD);
        return {
          id: item.id, bucket: bucketOf(item),
          semantic: matches.length ? "accept" : "reject",
          clients: matches.map((m: any) => byId.get(m.client_id) || m.client_id),
          matched_pecl: peclId ? matches.some((m: any) => m.client_id === peclId) : false,
        };
      } catch (_e) {
        return { id: item.id, bucket: bucketOf(item), semantic: "error", clients: [] };
      }
    };

    const t0 = Date.now();
    const results: any[] = [];
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      if (Date.now() - t0 >= BUDGET_MS) break;
      results.push(...await Promise.all(items.slice(i, i + CONCURRENCY).map(classifyOne)));
    }

    const accept = results.filter((r) => r.semantic === "accept").length;
    const reject = results.filter((r) => r.semantic === "reject").length;
    const errors = results.filter((r) => r.semantic === "error").length;
    const perBucket: Record<string, any> = {};
    for (const r of results) {
      const b = (perBucket[r.bucket] ||= { accept: 0, reject: 0, error: 0, accept_pecl: 0 });
      b[r.semantic] = (b[r.semantic] || 0) + 1;
      if (r.matched_pecl) b.accept_pecl++;
    }
    return successResponse({
      set, total_in_set: total, evaluated: results.length, elapsed_ms: Date.now() - t0,
      semantic: { accept, reject, errors, accept_rate: results.length ? +(accept / (accept + reject || 1)).toFixed(3) : null },
      per_bucket: perBucket,
      sample_accepts: results.filter((r) => r.semantic === "accept").slice(0, 25).map((r) => ({ id: r.id, clients: r.clients })),
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : String(e), 500);
  }
});
