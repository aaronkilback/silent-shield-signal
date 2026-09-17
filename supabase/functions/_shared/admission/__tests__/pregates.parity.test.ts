// DGIC pre-gates parity harness (Phase B, slice 1).
// Proves the lifted external/crawled pre-gates match the legacy contract: byte-identical
// response body + status, identical telemetry side-effects, identical log semantics, with the
// approved nondeterminism allowlist (timestamps / durationMs) normalized. Pre-gates are
// deterministic (one side-effect: the #256 recordTelemetry, captured via injection), so the
// goldens ARE the legacy contract (traced verbatim from ingest-signal L287-510). Run:
//   deno test --no-check supabase/functions/_shared/admission/
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { preGates, type PreGateInput } from "../profiles/external-crawled.ts";

const FIXED_NOW = Date.UTC(2026, 4, 25); // 2026-05-25 — deterministic clock (year=2026 for stale-CVE)

type Log = { level: "log" | "warn" | "error"; msg: string };
type Golden = {
  kind: "terminal" | "continue";
  httpStatusHint?: number;
  reason?: string;
  body?: unknown;
  telemetry?: Record<string, unknown>[]; // durationMs-normalized
  logs: Log[];
  rawJsonAfter?: Record<string, unknown> | null;
  fallbackSeverityAfter?: string | null;
};

// Capture console + telemetry, run preGates with the fixed clock, normalize nondeterminism.
async function run(input: PreGateInput) {
  const logs: Log[] = [];
  const tel: Record<string, unknown>[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (m: unknown) => logs.push({ level: "log", msg: String(m) });
  console.warn = (m: unknown) => logs.push({ level: "warn", msg: String(m) });
  console.error = (m: unknown) => logs.push({ level: "error", msg: String(m) });
  let res;
  try {
    res = await preGates(input, {
      supabase: {},
      recordTelemetry: (_c, p) => { tel.push(p); },
      now: () => FIXED_NOW,
      requestStartedAt: FIXED_NOW, // durationMs = 0; normalized out anyway
    });
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error;
  }
  // nondeterminism allowlist: strip durationMs from telemetry
  const telN = tel.map((p) => { const c = { ...p }; delete (c as any).durationMs; return c; });
  return { res, logs, tel: telN, raw: input.raw_json, fb: input.fallback_severity };
}

function base(over: Partial<PreGateInput>): PreGateInput {
  return { validatedExplicitClientId: "c1", tenant_broadcast: null, source_key: "src", text: null,
    event: null, url: null, source_url: null, raw_json: {}, fallback_severity: null,
    skip_relevance_gate: false, callerKind: "service", ...over };
}

const CBC = "https://cbc.ca/news/real-story";

const CASES: Array<{ name: string; input: PreGateInput; golden: Golden }> = [
  {
    name: "missing_client_id → 400 + telemetry",
    input: base({ validatedExplicitClientId: null, tenant_broadcast: null, source_key: "x", text: "hello" }),
    golden: { kind: "terminal", httpStatusHint: 400, reason: "missing_client_id",
      body: { status: "rejected", reason: "missing_client_id", message: "client_id is required. Cross-tenant signal scoring was removed 2026-05-23 (#256) — callers must pass an explicit client_id or use tenant_broadcast (Phase 3, not yet implemented).", ticket: "#256", phase: 1, source_key: "x" },
      telemetry: [{ functionName: "ingest-signal", status: "error", errorClass: "other", errorMessage: "contract_rejected:missing_client_id", context: { rejection_reason: "missing_client_id", ticket: "#256", phase: 1, source_key: "x", caller_kind: "service" } }],
      logs: [{ level: "warn", msg: `[#256 Phase 1] REJECTED: signal lacks client_id and tenant_broadcast. source_key=x preview="hello"` }] },
  },
  {
    name: "tenant_broadcast → 501 + telemetry",
    input: base({ validatedExplicitClientId: null, tenant_broadcast: { scope: "industry" }, source_key: "x", text: "hello" }),
    golden: { kind: "terminal", httpStatusHint: 501, reason: "broadcast_not_implemented",
      body: { status: "rejected", reason: "broadcast_not_implemented", message: "tenant_broadcast routing (scope=industry) is reserved for #256 Phase 3 and not yet implemented. Until then, pass an explicit client_id.", ticket: "#256", phase: 1 },
      telemetry: [{ functionName: "ingest-signal", status: "error", errorClass: "other", errorMessage: "contract_rejected:broadcast_not_implemented", context: { rejection_reason: "broadcast_not_implemented", ticket: "#256", phase: 1, broadcast_scope: "industry", source_key: "x", caller_kind: "service" } }],
      logs: [{ level: "warn", msg: `[#256 Phase 1] tenant_broadcast rejected: routing not yet implemented (scope=industry)` }] },
  },
  {
    name: "F-034.1 null_source_url → 200",
    input: base({ text: "something" }),
    golden: { kind: "terminal", httpStatusHint: 200, reason: "null_source_url",
      body: { status: "rejected", reason: "null_source_url", message: "source_url required for auditable signal provenance" },
      telemetry: [], logs: [{ level: "log", msg: `[F-034.1] Reject — null source_url, not pre-vetted: "something"` }] },
  },
  {
    name: "F-034.1 bypass via skip_relevance_gate → continue",
    input: base({ text: "pre-vetted alert", skip_relevance_gate: true }),
    golden: { kind: "continue", telemetry: [], logs: [], rawJsonAfter: {}, fallbackSeverityAfter: null },
  },
  {
    name: "F-034.2 MSN aggregator → 200",
    input: base({ source_url: "https://www.msn.com/en-ca/news/x", text: "story" }),
    golden: { kind: "terminal", httpStatusHint: 200, reason: "aggregator_url_not_canonical",
      body: { status: "rejected", reason: "aggregator_url_not_canonical", message: "aggregator-hosted URLs produce chimeric signals; follow to publisher URL or drop" },
      telemetry: [], logs: [{ level: "log", msg: `[F-034.2] Reject — MSN aggregator (paragraph-merger risk): https://www.msn.com/en-ca/news/x` }] },
  },
  {
    name: "F-034.3 paragraph-fragment title → 200",
    input: base({ source_url: CBC, raw_json: { title: "…continued story" }, text: "body" }),
    golden: { kind: "terminal", httpStatusHint: 200, reason: "paragraph_fragment_title",
      body: { status: "rejected", reason: "paragraph_fragment_title", message: "title is a mid-sentence snippet, not a coherent headline" },
      telemetry: [], logs: [{ level: "log", msg: `[F-034.3] Reject — paragraph-fragment title: "…continued story"` }] },
  },
  {
    name: "F-034.4 opinion severity cap → continue + mutation",
    input: base({ source_url: "https://cbc.ca/opinion/abc", text: "an opinion piece", fallback_severity: "high", raw_json: {} }),
    golden: { kind: "continue", telemetry: [],
      logs: [{ level: "log", msg: `[F-034.4] Severity capped to 'low' (opinion URL): https://cbc.ca/opinion/abc` }],
      rawJsonAfter: { severity_capped_by_governance: true }, fallbackSeverityAfter: "low" },
  },
  {
    name: "F-034.5 source-class canonicalization → continue + mutation",
    input: base({ source_url: "https://x.com/u/status/1", text: "a tweet here", raw_json: { source: "google_news_api" } }),
    golden: { kind: "continue", telemetry: [], logs: [],
      rawJsonAfter: { source: "twitter", source_class_corrected_by_governance: true } },
  },
  {
    name: "F-034.8 stale CVE → 200",
    input: base({ source_url: CBC, text: "CVE-2016-3714 issue" }),
    golden: { kind: "terminal", httpStatusHint: 200, reason: "stale_advisory",
      body: { status: "rejected", reason: "stale_advisory", message: "CVE-2016-3714 is 10 years old; refusing to surface as current threat intel" },
      telemetry: [], logs: [{ level: "log", msg: `[F-034.8] Reject stale CVE — CVE-2016-3714 (10y old): "CVE-2016-3714 issue"` }] },
  },
  {
    name: "fresh CVE → continue",
    input: base({ source_url: CBC, text: "CVE-2024-1234 note" }),
    golden: { kind: "continue", telemetry: [], logs: [], rawJsonAfter: {}, fallbackSeverityAfter: null },
  },
  {
    name: "F-034.9 null-result → 200",
    input: base({ source_url: CBC, text: "no recent news found" }),
    golden: { kind: "terminal", httpStatusHint: 200, reason: "null_result_signal",
      body: { status: "rejected", reason: "null_result_signal", message: "signal content reports the search itself found nothing; not actionable intelligence" },
      telemetry: [], logs: [{ level: "log", msg: `[F-034.9] Reject — null-result signal (search reported nothing actionable): "no recent news found"` }] },
  },
  {
    name: "F-034.7 relevance_score normalization → continue + mutation",
    input: base({ source_url: CBC, text: "real news", raw_json: { relevance_score: 85 } }),
    golden: { kind: "continue", telemetry: [], logs: [],
      rawJsonAfter: { relevance_score: 0.85, relevance_score_raw: 85, relevance_score_normalized_by_governance: true } },
  },
  {
    name: "FP filter → 200",
    input: base({ source_url: CBC, text: "Bakersfield College news" }),
    golden: { kind: "terminal", httpStatusHint: 200, reason: "false_positive_pattern",
      body: { status: "rejected", reason: "false_positive_pattern", message: "Content matches known false positive pattern" },
      telemetry: [], logs: [{ level: "log", msg: `[FP Filter] Rejecting false positive signal: Bakersfield College news...` }] },
  },
  {
    name: "test filter → 200",
    input: base({ source_url: CBC, text: "this is a test signal" }),
    golden: { kind: "terminal", httpStatusHint: 200, reason: "test_content",
      body: { status: "rejected", reason: "test_content", message: "Test/verification content rejected from production pipeline" },
      telemetry: [], logs: [{ level: "log", msg: `[Test Filter] Rejecting test content: this is a test signal...` }] },
  },
  {
    name: "clean pass-through → continue (no mutation, no log)",
    input: base({ source_url: CBC, text: "A real security incident occurred downtown" }),
    golden: { kind: "continue", telemetry: [], logs: [], rawJsonAfter: {}, fallbackSeverityAfter: null },
  },
];

for (const c of CASES) {
  Deno.test(`pre-gates parity: ${c.name}`, async () => {
    const out = await run(c.input);
    assertEquals(out.res.kind, c.golden.kind, "stage kind");
    if (c.golden.kind === "terminal" && out.res.kind === "terminal") {
      assertEquals(out.res.result.httpStatusHint, c.golden.httpStatusHint, "http status");
      assertEquals(out.res.result.reason, c.golden.reason, "reason");
      // byte-parity of the response body
      assertEquals(JSON.stringify(out.res.result.body), JSON.stringify(c.golden.body), "response body");
    }
    assertEquals(out.tel, c.golden.telemetry ?? [], "telemetry effects");
    assertEquals(out.logs, c.golden.logs, "log semantics");
    if (c.golden.rawJsonAfter !== undefined) assertEquals(out.raw, c.golden.rawJsonAfter, "raw_json mutations");
    if (c.golden.fallbackSeverityAfter !== undefined) assertEquals(out.fb ?? null, c.golden.fallbackSeverityAfter, "fallback_severity");
  });
}
