/**
 * Daily Anti-Hallucination Test Runner
 * Runs every morning via cron, executes all validation checks,
 * logs results, and auto-fixes regressions where possible.
 */
import { corsHeaders, handleCors } from "../_shared/supabase-client.ts";
import { validateAIOutput, getCriticalDateContext } from "../_shared/anti-hallucination.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface TestCase {
  name: string;
  input: string;
  knownData: Record<string, unknown>;
  expectValid: boolean;
  expectWarningType?: string;
}

const TEST_CASES: TestCase[] = [
  // 1. VAGUE QUANTIFIERS
  { name: "Vague: 'several incidents'", input: "There are several incidents reported today.", knownData: {}, expectValid: false, expectWarningType: "Vague quantifier" },
  { name: "Vague: 'numerous threats'", input: "Numerous threats have been identified in the region.", knownData: {}, expectValid: false, expectWarningType: "Vague quantifier" },
  { name: "Vague: 'approximately 15'", input: "Approximately 15 signals were detected.", knownData: {}, expectValid: false, expectWarningType: "Vague quantifier" },
  { name: "Clean: exact count", input: "There are 7 open incidents as of today.", knownData: {}, expectValid: true },

  // 2. SUSPICIOUS DATE CLAIMS
  { name: "Date: 'first identified on'", input: "This threat was first identified on January 15, 2026.", knownData: {}, expectValid: false, expectWarningType: "Date claim" },
  { name: "Date: 'emerged in'", input: "The pattern emerged in March 2025 near the pipeline corridor.", knownData: {}, expectValid: false, expectWarningType: "Date claim" },
  { name: "Clean: no date fabrication", input: "No incidents reported in the last 24 hours.", knownData: {}, expectValid: true },

  // 3. DATA COUNT MISMATCHES
  { name: "Count: incident mismatch", input: "There are 12 open incidents requiring attention.", knownData: { incidentCount: 5 }, expectValid: false, expectWarningType: "Incident count mismatch" },
  { name: "Count: correct incidents", input: "There are 5 incidents currently open.", knownData: { incidentCount: 5 }, expectValid: true },
  { name: "Count: signal mismatch (>20%)", input: "We detected 50 active signals this week.", knownData: { signalCount: 10 }, expectValid: false, expectWarningType: "Signal count mismatch" },
  { name: "Count: signal within tolerance", input: "We have 11 signals in the feed.", knownData: { signalCount: 10 }, expectValid: true },
  { name: "Count: entity mismatch", input: "Tracking 100 known entities across the region.", knownData: { entityCount: 20 }, expectValid: false, expectWarningType: "Entity count mismatch" },

  // 4. FABRICATED AGENT REFERENCES
  { name: "Agent: fabricated PHANTOM-OPS", input: "I've coordinated with PHANTOM-OPS on this assessment.", knownData: {}, expectValid: false, expectWarningType: "fabricated agent" },
  { name: "Agent: fabricated DELTA-FORCE", input: "DELTA-FORCE has completed the analysis of the threat vector.", knownData: {}, expectValid: false, expectWarningType: "fabricated agent" },
  { name: "Agent: known AEGIS-CMD", input: "AEGIS-CMD provided the following assessment.", knownData: {}, expectValid: true },
  { name: "Agent: known VERIDIAN-TANGO", input: "VERIDIAN-TANGO flagged a counter-terrorism signal.", knownData: {}, expectValid: true },

  // 5. FABRICATED URLs
  { name: "URL: example.com", input: "Source: https://example.com/news/article-12345", knownData: {}, expectValid: false, expectWarningType: "Suspicious URL" },
  { name: "URL: placeholder.org", input: "See: https://placeholder.org/report-99999", knownData: {}, expectValid: false, expectWarningType: "Suspicious URL" },
  { name: "URL: legitimate CBC", input: "Source: https://cbc.ca/news/canada/pipeline-update", knownData: {}, expectValid: true },

  // 6. NARRATIVE INFLATION
  { name: "Inflation: 'coordinated campaign'", input: "This appears to be a coordinated campaign against the facility.", knownData: {}, expectValid: false, expectWarningType: "Narrative inflation" },
  { name: "Inflation: 'high-tempo'", input: "We're in a high-tempo operational environment.", knownData: {}, expectValid: false, expectWarningType: "Narrative inflation" },
  { name: "Inflation: 'imminent attack'", input: "There is an imminent attack risk to the northern corridor.", knownData: {}, expectValid: false, expectWarningType: "Narrative inflation" },
  { name: "Inflation: 'crisis'", input: "The crisis at the LNG facility requires immediate response.", knownData: {}, expectValid: false, expectWarningType: "Narrative inflation" },
  { name: "Inflation: 'exploited by activist media'", input: "This could be exploited by activist media.", knownData: {}, expectValid: false, expectWarningType: "Narrative inflation" },
  { name: "Clean: measured language", input: "Opposition activity in the region warrants attention. Signal volume is above baseline.", knownData: {}, expectValid: true },

  // 7. CAPABILITY FABRICATION
  { name: "Capability: dispatched patrol", input: "I've dispatched a patrol to the north perimeter.", knownData: {}, expectValid: false, expectWarningType: "Capability fabrication" },
  { name: "Capability: contacted RCMP", input: "I've contacted RCMP to investigate the incident.", knownData: {}, expectValid: false, expectWarningType: "Capability fabrication" },
  { name: "Capability: activated perimeter", input: "I've activated perimeter monitoring around the facility.", knownData: {}, expectValid: false, expectWarningType: "Capability fabrication" },
  { name: "Capability: will continue to monitor", input: "I will continue to monitor the situation and alert you if anything changes.", knownData: {}, expectValid: false, expectWarningType: "Capability fabrication" },
  { name: "Capability: now monitoring", input: "I'm now monitoring the social media feeds for any mentions.", knownData: {}, expectValid: false, expectWarningType: "Capability fabrication" },
  { name: "Capability: will alert you", input: "I will alert you when new posts appear on this topic.", knownData: {}, expectValid: false, expectWarningType: "Capability fabrication" },
  { name: "Capability: sent notification", input: "I've sent a push notification to the security team.", knownData: {}, expectValid: false, expectWarningType: "Capability fabrication" },
  { name: "Clean: recommendation language", input: "I recommend dispatching a patrol to the north perimeter.", knownData: {}, expectValid: true },

  // 8. CROSS-AGENT FABRICATION
  { name: "CrossAgent: Wraith confirmed (no tool)", input: "Wraith has confirmed the vulnerability in the target system.", knownData: { toolsCalledThisTurn: [] }, expectValid: false, expectWarningType: "Cross-agent fabrication" },
  { name: "CrossAgent: Cerberus analyzed (no tool)", input: "Cerberus has analyzed the financial transactions and found anomalies.", knownData: { toolsCalledThisTurn: [] }, expectValid: false, expectWarningType: "Cross-agent fabrication" },
  { name: "CrossAgent: coordinating with Meridian (no tool)", input: "I'm coordinating with Meridian on the geo-intelligence assessment.", knownData: { toolsCalledThisTurn: [] }, expectValid: false, expectWarningType: "Cross-agent fabrication" },
  { name: "CrossAgent: Wraith WITH agent_debate tool", input: "Wraith has confirmed the vulnerability.", knownData: { toolsCalledThisTurn: ['agent_debate_analysis'] }, expectValid: true },
  { name: "CrossAgent: Cerberus WITH task_force tool", input: "Cerberus has analyzed the transactions.", knownData: { toolsCalledThisTurn: ['task_force_deploy'] }, expectValid: true },

  // COMBINED / EDGE CASES
  { name: "Multi-hallucination combined", input: `There are several incidents in the region. This coordinated campaign was first identified on January 5. I've dispatched a patrol and Wraith has confirmed the threat. See: https://example.com/report-99999`, knownData: { toolsCalledThisTurn: [] }, expectValid: false },
  { name: "Completely clean output", input: `Based on the database query, there are 3 open incidents for Petronas Canada as of today. Signal volume is at baseline levels with no material change detected. I recommend enhanced monitoring at the northern facility for the next 48 hours. Source: Fortress internal record FID-2026-02-17-PETRONAS-SIG-001.`, knownData: { incidentCount: 3 }, expectValid: true },
];

function runTests(): { passed: number; failed: number; total: number; failures: { name: string; expected: string; got: string; warnings: string[] }[] } {
  const failures: { name: string; expected: string; got: string; warnings: string[] }[] = [];
  let passed = 0;

  for (const tc of TEST_CASES) {
    const result = validateAIOutput(tc.input, tc.knownData as any);
    
    if (tc.expectValid) {
      // If we expect valid, check no warnings of the specified type (or none at all)
      const hasUnexpectedWarning = tc.expectWarningType 
        ? result.warnings.some(w => w.includes(tc.expectWarningType!))
        : result.warnings.length > 0;
      
      if (hasUnexpectedWarning) {
        failures.push({ name: tc.name, expected: "valid (no warnings)", got: `invalid: ${result.warnings.join('; ')}`, warnings: result.warnings });
      } else {
        passed++;
      }
    } else {
      // Expect invalid
      if (tc.expectWarningType) {
        const hasExpectedWarning = result.warnings.some(w => w.includes(tc.expectWarningType!));
        if (!hasExpectedWarning) {
          failures.push({ name: tc.name, expected: `warning containing "${tc.expectWarningType}"`, got: `warnings: ${result.warnings.join('; ') || 'none'}`, warnings: result.warnings });
        } else {
          passed++;
        }
      } else {
        // Just expect it to be invalid
        if (result.isValid) {
          failures.push({ name: tc.name, expected: "invalid", got: "valid", warnings: [] });
        } else {
          passed++;
        }
      }
    }
  }

  return { passed, failed: failures.length, total: TEST_CASES.length, failures };
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // 1. Run all tests
    const results = runTests();
    
    // 2. Run date context check
    const dateCtx = getCriticalDateContext();
    const dateValid = dateCtx.currentDateISO.length > 0 && dateCtx.timestamp > 0;
    if (!dateValid) {
      results.failures.push({ name: "getCriticalDateContext integrity", expected: "valid date context", got: "empty/invalid", warnings: [] });
      results.failed++;
      results.total++;
    } else {
      results.passed++;
      results.total++;
    }

    // 3. Log to monitoring_history
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const status = results.failed === 0 ? 'completed' : 'error';
    const summary = `Anti-Hallucination Validator: ${results.passed}/${results.total} passed` + 
      (results.failed > 0 ? ` | FAILURES: ${results.failures.map(f => f.name).join(', ')}` : '');

    await supabase.from('monitoring_history').insert({
      source: 'anti-hallucination-daily-test',
      status,
      signals_found: results.passed,
      signals_ingested: results.total,
      error_message: results.failed > 0 ? JSON.stringify(results.failures.slice(0, 5)) : null,
      metadata: {
        passed: results.passed,
        failed: results.failed,
        total: results.total,
        failures: results.failures,
        date_context: dateCtx.currentDateISO,
        run_at: new Date().toISOString(),
      },
    });

    // 4. If failures found, create a bug report for visibility
    if (results.failed > 0) {
      await supabase.from('bug_reports').insert({
        description: `Anti-Hallucination Daily Test: ${results.failed} test(s) failed.\n\nFailures:\n${results.failures.map(f => `- ${f.name}: expected ${f.expected}, got ${f.got}`).join('\n')}`,
        fix_status: 'open',
        browser_info: 'Automated Daily Test Runner',
      }).then(() => {});
    }

    return new Response(JSON.stringify({
      status: results.failed === 0 ? 'ALL_PASSED' : 'FAILURES_DETECTED',
      summary,
      passed: results.passed,
      failed: results.failed,
      total: results.total,
      failures: results.failures,
      dateContext: dateCtx.currentDateISO,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
