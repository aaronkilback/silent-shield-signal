#!/usr/bin/env node
/**
 * AEGIS Tool Health Check
 * Tests all 103 tools by calling executeTool directly via the dashboard-ai-assistant
 * health-check endpoint (service role only).
 *
 * Usage:
 *   node scripts/test-aegis-tools.mjs
 *   node scripts/test-aegis-tools.mjs --tool get_recent_signals   # single tool
 *   node scripts/test-aegis-tools.mjs --filter cyber              # tools matching pattern
 *   node scripts/test-aegis-tools.mjs --concurrency 5             # parallel batch size
 */

const SUPABASE_URL = "https://kpuqukppbmwebiptqmog.supabase.co";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs";
const ENDPOINT = `${SUPABASE_URL}/functions/v1/dashboard-ai-assistant`;
const PECL_CLIENT_ID = "0f5c809d-c928-4cae-b9c7-72b8ae2ef565";

// ── Default args for each tool ──────────────────────────────────────────────
// Minimal valid args that should return data without side effects.
// Tools marked skip:true are write/destructive ops — excluded from automated runs.
const TOOLS = [
  { name: "get_recent_signals",            args: { limit: 5 } },
  { name: "get_active_incidents",          args: { limit: 5 } },
  { name: "get_monitored_signals",         args: { limit: 5 } },
  { name: "get_monitoring_status",         args: {} },
  { name: "get_system_health",             args: {} },
  { name: "get_database_schema",           args: {} },
  { name: "get_knowledge_base_categories", args: {} },
  { name: "get_security_reports",          args: {} },
  { name: "get_tech_radar",               args: {} },
  { name: "get_user_memory",              args: { category: "all" }, skip: true },
  { name: "get_global_learning_insights", args: {} },
  { name: "get_cross_tenant_patterns",    args: {} },
  { name: "get_signal_contradictions",    args: { entity_name: "Petronas" } },
  { name: "get_analyst_accuracy",         args: {} },
  { name: "get_knowledge_freshness",      args: {} },
  { name: "get_agent_responses",          args: {} },
  { name: "list_edge_functions",          args: {} },
  { name: "list_source_files",            args: {} },
  { name: "list_expert_profiles",         args: {} },
  { name: "search_clients",              args: { query: "petronas" } },
  { name: "search_entities",             args: { query: "Petronas" } },
  { name: "search_signals_by_entity",    args: { entity_name: "Petronas" } },
  { name: "search_investigations",       args: { query: "petronas" } },
  { name: "search_knowledge_base",       args: { query: "cybersecurity" } },
  { name: "search_archival_documents",   args: { query: "threat" } },
  { name: "search_chat_history",         args: { query: "threat" } },
  { name: "search_bug_reports",          args: { query: "signal" } },
  { name: "search_social_media",         args: { query: "Petronas", platforms: ["twitter"] } },
  { name: "query_fortress_data",         args: { query_type: "signals", limit: 5, reason_for_access: "health check" } },
  { name: "query_expert_knowledge",      args: { query: "ransomware", question: "What are common ransomware attack vectors?" }, slowTimeout: true },
  { name: "analyze_threat_radar",        args: { timeframe_hours: 48 }, slowTimeout: true },
  { name: "analyze_signal_quality",      args: {} },
  { name: "analyze_signal_patterns",     args: { pattern_type: "temporal" } },
  { name: "analyze_database_issues",     args: {} },
  { name: "analyze_sentiment_drift",     args: { entity_name: "Petronas" } },
  { name: "analyze_cross_client_threats",args: {} },
  { name: "analyze_visual_document",     args: { document_url: "", analysis_type: "general" }, skip: true },
  { name: "analyze_edge_function_errors",args: {} },
  { name: "detect_signal_duplicates",    args: { limit: 5 } },
  { name: "detect_signal_anomalies",     args: {} },
  { name: "diagnose_issues",             args: {} },
  { name: "diagnose_feed_errors",        args: {} },
  { name: "diagnose_bug",               args: { bug_description: "test" } },
  { name: "get_bug_report_details",      args: {} },
  { name: "get_client_details",          args: { client_id: "petronas" } },
  { name: "get_document_content",        args: { document_id: "" } },
  { name: "get_report_content",          args: {} },
  { name: "get_source_file",             args: { file_path: "README.md" } },
  { name: "get_signal_incident_status",  args: { limit: 5 } },
  { name: "get_principal_profile",       args: { entity_name: "Petronas" } },
  { name: "get_system_architecture",     args: {} },
  { name: "explain_feature",             args: { feature_name: "signals" } },
  { name: "read_client_monitoring_config", args: { client_id: "petronas" } },
  { name: "read_intelligence_documents", args: {} },
  { name: "run_cyber_sentinel",          args: { mode: "sweep" } },
  { name: "run_data_quality_check",      args: {} },
  { name: "run_entity_deep_scan",        args: { entity_name: "Petronas" } },
  { name: "run_vip_deep_scan",           args: { entity_name: "Petronas", scan_type: "comprehensive" } },
  { name: "run_what_if_scenario",        args: { scenario: "cyber attack on Calgary facility" }, skip: true },  // removed from definitions
  { name: "run_agent_knowledge_hunt",    args: { topic: "ransomware" } },
  { name: "trigger_osint_scan",          args: { entity_name: "Petronas" }, skip: true },  // removed from definitions
  { name: "get_wildfire_intelligence",    args: { client_id: PECL_CLIENT_ID } },
  { name: "check_dark_web_exposure",     args: { email_or_domain: "petronas.com" } },
  { name: "perform_external_web_search", args: { query: "Petronas cybersecurity" } },
  { name: "perform_web_fetch",           args: { url: "https://www.cisa.gov" }, skip: true },
  { name: "get_threat_intel_feeds",      args: { limit: 5 } },
  { name: "generate_fortress_report",    args: { report_type: "risk_snapshot" } },
  { name: "generate_incident_briefing",  args: {} },
  { name: "generate_audio_briefing",     args: { content: "Test briefing", title: "Test" }, skip: true },
  { name: "generate_report_visual",      args: { visual_type: "threat_summary", client_id: PECL_CLIENT_ID } },
  { name: "generate_poi_report",         args: { entity_name: "Petronas" } },
  { name: "import_report_images",        args: {} },
  { name: "extract_signal_insights",     args: { limit: 5 } },
  { name: "enrich_entity_descriptions",  args: { entity_name: "Petronas" } },
  { name: "suggest_improvements",        args: {} },
  { name: "suggest_monitoring_adjustments", args: { client_id: PECL_CLIENT_ID } },
  { name: "suggest_code_fix",            args: { issue: "test" } },
  { name: "propose_new_monitoring_keywords", args: { client_id: PECL_CLIENT_ID } },
  { name: "propose_signal_merge",        args: {} },
  { name: "create_briefing_session",     args: { title: "Test Briefing" }, skip: true },
  { name: "create_categorization_rule",  args: { rule_name: "test", conditions: {}, category: "test" }, skip: true },
  { name: "create_entity",               args: { name: "Test Entity", entity_type: "organization" }, skip: true },
  { name: "create_fix_proposal",         args: { issue: "test" } },
  { name: "agent_self_assessment",       args: {} },
  { name: "synthesize_knowledge",        args: { topic: "ransomware" } },
  { name: "simulate_attack_path",        args: { target: "Petronas ERP" }, skip: true },  // removed from definitions
  { name: "simulate_protest_escalation", args: { location: "Calgary" }, skip: true },  // removed from definitions
  { name: "dispatch_agent_investigation",args: {} },
  { name: "trigger_multi_agent_debate",  args: {} },
  { name: "broadcast_to_agents",         args: { message: "health check test" }, skip: true },
  { name: "send_message_to_agent",       args: { agent_name: "CYBER", message: "health check" }, skip: true },
  { name: "ingest_expert_topics",        args: { expert_name: "test" }, skip: true },
  { name: "ingest_expert_content",       args: { expert_name: "test" }, skip: true },
  { name: "add_expert_source",           args: { name: "test", url: "https://example.com" }, skip: true },
  { name: "add_entity_to_watchlist",     args: { entity_name: "test" }, skip: true },
  { name: "investigate_poi",             args: { entity_name: "Petronas" }, skip: true },  // removed from definitions
  { name: "auto_summarize_incidents",    args: { limit: 3 }, skip: true },
  { name: "autonomous_source_health_manager", args: {} },
  { name: "fix_duplicate_signals",       args: { dry_run: true } },
  { name: "process_document",            args: { document_url: "https://example.com" }, skip: true },
  { name: "submit_ai_feedback",          args: { feedback: "test", rating: 5 }, skip: true },
  { name: "submit_learning_insight",     args: { insight: "test" }, skip: true },
  { name: "remember_this",              args: { content: "test", category: "test" }, skip: true },
  { name: "update_user_preferences",    args: { preferences: {} }, skip: true },
  { name: "manage_project_context",     args: { project_name: "test", action: "get" } },
  { name: "lookup_ioc_indicator",        args: { indicator: "conn.elbbird.zip", indicator_type: "domain" } },
  { name: "update_risk_profile",        args: { entity_name: "Petronas" }, skip: true },
  { name: "guide_decision_tree",         args: { scenario: "ransomware" } },
  { name: "recommend_playbook",          args: { incident_type: "ransomware" } },
  { name: "identify_critical_failure_points", args: {} },
  { name: "optimize_rule_thresholds",   args: {}, skip: true },  // removed from definitions
  { name: "track_mitigation_effectiveness", args: {} },
  { name: "perform_impact_analysis",    args: { scenario: "ransomware on ERP" }, skip: true },  // removed from definitions
  { name: "configure_principal_alerts", args: { entity_name: "Petronas", alert_types: ["incident"] }, skip: true },
  { name: "draft_response_tasks",       args: {}, skip: true },  // removed from definitions
  { name: "integrate_incident_management", args: {}, skip: true },  // removed from definitions
];

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const singleTool = args.includes("--tool") ? args[args.indexOf("--tool") + 1] : null;
const filterStr  = args.includes("--filter") ? args[args.indexOf("--filter") + 1] : null;
const concurrency = args.includes("--concurrency") ? parseInt(args[args.indexOf("--concurrency") + 1]) : 6;

let toolsToRun = TOOLS.filter(t => !t.skip);
if (singleTool) toolsToRun = TOOLS.filter(t => t.name === singleTool);
if (filterStr)  toolsToRun = toolsToRun.filter(t => t.name.includes(filterStr));

// ── Runner ───────────────────────────────────────────────────────────────────
async function testTool(tool) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), tool.slowTimeout ? 45000 : 20000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool_test: true, tool_name: tool.name, args: tool.args }),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    const json = await res.json();
    return { name: tool.name, ok: json.ok, ms: json.ms, error: json.error, result: json.result };
  } catch (e) {
    clearTimeout(timeout);
    const isTimeout = e.name === "AbortError";
    const limitMs = tool.slowTimeout ? 45000 : 20000;
    return { name: tool.name, ok: false, ms: limitMs, error: isTimeout ? `TIMEOUT (>${limitMs / 1000}s)` : e.message };
  }
}

async function runBatch(tools) {
  return Promise.all(tools.map(testTool));
}

function summariseResult(r) {
  if (!r.ok) return r.error || "error";
  const res = r.result;
  if (!res) return "ok (empty)";
  // Summarise first meaningful key
  for (const key of ["signals","incidents","entities","data","results","count","total","message","status","feed_source"]) {
    if (res[key] !== undefined) {
      const val = res[key];
      if (Array.isArray(val)) return `${val.length} ${key}`;
      if (typeof val === "number") return `${key}=${val}`;
      if (typeof val === "string") return val.substring(0, 60);
    }
  }
  return "ok";
}

// ── Main ─────────────────────────────────────────────────────────────────────
const skipped = TOOLS.filter(t => t.skip);
console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
console.log(`║           AEGIS TOOL HEALTH CHECK                        ║`);
console.log(`╚═══════════════════════════════════════════════════════════╝`);
console.log(`Tools to test: ${toolsToRun.length}  |  Skipped (write ops): ${skipped.length}  |  Concurrency: ${concurrency}\n`);

const results = [];
for (let i = 0; i < toolsToRun.length; i += concurrency) {
  const batch = toolsToRun.slice(i, i + concurrency);
  process.stdout.write(`Testing [${i + 1}-${Math.min(i + concurrency, toolsToRun.length)}/${toolsToRun.length}]...`);
  const batchResults = await runBatch(batch);
  results.push(...batchResults);
  process.stdout.write(` done\n`);
}

// ── Report ───────────────────────────────────────────────────────────────────
const passed  = results.filter(r => r.ok);
const failed  = results.filter(r => !r.ok);
const avgMs   = Math.round(results.reduce((s, r) => s + (r.ms || 0), 0) / results.length);

console.log(`\n${"─".repeat(70)}`);
console.log(`RESULTS: ${passed.length} passed  |  ${failed.length} failed  |  avg ${avgMs}ms`);
console.log(`${"─".repeat(70)}\n`);

// Passed
if (passed.length > 0) {
  console.log("✅ PASSING\n");
  for (const r of passed) {
    const pad = r.name.padEnd(38);
    console.log(`  ✅ ${pad} ${r.ms}ms   ${summariseResult(r)}`);
  }
}

// Failed
if (failed.length > 0) {
  console.log("\n❌ FAILING\n");
  for (const r of failed) {
    const pad = r.name.padEnd(38);
    console.log(`  ❌ ${pad} ${r.ms}ms   ${r.error || summariseResult(r)}`);
  }
}

// Skipped
console.log(`\n⏭  SKIPPED (write/destructive — run manually)\n`);
for (const t of skipped) {
  console.log(`  ⏭  ${t.name}`);
}

// Machine-readable summary
const summary = {
  run_at: new Date().toISOString(),
  total: results.length,
  passed: passed.length,
  failed: failed.length,
  skipped: skipped.length,
  avg_ms: avgMs,
  failures: failed.map(r => ({ tool: r.name, error: r.error || summariseResult(r) })),
};
import { writeFileSync } from "fs";
writeFileSync("scripts/tool-health-report.json", JSON.stringify(summary, null, 2));
console.log(`\nFull report saved → scripts/tool-health-report.json`);

// ── Edge Function Direct Tests (not AEGIS tools) ─────────────────────────────
// These functions are called internally by the pipeline (not via AEGIS tool calls)
// and are tested by invoking them directly with safe/known inputs.
console.log(`\n${"─".repeat(70)}`);
console.log(`EDGE FUNCTION DIRECT TESTS`);
console.log(`${"─".repeat(70)}\n`);

const EDGE_TESTS = [
  {
    name: "review-signal-agent (out-of-range guard)",
    url: `${SUPABASE_URL}/functions/v1/review-signal-agent`,
    body: { signal_id: "00000000-0000-0000-0000-000000000000", composite_score: 0.50 },
    expectKey: "skipped",
    expectValue: true,
    description: "composite_score=0.50 should be skipped (outside [0.60, 0.75))",
  },
  {
    name: "review-signal-agent (in-range, no signal)",
    url: `${SUPABASE_URL}/functions/v1/review-signal-agent`,
    body: { signal_id: "00000000-0000-0000-0000-000000000000", composite_score: 0.63 },
    expectKey: "error",
    expectValue: "Signal not found",
    description: "composite_score=0.63 with unknown signal_id should return 404 error",
  },
  // Client Authorization functions (public — no auth header needed)
  {
    name: "confirm-client-authorization (invalid token)",
    url: `${SUPABASE_URL}/functions/v1/confirm-client-authorization`,
    body: { token: "00000000000000000000000000000000", action: "get_details" },
    expectKey: "error",
    expectValue: "Invalid or expired authorization link",
    description: "Unknown token should return 'Invalid or expired authorization link'",
    noAuth: true,
  },
];

// ── Storage URL Smoke Tests ───────────────────────────────────────────────────
// Verify that URLs returned by report/document generators are actually reachable.
// These catch regressions where getPublicUrl is used on a private bucket (returns 400/InvalidJWT).
console.log(`\n${"─".repeat(70)}`);
console.log(`STORAGE URL SMOKE TESTS`);
console.log(`${"─".repeat(70)}\n`);

try {
  // Generate a real report and verify the view_url is reachable
  const reportCtrl = new AbortController();
  const reportTimeout = setTimeout(() => reportCtrl.abort(), 45000);
  const reportRes = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ tool_test: true, tool_name: "generate_fortress_report", args: { report_type: "risk_snapshot" } }),
    signal: reportCtrl.signal,
  });
  clearTimeout(reportTimeout);
  const reportJson = await reportRes.json();
  const viewUrl = reportJson?.result?.view_url || reportJson?.result?.report_url;
  if (!viewUrl) {
    console.log(`  ❌ generate_fortress_report url check  no view_url in result — tool may have failed: ${JSON.stringify(reportJson).substring(0, 120)}`);
  } else {
    // Fetch the URL — expect HTTP 200
    const urlCtrl = new AbortController();
    const urlTimeout = setTimeout(() => urlCtrl.abort(), 15000);
    try {
      const urlRes = await fetch(viewUrl, { signal: urlCtrl.signal });
      clearTimeout(urlTimeout);
      const ok = urlRes.status === 200;
      const mark = ok ? "✅" : "❌";
      const label = "generate_fortress_report view_url".padEnd(46);
      console.log(`  ${mark} ${label}  HTTP ${urlRes.status}${ok ? " — signed URL reachable" : " — URL broken (check bucket visibility / signed vs public URL)"}`);
    } catch (fetchErr) {
      clearTimeout(urlTimeout);
      console.log(`  ❌ ${"generate_fortress_report view_url".padEnd(46)}  FETCH ERROR: ${fetchErr.message}`);
    }
  }
} catch (e) {
  console.log(`  ❌ ${"generate_fortress_report url check".padEnd(46)}  ERROR: ${e.message}`);
}

for (const test of EDGE_TESTS) {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15000);
    const headers = { "Content-Type": "application/json" };
    if (!test.noAuth) headers["Authorization"] = `Bearer ${SERVICE_ROLE_KEY}`;
    const res = await fetch(test.url, {
      method: "POST",
      headers,
      body: JSON.stringify(test.body),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    const json = await res.json();
    const actual = json[test.expectKey];
    const ok = actual === test.expectValue;
    const mark = ok ? "✅" : "❌";
    const nameCol = test.name.padEnd(46);
    console.log(`  ${mark} ${nameCol}  ${ok ? test.description : `FAIL: expected ${test.expectKey}=${JSON.stringify(test.expectValue)}, got ${JSON.stringify(json)}`}`);
  } catch (e) {
    console.log(`  ❌ ${test.name.padEnd(46)}  ERROR: ${e.message}`);
  }
}
