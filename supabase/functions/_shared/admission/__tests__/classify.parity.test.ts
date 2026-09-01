// DGIC classify-stage parity harness (Phase B, slice 2). Proves the lifted classifier stage
// (few-shot calibration DB reads, gpt-4o-mini call, result handling, fallback, unknown-reject)
// is behavior-equivalent to legacy ingest-signal L740-982: identical classification mutations,
// identical logs, identical DB-read sequence, and the AI call issued with identical control args
// (model/functionName/dlqOnFailure/user-content/few-shot block). AI content is replayed (stub);
// DB is stubbed. Run: deno test --no-check supabase/functions/_shared/admission/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classify, type ClassifyWork } from "../profiles/external-crawled.ts";
import { aiReplay, captureConsole, stubSupabase, type TableFixture } from "./_harness.ts";

const TEXT = "A protest is planned downtown next week";
// Emitted first whenever explicitClientId is null (no tenant context → few-shot skipped).
const SKIP = { level: "log", msg: "[#130 telemetry] ingest-signal few_shot=skipped reason=no_tenant_context" };

async function runClassify(
  work: Partial<ClassifyWork>,
  fixtures: Record<string, TableFixture>,
  aiResponses: Array<{ data?: any; error?: any }>,
) {
  const cc = captureConsole();
  const { sb, calls: dbCalls } = stubSupabase(fixtures);
  const { callAiGatewayJson, calls: aiCalls } = aiReplay(aiResponses);
  const w: ClassifyWork = {
    signalText: TEXT, signalLocation: null, rulesSeverity: null, explicitClientId: null,
    signalRaw: {}, raw_json: {}, fallback_category: null, fallback_severity: null,
    skip_relevance_gate: false, isQaTest: false, ...work,
  };
  let res;
  try { res = await classify(w, { supabase: sb, callAiGatewayJson }); } finally { cc.restore(); }
  return { res, w, logs: cc.logs, dbTables: dbCalls.map((c) => c.table), aiCalls };
}

const ok = { data: { category: "protest", severity: "high", confidence: 90, normalized_text: "n", entity_tags: [], is_historical: false } };

// ── AI call control-arg parity (asserted in every case) ──
function assertAiCall(aiCalls: any[], signalText = TEXT) {
  assertEquals(aiCalls.length, 1, "exactly one classifier AI call");
  const a = aiCalls[0];
  assertEquals(a.model, "gpt-4o-mini", "model");
  assertEquals(a.functionName, "ingest-signal", "functionName");
  assertEquals(a.dlqOnFailure, true, "dlqOnFailure (DLQ behavior requested)");
  assertEquals(a.dlqPayload?.signalText, signalText.substring(0, 500), "dlqPayload");
  assertEquals(a.messages[1].content, signalText, "user message == signalText");
}

Deno.test("classify: few-shot skipped (no client) + success → continue", async () => {
  const r = await runClassify({ explicitClientId: null }, {}, [ok]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.dbTables, [], "no DB reads without client");
  assertEquals(r.w.classification.category, "protest");
  assertEquals(r.w.classification.severity, "high");
  assertEquals(r.w.classification.confidence, 0.9, "confidence 90 → 0.9");
  assertEquals(r.logs, [{ level: "log", msg: "[#130 telemetry] ingest-signal few_shot=skipped reason=no_tenant_context" }]);
  assertAiCall(r.aiCalls);
  assertEquals(r.aiCalls[0].messages[0].content.includes("ANALYST CALIBRATION EXAMPLES"), false, "no few-shot block");
  assertEquals(r.aiCalls[0].extraContext.few_shot_state, "skipped_no_tenant");
});

Deno.test("classify: few-shot applied (client + feedback) → DB reads + calibration block", async () => {
  const fx = {
    clients: { data: { tenant_id: "t1" } },
    feedback_events: { data: [{ feedback: "irrelevant", notes: "noise", object_id: "s1" }] },
    signals: { data: [{ id: "s1", title: "Old signal", severity: "low", category: "protest" }] },
  };
  const r = await runClassify({ explicitClientId: "c1" }, fx, [{ data: { category: "regulatory", confidence: 90 } }]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.dbTables, ["clients", "feedback_events", "signals"], "few-shot DB read sequence");
  assertEquals(r.logs, [{ level: "log", msg: "[#130 telemetry] ingest-signal few_shot=applied tenant=t1 examples=1" }]);
  assertAiCall(r.aiCalls);
  const sys = r.aiCalls[0].messages[0].content;
  assertEquals(sys.includes("ANALYST CALIBRATION EXAMPLES (learn from these real corrections):"), true, "calibration header present");
  assertEquals(sys.includes(`- IRRELEVANT [protest]: "Old signal" — noise`), true, "example line present");
  assertEquals(r.w.classification.category, "regulatory");
});

Deno.test("classify: few-shot applied_empty (no feedback) → no signals query, applied_empty log", async () => {
  const fx = { clients: { data: { tenant_id: "t1" } }, feedback_events: { data: [] } };
  const r = await runClassify({ explicitClientId: "c1" }, fx, [ok]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.dbTables, ["clients", "feedback_events"], "no signals query when feedback empty");
  assertEquals(r.logs, [{ level: "log", msg: "[#130 telemetry] ingest-signal few_shot=applied_empty tenant=t1 (query returned 0)" }]);
  assertEquals(r.aiCalls[0].messages[0].content.includes("ANALYST CALIBRATION"), false);
});

Deno.test("classify: few-shot error (DB throws) → caught, error log, continues", async () => {
  const fx = { clients: { data: { tenant_id: "t1" } }, feedback_events: { throw: true, error: new Error("db down") } };
  const r = await runClassify({ explicitClientId: "c1" }, fx, [ok]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.logs[0].level, "warn");
  assertEquals(r.logs[0].msg, "[#130 telemetry] ingest-signal few_shot=error tenant=t1 err=db down");
  assertEquals(r.aiCalls[0].extraContext.few_shot_state, "error");
});

Deno.test("classify: scraped-news → normalized_text preserved verbatim (not AI rewrite)", async () => {
  const r = await runClassify({ signalRaw: { source: "google_news_api" } }, {},
    [{ data: { category: "protest", normalized_text: "AI REWROTE THIS", confidence: 90 } }]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.classification.normalized_text, TEXT, "verbatim source text, not AI prose");
  assertEquals(r.w.classification.category, "protest");
});

Deno.test("classify: confidence > 1 normalized to 0-1", async () => {
  const r = await runClassify({}, {}, [{ data: { category: "protest", confidence: 73 } }]);
  assertEquals(r.w.classification.confidence, 0.73);
});

Deno.test("classify: skip_relevance_gate floors low confidence to 0.80", async () => {
  const r = await runClassify({ skip_relevance_gate: true }, {}, [{ data: { category: "protest", confidence: 50 } }]);
  assertEquals(r.w.classification.confidence, 0.8, "50 → 0.5 → floored to 0.80");
});

Deno.test("classify: rules severity overrides AI severity", async () => {
  const r = await runClassify({ rulesSeverity: "critical" }, {}, [{ data: { category: "protest", severity: "low", confidence: 90 } }]);
  assertEquals(r.w.classification.severity, "critical");
});

Deno.test("classify: historical guardrail forces severity low + logs", async () => {
  const r = await runClassify({}, {}, [{ data: { category: "protest", is_historical: true, confidence: 90 } }]);
  assertEquals(r.w.classification.severity, "low");
  assertEquals(r.logs, [SKIP, { level: "log", msg: "[HISTORICAL GUARDRAIL] AI classified signal as historical — forcing severity to low" }]);
});

Deno.test("classify: fallback_category applied when AI returns unknown", async () => {
  const r = await runClassify({ fallback_category: "wildfire", fallback_severity: "high" }, {},
    [{ data: { category: "unknown", confidence: 60 } }]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.classification.category, "wildfire");
  assertEquals(r.w.classification.severity, "high");
  assertEquals(r.w.classification.confidence, 0.75, "0.6 → floored to 0.75 for fallback");
  assertEquals(r.logs, [SKIP, { level: "log", msg: "[Classifier Fallback] Using fallback_category=wildfire for monitor-supplied signal" }]);
});

Deno.test("classify: unknown category + no fallback/rules → uncategorizable terminal", async () => {
  const r = await runClassify({}, {}, [{ data: { category: "unknown", confidence: 60 } }]);
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.reason, "uncategorizable");
    assertEquals(r.res.result.httpStatusHint, 200);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ status: "rejected", reason: "uncategorizable", message: "AI classifier could not assign a category — signal lacks structure to be actionable intelligence" }));
  }
  assertEquals(r.logs, [SKIP, { level: "log", msg: `[Category Filter] Rejecting uncategorizable signal: ${TEXT.substring(0, 100)}...` }]);
});

Deno.test("classify: qa_test bypasses unknown-category reject", async () => {
  const r = await runClassify({ isQaTest: true }, {}, [{ data: { category: "unknown", confidence: 60 } }]);
  assertEquals(r.res.kind, "continue");
  assertEquals(r.w.classification.category, "unknown");
});

Deno.test("classify: classifier failure → failed log + DLQ requested + uncategorizable", async () => {
  const r = await runClassify({}, {}, [{ error: "gateway 500" }]);
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") assertEquals(r.res.result.reason, "uncategorizable");
  assertEquals(r.logs, [
    SKIP,
    { level: "warn", msg: `[Classifier] AI classification failed: gateway 500. signalText="${TEXT.substring(0, 120)}"` },
    { level: "log", msg: `[Category Filter] Rejecting uncategorizable signal: ${TEXT.substring(0, 100)}...` },
  ]);
  assertEquals(r.aiCalls[0].dlqOnFailure, true, "DLQ-on-failure requested even though call failed");
});
