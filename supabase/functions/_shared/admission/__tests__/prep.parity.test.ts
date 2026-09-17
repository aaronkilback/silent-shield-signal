// DGIC prep-stage parity harness (Phase B, slice 6). Verbatim lift of ingest-signal L512-738:
// signalRaw setup + source_url merge, novelty tracking (recordObservation DB → raw_json.novelty),
// optional website fetch+AI, sourceId source-lookup (404/403), #120 EXTERNAL_UNATTRIBUTED guard
// (warn + env-gated 400), rulesResult. Plus generateTitle + applyRules (pure). DB/AI/fetch/clock/
// strict-flag injected; no real writes/network/AI. Run: deno test --no-check supabase/functions/_shared/admission/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyRules, generateTitle, prep, type PrepWork } from "../profiles/external-crawled.ts";
import { captureConsole, stubSupabase, type TableFixture } from "./_harness.ts";

const FIXED_NOW = Date.UTC(2026, 4, 25, 12, 0, 0);

async function runPrep(workOver: Partial<PrepWork>, opts: {
  fixtures?: Record<string, TableFixture>; recordObservation?: any; extractDomain?: any; callAiGateway?: any; fetchFn?: any; strict?: boolean;
} = {}) {
  const cc = captureConsole();
  const { sb, calls: dbCalls } = stubSupabase(opts.fixtures ?? {});
  const recCalls: any[] = [];
  const deps = {
    supabase: sb,
    recordObservation: opts.recordObservation ?? (async (_s: any, _c: string, k: string, v: string) => { recCalls.push({ kind: k, value: v }); return "OBS"; }),
    extractDomain: opts.extractDomain ?? (() => null),
    callAiGateway: opts.callAiGateway ?? (async () => ({ content: "" })),
    fetchFn: opts.fetchFn ?? (async () => new Response("", { status: 200 })),
    now: () => FIXED_NOW,
    strictSourceAttribution: opts.strict ?? false,
  };
  const w: PrepWork = { raw_json: {}, signalText: "Routine operational update", ...workOver };
  let res: any, threw: any = null;
  try { res = await prep(w, deps as any); } catch (e) { threw = e; } finally { cc.restore(); }
  return { res, w, logs: cc.logs, dbCalls, recCalls };
}
const hasLog = (logs: any[], sub: string) => logs.some((l) => l.msg.includes(sub));

Deno.test("prep: signalRaw setup + source_url merge", async () => {
  const r = await runPrep({ raw_json: { foo: 1 }, source_url: "https://cbc.ca/x" });
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.signalRaw!.foo, 1);
  assertEquals(r.w.signalRaw!.source_url, "https://cbc.ca/x", "source_url merged into raw_json");
});

Deno.test("prep: novelty tracking → recordObservation (DB) + raw_json.novelty mutation", async () => {
  const r = await runPrep(
    { raw_json: {}, source_url: "https://cbc.ca/x", source_key: "rss", client_id: "c1" },
    { extractDomain: () => "cbc.ca" },
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(r.recCalls, [{ kind: "source_domain", value: "cbc.ca" }, { kind: "source_key", value: "rss" }], "novelty DB observations");
  assertEquals(r.w.signalRaw!.novelty, { domain: "OBS", source_key: "OBS" }, "raw_json.novelty mutation");
});

Deno.test("prep: novelty error is non-blocking (caught, warn, no novelty)", async () => {
  const r = await runPrep(
    { raw_json: {}, source_url: "https://cbc.ca/x", source_key: "rss", client_id: "c1" },
    { extractDomain: () => "cbc.ca", recordObservation: async () => { throw new Error("baseline down"); } },
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(hasLog(r.logs, "[Novelty] non-blocking error:"), true);
  assertEquals(r.w.signalRaw!.novelty, undefined, "no novelty on error");
});

Deno.test("prep: sourceId resolved (active source)", async () => {
  const r = await runPrep({ source_key: "rss", source_url: "https://cbc.ca/x" }, { fixtures: { sources: { data: { id: "s1", status: "active" } } } });
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.sourceId, "s1");
});

Deno.test("prep: source not found → 404 terminal", async () => {
  const r = await runPrep({ source_key: "ghost" }, { fixtures: { sources: { data: null, error: { message: "no rows" } } } });
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.httpStatusHint, 404);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ error: "Source not found or inactive" }));
  }
});

Deno.test("prep: source inactive → 403 terminal", async () => {
  const r = await runPrep({ source_key: "rss" }, { fixtures: { sources: { data: { id: "s1", status: "paused" } } } });
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.httpStatusHint, 403);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ error: "Source rss status=paused" }));
  }
});

Deno.test("prep: EXTERNAL_UNATTRIBUTED guard warns; continues when strict off", async () => {
  const r = await runPrep({ source_url: "https://cbc.ca/x", is_test_input: false });
  assertEquals(r.res.kind, "continue");
  assertEquals(hasLog(r.logs, "[ingest-signal] EXTERNAL_UNATTRIBUTED"), true);
});

Deno.test("prep: strict attribution → 400 terminal", async () => {
  const r = await runPrep({ source_url: "https://cbc.ca/x", source_key: null, is_test_input: false }, { strict: true });
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.httpStatusHint, 400);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ error: "External signal blocked: missing source attribution", message: "Signals with source_url must pass a source_key that matches a registered sources row. Set source_key, register the source in the sources table, or set INGEST_STRICT_SOURCE_ATTRIBUTION=false to bypass this guard.", source_url: "https://cbc.ca/x", source_key_provided: null }));
  }
});

Deno.test("prep: rulesResult from applyRules (P1 keyword)", async () => {
  const r = await runPrep({ signalText: "There is a bomb threat at the facility", source_url: "https://cbc.ca/x" });
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.rulesResult.severity, "critical");
  assertEquals(r.w.rulesResult.matchedRule, "p1");
});

Deno.test("prep: website path (url) → fetch+AI, signalText/signalRaw rewritten", async () => {
  const r = await runPrep(
    { url: "https://example-news.test/article", raw_json: {}, signalText: "orig" },
    { fetchFn: async () => new Response("<html><main>Big protest downtown</main></html>", { status: 200 }), callAiGateway: async () => ({ content: "THREAT: protest" }) },
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.signalText, "Website Analysis - https://example-news.test/article\n\nTHREAT: protest");
  assertEquals(r.w.signalRaw!.analysis, "THREAT: protest");
  assertEquals(r.w.signalLocation, "https://example-news.test/article");
});

Deno.test("prep: website fetch failure → error signalText/signalRaw", async () => {
  const r = await runPrep(
    { url: "https://example-news.test/down", raw_json: {}, signalText: "orig" },
    { fetchFn: async () => new Response("", { status: 503 }) },
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.signalText, "Failed to scan website https://example-news.test/down: Failed to fetch website: 503");
  assertEquals(r.w.signalRaw!.error, "Failed to fetch website: 503");
});

// ── generateTitle (pure) ──
Deno.test("generateTitle: sentence-end honored", () => {
  assertEquals(generateTitle("Pipeline protest planned in northern BC. More details follow.", () => FIXED_NOW), "Pipeline protest planned in northern BC.");
});
Deno.test("generateTitle: abbreviation does not split", () => {
  // 'Dr.' at idx<30 is skipped by the idx<30 guard anyway; use a longer lead-in to exercise ABBREV_RE
  assertEquals(generateTitle("A senior official known widely as Dr. Smith warned of risk today. Next.", () => FIXED_NOW), "A senior official known widely as Dr. Smith warned of risk today.");
});
Deno.test("generateTitle: long no-sentence text truncates with ellipsis", () => {
  const long = "x".repeat(250);
  const t = generateTitle(long, () => FIXED_NOW);
  assertEquals(t.endsWith("..."), true);
  assertEquals(t.length <= 203, true);
});
Deno.test("generateTitle: empty → timestamp fallback (deterministic via now)", () => {
  assertEquals(generateTitle("", () => FIXED_NOW), "Signal - 2026-05-25T12:00");
});

// ── applyRules (pure) ──
Deno.test("applyRules: p1 / p2 / none", () => {
  assertEquals(applyRules("active shooter reported").severity, "critical");
  assertEquals(applyRules("possible intrusion at gate").severity, "high");
  assertEquals(applyRules("routine weather update").severity, null);
});
