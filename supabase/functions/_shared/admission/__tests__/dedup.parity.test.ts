// DGIC dedup-stage parity harness (Phase B, slice 3). Verbatim lift of ingest-signal L1024-1303:
// content-hash + previously-rejected, CVE/URL/title dedup, detect-duplicates invoke (exact 409 /
// near-dup 200), and the 0.5-0.8 same-story path. DB + functions.invoke + AI are stubbed; no real
// writes/network/AI. Asserts stage outcome, byte-exact bodies, logs, and the DB write sequence —
// including the PRESERVED LEGACY DEFECT: the same-story signal_updates filing throws (TDZ on
// `signal`) → fail-open, so NO signal_updates insert and NO rejected_content_hashes upsert occur.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dedup, type DedupWork } from "../profiles/external-crawled.ts";
import { aiReplay, captureConsole, stubSupabase, type TableFixture } from "./_harness.ts";

const FIXED_NOW = Date.UTC(2026, 4, 25, 12, 0, 0);
const TITLE = "A pipeline protest is planned in northern BC next week";

async function runDedup(
  work: Partial<DedupWork>,
  fixtures: Record<string, TableFixture>,
  invokeResults: Record<string, { data?: any; error?: any }> = {},
  aiResponses: Array<any> = [],
) {
  const cc = captureConsole();
  const { sb, calls: dbCalls, invokeCalls } = stubSupabase(fixtures, invokeResults);
  const { callAiGatewayJson, calls: aiCalls } = aiReplay(aiResponses);
  const w: DedupWork = {
    signalText: TITLE, source_url: null, classification: { normalized_text: TITLE }, clientId: "c1",
    sourceType: null, rawBodySourceType: null, rawBodyIsTest: false, isTest: false, ...work,
  };
  let res;
  try { res = await dedup(w, { supabase: sb, callAiGatewayJson, now: () => FIXED_NOW }); } finally { cc.restore(); }
  return { res, logs: cc.logs, dbCalls, invokeCalls, aiCalls };
}

const hashLog = (logs: any[]) => logs.some((l) => /^Calculated content hash: [0-9a-f]{16}\.\.\. \(basis: (source_url|text)\)$/.test(l.msg));
const hasLog = (logs: any[], sub: string) => logs.some((l) => l.msg.includes(sub));
const opOn = (dbCalls: any[], table: string, op: string) => dbCalls.some((c) => c.table === table && c.ops.includes(op));
const tableCount = (dbCalls: any[], table: string) => dbCalls.filter((c) => c.table === table).length;

Deno.test("dedup: previously rejected → terminal", async () => {
  const r = await runDedup({ source_url: "https://cbc.ca/a" }, { rejected_content_hashes: { data: { id: "r1" } } });
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.httpStatusHint, 200);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ status: "rejected", reason: "previously_rejected", message: "This content was previously deleted or marked irrelevant by an analyst" }));
  }
  assertEquals(hashLog(r.logs), true);
  assertEquals(hasLog(r.logs, "[Rejected] Signal blocked"), true);
});

Deno.test("dedup: qa_test bypasses all dedup → continue, no DB/invoke", async () => {
  const r = await runDedup({ source_url: "https://cbc.ca/a", sourceType: "qa_test" }, {});
  assertEquals(r.res.kind, "continue");
  assertEquals(r.dbCalls.length, 0, "no DB reads under qa_test");
  assertEquals(r.invokeCalls.length, 0, "no detect-duplicates under qa_test");
});

Deno.test("dedup: CVE duplicate → terminal", async () => {
  const r = await runDedup(
    { signalText: "Advisory CVE-2024-1234 affects industrial systems", source_url: "https://cbc.ca/cve" },
    { rejected_content_hashes: { data: null }, signals: { data: [{ id: "cve1", title: "x" }] } },
  );
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.httpStatusHint, 200);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ filtered: true, reason: "duplicate_cve", cve_ids: ["CVE-2024-1234"], existing_signal_id: "cve1", message: "CVE advisory already ingested today: CVE-2024-1234" }));
  }
  assertEquals(hasLog(r.logs, "[CVE-dedup] Duplicate CVE advisory blocked: CVE-2024-1234"), true);
});

Deno.test("dedup: URL duplicate (30d) → terminal", async () => {
  const r = await runDedup(
    { signalText: TITLE, source_url: "https://cbc.ca/url-dup" },
    { rejected_content_hashes: { data: null }, signals: { data: { id: "u1" } } },
  );
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ status: "suppressed", reason: "duplicate_url", existing_signal_id: "u1" }));
  assertEquals(hasLog(r.logs, "[URL-dedup] Duplicate source URL blocked: https://cbc.ca/url-dup"), true);
});

Deno.test("dedup: title duplicate (24h, no source_url) → terminal", async () => {
  const r = await runDedup(
    { signalText: TITLE, source_url: null },
    { rejected_content_hashes: { data: null }, signals: { data: { id: "t1" } } },
  );
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ status: "suppressed", reason: "duplicate_title", existing_signal_id: "t1" }));
  assertEquals(hasLog(r.logs, "[Title-dedup] Duplicate title blocked:"), true);
});

Deno.test("dedup: detect-duplicates EXACT → 409 terminal", async () => {
  const r = await runDedup(
    { signalText: "Unique downtown protest event", source_url: "https://cbc.ca/exact" },
    { rejected_content_hashes: { data: null }, "signals#1": { data: null }, "signals#2": { data: null } },
    { "detect-duplicates": { data: { isDuplicate: true, exactMatch: true, duplicate: { id: "d1" }, message: "Exact match found" } } },
  );
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") {
    assertEquals(r.res.result.httpStatusHint, 409);
    assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ error: "Duplicate signal detected and blocked", duplicate_of: "d1", message: "Exact match found" }));
  }
  assertEquals(r.invokeCalls[0].name, "detect-duplicates");
  assertEquals(r.invokeCalls[0].body.near_duplicate_threshold, 0.8);
  assertEquals(r.invokeCalls[0].body.client_id, "c1");
});

Deno.test("dedup: detect-duplicates NEAR (>=0.8) → 200 terminal", async () => {
  const r = await runDedup(
    { signalText: "Another unique event", source_url: "https://cbc.ca/near" },
    { rejected_content_hashes: { data: null }, "signals#1": { data: null }, "signals#2": { data: null } },
    { "detect-duplicates": { data: { nearDuplicateMatch: true, duplicates: [{ id: "n1", similarity_score: 0.9 }], lookback_days_used: 30, near_duplicate_threshold_used: 0.8 } } },
  );
  assertEquals(r.res.kind, "terminal");
  if (r.res.kind === "terminal") assertEquals(JSON.stringify(r.res.result.body), JSON.stringify({ signal_id: "n1", deduplicated: true, duplicate_of: "n1", similarity_score: 0.9, lookback_days: 30, threshold: 0.8, message: "Near-duplicate detected (similarity 0.90). Returning existing signal." }));
  assertEquals(hasLog(r.logs, "NEAR duplicate detected"), true);
});

Deno.test("dedup: same-story (0.5-0.8) same_story=true → PRESERVED TDZ throw → fail-open continue, NO writes", async () => {
  const r = await runDedup(
    { signalText: "Ongoing story coverage", source_url: "https://cbc.ca/story" },
    { rejected_content_hashes: { data: null }, "signals#1": { data: null }, "signals#2": { data: null }, signal_updates: { data: null } },
    { "detect-duplicates": { data: { duplicates: [{ id: "s1", similarity_score: 0.65, title: "Existing story" }] } } },
    [{ same_story: true, has_new_intel: false, reason: "same event" }],
  );
  assertEquals(r.res.kind, "continue", "fails open to creating a new signal (legacy TDZ defect)");
  // the same-story AI ran
  assertEquals(r.aiCalls.length, 1);
  assertEquals(r.aiCalls[0].functionName, "ingest-signal-same-story-check");
  assertEquals(hasLog(r.logs, "[Same-Story] Moderate similarity 65%"), true);
  assertEquals(hasLog(r.logs, "[Same-Story] FILING as update on s1"), true);
  assertEquals(hasLog(r.logs, "[Same-Story] AI check failed, proceeding with new signal:"), true, "TDZ throw caught → fail-open log");
  // the existingUpdate SELECT ran...
  assertEquals(opOn(r.dbCalls, "signal_updates", "select"), true);
  // ...but the DEAD signal_updates INSERT and rejected_content_hashes UPSERT never dispatch
  assertEquals(opOn(r.dbCalls, "signal_updates", "insert"), false, "signal_updates insert is dead code (TDZ)");
  assertEquals(opOn(r.dbCalls, "rejected_content_hashes", "upsert"), false, "same-story rejected-hash upsert never reached");
});

Deno.test("dedup: same-story (0.5-0.8) different story → continue, no signal_updates access", async () => {
  const r = await runDedup(
    { signalText: "Different event entirely", source_url: "https://cbc.ca/diff" },
    { rejected_content_hashes: { data: null }, "signals#1": { data: null }, "signals#2": { data: null } },
    { "detect-duplicates": { data: { duplicates: [{ id: "s2", similarity_score: 0.6, title: "Other" }] } } },
    [{ same_story: false, reason: "different" }],
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(r.aiCalls.length, 1);
  assertEquals(hasLog(r.logs, "[Same-Story] AI says different story"), true);
  assertEquals(tableCount(r.dbCalls, "signal_updates"), 0, "different story never touches signal_updates");
});

Deno.test("dedup: low similarity (<0.5) → continue, no same-story AI", async () => {
  const r = await runDedup(
    { signalText: "Loosely related item", source_url: "https://cbc.ca/low" },
    { rejected_content_hashes: { data: null }, "signals#1": { data: null }, "signals#2": { data: null } },
    { "detect-duplicates": { data: { duplicates: [{ id: "x", similarity_score: 0.3 }] } } },
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(r.aiCalls.length, 0, "no same-story AI below 0.5");
});

Deno.test("dedup: clean (no duplicates) → continue", async () => {
  const r = await runDedup(
    { signalText: "Wholly novel security incident report", source_url: "https://cbc.ca/clean" },
    { rejected_content_hashes: { data: null }, "signals#1": { data: null }, "signals#2": { data: null } },
    { "detect-duplicates": { data: { duplicates: [] } } },
  );
  assertEquals(r.res.kind, "continue");
  assertEquals(r.aiCalls.length, 0);
  assertEquals(r.invokeCalls[0].name, "detect-duplicates");
});
