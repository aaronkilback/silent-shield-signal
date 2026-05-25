// DGIC assembly parity harness (Phase B). Proves the composed external/crawled pipeline
// (preGates → classify → dedup → relevance → dgicStage(no-op) → insert) wires the five proven
// stages correctly: stage handoffs, WorkingSignal threading (classify→dedup/relevance/insert),
// terminal short-circuits stop downstream stages, and the signals insert happens ONLY on the
// fully-admitted path. No real writes/network/AI. Run: deno test --no-check supabase/functions/_shared/admission/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runExternalCrawledAdmission } from "../profiles/external-crawled.ts";
import type { WorkingSignal } from "../types.ts";
import { aiReplay, stubSupabase, type TableFixture } from "./_harness.ts";

const FIXED_NOW = Date.UTC(2026, 4, 25, 12, 0, 0);
const TITLE = "A pipeline protest is planned downtown for next week ahead";

function work(over: Partial<WorkingSignal> = {}): WorkingSignal {
  return {
    validatedExplicitClientId: "c1", tenant_broadcast: null, callerKind: "service",
    text: TITLE, event: null, url: null, source_url: "https://cbc.ca/x", source_key: null,
    raw_json: { url: "https://cbc.ca/x" }, signalRaw: { url: "https://cbc.ca/x" }, signalLocation: "BC", signalTitle: TITLE,
    rulesSeverity: null, explicitClientId: "c1", fallback_category: null, fallback_severity: null, skip_relevance_gate: false, isQaTest: false,
    sourceType: null, rawBodySourceType: null, rawBodyIsTest: false, isTest: false, classResultData: { event_date: "2026-05-20" },
    clientId: "c1", sourceId: "src-1", matchedKeywords: ["explicit_client_override"], matchConfidence: "explicit", image_url: null, platform: "web",
    ...over,
  };
}

function makeCtx(fixtures: Record<string, TableFixture>, invokeResults: Record<string, any>, aiResponses: any[], scoreResult?: any) {
  const { sb, calls: dbCalls, invokeCalls } = stubSupabase(fixtures, invokeResults);
  const { callAiGatewayJson, calls: aiCalls } = aiReplay(aiResponses);
  const tel: any[] = [];
  const ctx = {
    supabase: sb, caller: { kind: "service" }, requestStartedAt: FIXED_NOW, now: () => FIXED_NOW,
    callAiGatewayJson,
    recordTelemetry: (_c: unknown, p: any) => { tel.push(p); },
    scoreSignalRelevance: async () => scoreResult ?? { score: 0.7, recommendation: "admit", matchedPatterns: [], reason: "ok" },
    extractMentions: () => [],
    scoreForeignAlignment: () => ({ score: 0, indicators: [], matched_handles: [], matched_phrases: [] }),
  };
  return { ctx, dbCalls, invokeCalls, aiCalls, tel };
}

const opOn = (dbCalls: any[], table: string, op: string) => dbCalls.some((c) => c.table === table && c.ops.includes(op));
const sigInsertPayload = (dbCalls: any[]) => dbCalls.find((c) => c.table === "signals" && c.writes.length > 0)?.writes[0]?.payload;

const CLASSIFY_OK = { data: { category: "protest", severity: "high", confidence: 90 } };
const RELEVANCE_OK = { data: { score: 0.8, primary_connection: "direct_naming", reason: "named" } };
const ADMIT_FIXTURES = {
  "clients#1": { data: { tenant_id: "t1" } }, feedback_events: { data: [] },
  rejected_content_hashes: { data: null }, "signals#1": { data: null }, "signals#2": { data: null }, "signals#3": { data: { id: "sigZ" } },
  "clients#2": { data: { name: "Petronas", industry: "energy", locations: ["BC"], high_value_assets: ["LNG"] } }, learning_profiles: { data: [] },
};

Deno.test("assembly: full admit → insert; classification threaded; dgicStage no-op reached", async () => {
  const { ctx, dbCalls, aiCalls } = makeCtx(ADMIT_FIXTURES, { "detect-duplicates": { data: { duplicates: [] } } }, [CLASSIFY_OK, RELEVANCE_OK]);
  const res = await runExternalCrawledAdmission(work(), ctx as any);
  assertEquals(res.outcome, "admitted");
  assertEquals(res.signal_id, "sigZ");
  assertEquals(aiCalls.length, 2, "classify + relevance (no same-story)");
  assertEquals(opOn(dbCalls, "signals", "insert"), true, "insert only on admit");
  // WorkingSignal threading: the classify output reached the insert payload
  const p = sigInsertPayload(dbCalls);
  assertEquals(p.category, "protest", "classify category threaded to insert");
  assertEquals(p.severity, "high", "classify severity threaded to insert");
});

Deno.test("assembly: preGates terminal (missing client) → stops; no classify/dedup/relevance/insert", async () => {
  const { ctx, dbCalls, aiCalls, invokeCalls, tel } = makeCtx({}, {}, []);
  const res = await runExternalCrawledAdmission(work({ validatedExplicitClientId: null, tenant_broadcast: null, clientId: null, explicitClientId: null }), ctx as any);
  assertEquals(res.outcome, "rejected");
  assertEquals(res.reason, "missing_client_id");
  assertEquals(aiCalls.length, 0, "classifier never reached");
  assertEquals(invokeCalls.length, 0);
  assertEquals(opOn(dbCalls, "signals", "insert"), false, "no insert");
  assertEquals(tel.length, 1, "#256 telemetry recorded");
});

Deno.test("assembly: classify terminal (unknown reject) → stops before dedup/relevance/insert", async () => {
  const { ctx, dbCalls, aiCalls, invokeCalls } = makeCtx({ "clients#1": { data: { tenant_id: "t1" } }, feedback_events: { data: [] } }, {}, [{ data: { category: "unknown", confidence: 60 } }]);
  const res = await runExternalCrawledAdmission(work(), ctx as any);
  assertEquals(res.outcome, "rejected");
  assertEquals(res.reason, "uncategorizable");
  assertEquals(aiCalls.length, 1, "classify ran; relevance did NOT");
  assertEquals(invokeCalls.length, 0, "dedup detect-duplicates not reached");
  assertEquals(opOn(dbCalls, "signals", "insert"), false);
});

Deno.test("assembly: dedup terminal (URL dup) → stops before relevance/insert", async () => {
  const { ctx, dbCalls, aiCalls, invokeCalls } = makeCtx(
    { "clients#1": { data: { tenant_id: "t1" } }, feedback_events: { data: [] }, rejected_content_hashes: { data: null }, "signals#1": { data: { id: "u1" } } },
    {}, [CLASSIFY_OK]);
  const res = await runExternalCrawledAdmission(work(), ctx as any);
  assertEquals(res.reason, "duplicate_url");
  assertEquals(aiCalls.length, 1, "classify only; relevance not reached");
  assertEquals(invokeCalls.length, 0, "URL dedup hit before detect-duplicates invoke");
  assertEquals(opOn(dbCalls, "signals", "insert"), false);
});

Deno.test("assembly: relevance terminal (low score) → stops before insert; filtered_signals written", async () => {
  const fx = { ...ADMIT_FIXTURES, "signals#3": { data: null } };
  const { ctx, dbCalls, aiCalls } = makeCtx(fx, { "detect-duplicates": { data: { duplicates: [] } } }, [CLASSIFY_OK, { data: { score: 0.1, primary_connection: "none", reason: "no connection" } }]);
  const res = await runExternalCrawledAdmission(work(), ctx as any);
  assertEquals(res.reason, "ai_relevance_gate");
  assertEquals(aiCalls.length, 2);
  assertEquals(opOn(dbCalls, "filtered_signals", "insert"), true, "relevance reject audit write");
  assertEquals(opOn(dbCalls, "signals", "insert"), false, "no insert on relevance reject");
});

Deno.test("assembly: insert suppress → terminal; no signals insert (dgicStage was reached)", async () => {
  const { ctx, dbCalls, aiCalls } = makeCtx(ADMIT_FIXTURES, { "detect-duplicates": { data: { duplicates: [] } } }, [CLASSIFY_OK, RELEVANCE_OK],
    { score: 0.1, recommendation: "suppress", matchedPatterns: ["p1"], reason: "noise" });
  const res = await runExternalCrawledAdmission(work(), ctx as any);
  assertEquals(res.payloadShape, "rejected");
  assertEquals(JSON.stringify(res.body), JSON.stringify({ status: "suppressed", reason: "noise", relevance_score: 0.1, matched_patterns: ["p1"], message: "Signal suppressed by relevance filter based on learned patterns" }));
  assertEquals(aiCalls.length, 2, "reached relevance (then dgicStage, then insert-suppress)");
  assertEquals(opOn(dbCalls, "signals", "insert"), false, "suppress before insert");
});
