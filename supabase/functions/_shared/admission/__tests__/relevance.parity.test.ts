// DGIC relevance-gate parity harness (Phase B, slice 4). Verbatim lift of ingest-signal
// L1419-1670: skip bypass, the 2nd AI call (ingest-signal-relevance-gate) with learning-profile
// bias + Phase3C per-source threshold, reject (filtered_signals + rejected_content_hashes writes)
// / accept, and fail-closed catch (filtered_signals write). AI replayed; DB stubbed; no real
// writes/network/AI. Run: deno test --no-check supabase/functions/_shared/admission/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { relevance, type RelevanceWork } from "../profiles/external-crawled.ts";
import { aiReplay, captureConsole, stubSupabase, type TableFixture } from "./_harness.ts";

const TEXT = "A pipeline protest is planned downtown";
const CLIENT = { data: { name: "Petronas", industry: "energy", locations: ["BC"], high_value_assets: ["LNG"] } };

async function runRel(work: Partial<RelevanceWork>, fixtures: Record<string, TableFixture>, aiResponses: Array<any>) {
  const cc = captureConsole();
  const { sb, calls: dbCalls } = stubSupabase(fixtures);
  const { callAiGatewayJson, calls: aiCalls } = aiReplay(aiResponses);
  const w: RelevanceWork = {
    clientId: "c1", skip_relevance_gate: false, classification: { normalized_text: TEXT }, signalText: TEXT,
    source_url: "https://cbc.ca/x", source_key: null, signalRaw: {}, signalTitle: TEXT,
    sourceType: null, rawBodySourceType: null, isTest: false, ...work,
  };
  let res;
  try { res = await relevance(w, { supabase: sb, callAiGatewayJson }); } finally { cc.restore(); }
  return { res, logs: cc.logs, dbCalls, aiCalls };
}
const hasLog = (logs: any[], sub: string) => logs.some((l) => l.msg.includes(sub));
const opOn = (dbCalls: any[], table: string, op: string) => dbCalls.some((c) => c.table === table && c.ops.includes(op));

Deno.test("relevance: skip_relevance_gate → BYPASSED, continue, no DB/AI", async () => {
  const r = await runRel({ skip_relevance_gate: true }, {}, []);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.dbCalls.length, 0);
  assertEquals(r.aiCalls.length, 0);
  assertEquals(r.logs, [{ level: "log", msg: "[AI Relevance Gate] BYPASSED — upstream keyword matching already vetted this signal" }]);
});

Deno.test("relevance: no clientId → continue, no gate", async () => {
  const r = await runRel({ clientId: null }, {}, []);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.dbCalls.length, 0);
  assertEquals(r.aiCalls.length, 0);
  assertEquals(r.logs, []);
});

Deno.test("relevance: high score → ACCEPTED, continue, no writes", async () => {
  const r = await runRel({}, { clients: CLIENT, learning_profiles: { data: [] } },
    [{ data: { score: 0.8, primary_connection: "direct_naming", reason: "client named" } }]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.aiCalls.length, 1);
  assertEquals(r.aiCalls[0].functionName, "ingest-signal-relevance-gate");
  assertEquals(r.aiCalls[0].extraBody.max_completion_tokens, 120);
  assertEquals(r.aiCalls[0].messages[1].content.includes("CLIENT: Petronas"), true);
  assertEquals(hasLog(r.logs, "[AI Relevance Gate] ACCEPTED (score 0.80, connection: direct_naming): client named"), true);
  assertEquals(opOn(r.dbCalls, "filtered_signals", "insert"), false, "accept writes nothing");
});

Deno.test("relevance: low score → REJECTED, filtered_signals + rejected_content_hashes writes", async () => {
  const r = await runRel({}, { clients: CLIENT, learning_profiles: { data: [] } },
    [{ data: { score: 0.1, primary_connection: "none", reason: "no connection" } }]);
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.httpStatusHint, 200);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ status: "rejected", reason: "ai_relevance_gate", relevance_score: 0.1, primary_connection: "none", detail: "no connection", message: "Signal rejected by AI relevance gate — not actionable intelligence for this client" }));
  }
  assertEquals(hasLog(r.logs, "[AI Relevance Gate] REJECTED (score 0.10): no connection"), true);
  assertEquals(opOn(r.dbCalls, "filtered_signals", "insert"), true, "filtered_signals audit write");
  assertEquals(opOn(r.dbCalls, "rejected_content_hashes", "insert"), true, "rejected hash write");
});

Deno.test("relevance: AI error → fail-closed, filtered_signals(ai_relevance_gate_error) write, terminal", async () => {
  const r = await runRel({}, { clients: CLIENT, learning_profiles: { data: [] } },
    [{ throw: true, error: new Error("gateway 429") }]);
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ status: "rejected", reason: "ai_relevance_gate_error", detail: "gateway 429", message: "Signal rejected because the AI relevance gate could not be evaluated" }));
  }
  assertEquals(hasLog(r.logs, "[AI Relevance Gate] Error (failing closed):"), true);
  assertEquals(opOn(r.dbCalls, "filtered_signals", "insert"), true, "fail-closed audit write");
});

Deno.test("relevance: AI error + qa_test → fail-closed bypassed, continue, no write", async () => {
  const r = await runRel({ sourceType: "qa_test" }, { clients: CLIENT, learning_profiles: { data: [] } },
    [{ throw: true, error: new Error("gateway 429") }]);
  assertEquals(r.res.kind, "continue", "qa_test passes through gate errors");
  assertEquals(hasLog(r.logs, "[AI Relevance Gate] Error (failing closed):"), true);
  assertEquals(opOn(r.dbCalls, "filtered_signals", "insert"), false, "qa_test gate-error writes nothing");
});

Deno.test("relevance: clientForGate null → skip AI, continue", async () => {
  const r = await runRel({}, { clients: { data: null }, learning_profiles: { data: [] } }, []);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.aiCalls.length, 0, "no gate call when client row missing");
  assertEquals(opOn(r.dbCalls, "clients", "select"), true);
  assertEquals(opOn(r.dbCalls, "learning_profiles", "select"), true);
});

Deno.test("relevance: learning-profile lowers threshold (+ injects approved block)", async () => {
  const r = await runRel(
    { classification: { normalized_text: "protest pipeline blockade event" } },
    { clients: CLIENT, learning_profiles: { data: [{ profile_type: "approved_signal_patterns", features: { protest: 5, pipeline: 4, blockade: 3 } }] } },
    [{ data: { score: 0.8, primary_connection: "tactical", reason: "matches approved" } }],
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(hasLog(r.logs, "[Learning] Threshold adjusted by analyst patterns: -0.05 → 0.25"), true);
  assertEquals(r.aiCalls[0].messages[0].content.includes("PATTERNS ANALYSTS HAVE APPROVED: protest, pipeline, blockade"), true);
});

Deno.test("relevance: Phase3C per-source threshold adjustment", async () => {
  const r = await runRel(
    { source_key: "lowcred-src" },
    { clients: CLIENT, learning_profiles: { data: [] }, source_credibility_scores: { data: { current_credibility: 0.4, total_signals: 10 } } },
    [{ data: { score: 0.8, primary_connection: "regulatory", reason: "ok" } }],
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(hasLog(r.logs, "[Phase3C] lowcred-src threshold adjusted: 0.36 (credibility: 0.400, signals: 10)"), true);
  assertEquals(opOn(r.dbCalls, "source_credibility_scores", "select"), true);
});
