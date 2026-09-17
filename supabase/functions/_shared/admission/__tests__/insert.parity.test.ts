// DGIC insert-stage parity harness (Phase B, slice 5). Verbatim lift of ingest-signal L1672-1866:
// relevance scoring + suppress, event/surface-date, staleness, severity/quality scores, foreign-
// alignment, the signals insert (12th core effect) + success/failure. scoreSignalRelevance,
// foreign-alignment, and the clock are injected; DB stubbed. Asserts the EXACT insert payload,
// success/suppress/failure branches, logs, and that NO real write/network/AI occurs.
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { insert, type InsertWork } from "../profiles/external-crawled.ts";
import { captureConsole, stubSupabase, type TableFixture } from "./_harness.ts";

const FIXED_NOW = Date.UTC(2026, 4, 25, 12, 0, 0); // 2026-05-25T12:00:00.000Z
const NOW_ISO = "2026-05-25T12:00:00.000Z";
const TITLE = "A pipeline protest is planned downtown for next week ahead"; // >50 chars
const FA0 = { score: 0, indicators: [], matched_handles: [], matched_phrases: [] };
const norm = (o: any) => JSON.parse(JSON.stringify(o)); // drop undefined keys, order-independent

function baseWork(over: Partial<InsertWork>): InsertWork {
  return {
    classification: { normalized_text: TITLE, entity_tags: ["Petronas"], location: "BC", category: "protest", severity: "high", confidence: 0.9 },
    signalText: TITLE, source_key: "rss", skip_relevance_gate: false,
    signalRaw: { url: "https://cbc.ca/x", source: "rss" }, signalTitle: TITLE,
    sourceId: "src-1", clientId: "c1", matchedKeywords: ["kw1"], matchConfidence: "explicit",
    source_url: "https://cbc.ca/x", image_url: null, is_test: false, platform: "web", contentHash: "abc123",
    classResultData: { event_date: "2026-05-20" }, ...over,
  };
}

async function runInsert(work: Partial<InsertWork>, fixtures: Record<string, TableFixture>, scoreResult: any, fa = FA0) {
  const cc = captureConsole();
  const { sb, calls: dbCalls } = stubSupabase(fixtures);
  const deps = { supabase: sb, now: () => FIXED_NOW, scoreSignalRelevance: async () => scoreResult, extractMentions: () => [], scoreForeignAlignment: () => fa };
  let res: any, threw: any = null;
  try { res = await insert(baseWork(work), deps as any); } catch (e) { threw = e; } finally { cc.restore(); }
  const sigRec = dbCalls.find((c) => c.table === "signals");
  return { res, threw, logs: cc.logs, dbCalls, payload: sigRec?.writes?.[0]?.payload };
}
const hasLog = (logs: any[], sub: string) => logs.some((l) => l.msg.includes(sub));

Deno.test("insert: relevance suppress → terminal, no signals write", async () => {
  const r = await runInsert({}, {}, { score: 0.1, recommendation: "suppress", matchedPatterns: ["p1"], reason: "noise pattern" });
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ status: "suppressed", reason: "noise pattern", relevance_score: 0.1, matched_patterns: ["p1"], message: "Signal suppressed by relevance filter based on learned patterns" }));
  assertEquals(hasLog(r.logs, "[Relevance] Score: 0.10, Recommendation: suppress, Patterns: p1"), true);
  assertEquals(hasLog(r.logs, "[Relevance] SUPPRESSING signal: noise pattern"), true);
  assertEquals(r.dbCalls.find((c) => c.table === "signals"), undefined, "no signals insert on suppress");
});

Deno.test("insert: success → admitted, EXACT insert payload asserted", async () => {
  const r = await runInsert({}, { signals: { data: { id: "sig1" } } }, { score: 0.7, recommendation: "admit", matchedPatterns: [], reason: "ok" });
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.outcome, "admitted");
    assertEquals(r.res.result.signal_id, "sig1");
  }
  // exact payload (deep-equal, undefined keys dropped)
  assertEquals(norm(r.payload), norm({
    source_id: "src-1", client_id: "c1", title: TITLE,
    foreign_alignment_score: null, foreign_alignment_indicators: [],
    raw_json: { url: "https://cbc.ca/x", source: "rss", matched_keywords: ["kw1"], match_confidence: "explicit", match_timestamp: NOW_ISO, relevance_score: 0.7, relevance_patterns: [], relevance_recommendation: "admit" },
    normalized_text: TITLE, entity_tags: ["Petronas"], location: "BC", category: "protest", severity: "high",
    severity_score: 74, quality_score: 1, confidence: 0.9, relevance_score: 0.7, status: "new", is_test: false,
    content_hash: "abc123", event_date: "2026-05-20T00:00:00.000Z", triage_override: null, signal_type: null,
    source_url: "https://cbc.ca/x", image_url: null, platform: "web",
  }));
  assertEquals(hasLog(r.logs, "Signal ingested: sig1 (keywords: kw1)"), true);
});

Deno.test("insert: insertError → throws (failure branch), logs Insert error", async () => {
  const r = await runInsert({}, { signals: { data: null, error: { message: "duplicate key", code: "23505", details: "detail" } } }, { score: 0.7, recommendation: "admit", matchedPatterns: [], reason: "ok" });
  assertEquals(r.res, undefined);
  assertEquals(r.threw instanceof Error, true);
  assertEquals(r.threw.message, "Signal insert failed: duplicate key (code: 23505, details: detail)");
  assertEquals(hasLog(r.logs, "Insert error:"), true);
});

Deno.test("insert: staleness → historical routing (triage_override + signal_type)", async () => {
  const r = await runInsert(
    { signalRaw: { url: "https://cbc.ca/x", pubDate: "2024-01-01" }, classResultData: {} },
    { signals: { data: { id: "sig2" } } },
    { score: 0.7, recommendation: "admit", matchedPatterns: [], reason: "ok" },
  );
  assertEquals(r.res.kind, "terminal");
  assertEquals(r.payload.triage_override, "historical");
  assertEquals(r.payload.signal_type, "historical");
  assertEquals(hasLog(r.logs, "[Staleness] Routing to historical"), true);
});

Deno.test("insert: skip_relevance_gate bypasses staleness even when old", async () => {
  const r = await runInsert(
    { skip_relevance_gate: true, signalRaw: { url: "https://cbc.ca/x", pubDate: "2024-01-01" }, classResultData: {} },
    { signals: { data: { id: "sig3" } } },
    { score: 0.7, recommendation: "admit", matchedPatterns: [], reason: "ok" },
  );
  assertEquals(r.payload.triage_override, null);
  assertEquals(r.payload.signal_type, null);
  assertEquals(hasLog(r.logs, "[Staleness]"), false);
});
