import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateAIOutput, getCriticalDateContext } from "../_shared/anti-hallucination.ts";

// ═══════════════════════════════════════════════════════════════
//  1. VAGUE QUANTIFIERS
// ═══════════════════════════════════════════════════════════════

Deno.test("detects vague quantifiers - 'several incidents'", () => {
  const result = validateAIOutput("There are several incidents reported today.", {});
  assert(!result.isValid, "Should flag vague quantifiers");
  assert(result.warnings.some(w => w.includes("Vague quantifier")));
});

Deno.test("detects vague quantifiers - 'numerous threats'", () => {
  const result = validateAIOutput("Numerous threats have been identified in the region.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Vague quantifier")));
});

Deno.test("detects vague quantifiers - 'approximately 15'", () => {
  const result = validateAIOutput("Approximately 15 signals were detected.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Vague quantifier")));
});

Deno.test("passes clean text without vague quantifiers", () => {
  const result = validateAIOutput("There are 7 open incidents as of today.", {});
  // Should not flag for vague quantifiers (may flag for other reasons)
  assert(!result.warnings.some(w => w.includes("Vague quantifier")));
});

// ═══════════════════════════════════════════════════════════════
//  2. SUSPICIOUS DATE CLAIMS
// ═══════════════════════════════════════════════════════════════

Deno.test("detects suspicious date claims - 'first identified on'", () => {
  const result = validateAIOutput("This threat was first identified on January 15, 2026.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Date claim")));
});

Deno.test("detects suspicious date claims - 'emerged in'", () => {
  const result = validateAIOutput("The pattern emerged in March 2025 near the pipeline corridor.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Date claim")));
});

Deno.test("passes text without date fabrication", () => {
  const result = validateAIOutput("No incidents reported in the last 24 hours.", {});
  assert(!result.warnings.some(w => w.includes("Date claim")));
});

// ═══════════════════════════════════════════════════════════════
//  3. DATA COUNT MISMATCHES
// ═══════════════════════════════════════════════════════════════

Deno.test("detects incident count mismatch", () => {
  const result = validateAIOutput("There are 12 open incidents requiring attention.", { incidentCount: 5 });
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Incident count mismatch")));
});

Deno.test("passes correct incident count", () => {
  const result = validateAIOutput("There are 5 incidents currently open.", { incidentCount: 5 });
  assert(!result.warnings.some(w => w.includes("Incident count mismatch")));
});

Deno.test("detects signal count mismatch (>20% deviation)", () => {
  const result = validateAIOutput("We detected 50 active signals this week.", { signalCount: 10 });
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Signal count mismatch")));
});

Deno.test("passes signal count within tolerance", () => {
  const result = validateAIOutput("We have 11 signals in the feed.", { signalCount: 10 });
  assert(!result.warnings.some(w => w.includes("Signal count mismatch")));
});

Deno.test("detects entity count mismatch", () => {
  const result = validateAIOutput("Tracking 100 known entities across the region.", { entityCount: 20 });
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Entity count mismatch")));
});

// ═══════════════════════════════════════════════════════════════
//  4. FABRICATED AGENT REFERENCES
// ═══════════════════════════════════════════════════════════════

Deno.test("detects fabricated agent call sign", () => {
  const result = validateAIOutput("I've coordinated with PHANTOM-OPS on this assessment.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("fabricated agent")));
});

Deno.test("detects fabricated agent call sign - DELTA-FORCE", () => {
  const result = validateAIOutput("DELTA-FORCE has completed the analysis of the threat vector.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("fabricated agent")));
});

Deno.test("passes known agent call sign AEGIS-CMD", () => {
  const result = validateAIOutput("AEGIS-CMD provided the following assessment.", {});
  assert(!result.warnings.some(w => w.includes("fabricated agent")));
});

Deno.test("passes known agent call sign VERIDIAN-TANGO", () => {
  const result = validateAIOutput("VERIDIAN-TANGO flagged a counter-terrorism signal.", {});
  assert(!result.warnings.some(w => w.includes("fabricated agent")));
});

Deno.test("does not flag common acronyms as agents", () => {
  const result = validateAIOutput("The RCMP-INSET team is monitoring the situation. OSINT sources confirm.", {});
  // RCMP-INSET contains a dash but RCMP should be excluded
  assert(!result.warnings.some(w => w.includes("fabricated agent") && w.includes("RCMP")));
});

// ═══════════════════════════════════════════════════════════════
//  5. FABRICATED URLs
// ═══════════════════════════════════════════════════════════════

Deno.test("detects example.com URLs as suspicious", () => {
  const result = validateAIOutput("Source: https://example.com/news/article-12345", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Suspicious URL")));
});

Deno.test("detects placeholder URLs", () => {
  const result = validateAIOutput("See: https://placeholder.org/report-99999", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Suspicious URL")));
});

Deno.test("passes legitimate-looking URLs", () => {
  const result = validateAIOutput("Source: https://cbc.ca/news/canada/pipeline-update", {});
  assert(!result.warnings.some(w => w.includes("Suspicious URL")));
});

// ═══════════════════════════════════════════════════════════════
//  6. NARRATIVE INFLATION
// ═══════════════════════════════════════════════════════════════

Deno.test("detects 'coordinated campaign'", () => {
  const result = validateAIOutput("This appears to be a coordinated campaign against the facility.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Narrative inflation")));
});

Deno.test("detects 'high-tempo'", () => {
  const result = validateAIOutput("We're in a high-tempo operational environment.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Narrative inflation")));
});

Deno.test("detects 'imminent attack'", () => {
  const result = validateAIOutput("There is an imminent attack risk to the northern corridor.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Narrative inflation")));
});

Deno.test("detects 'crisis'", () => {
  const result = validateAIOutput("The crisis at the LNG facility requires immediate response.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Narrative inflation")));
});

Deno.test("detects 'exploited by activist media'", () => {
  const result = validateAIOutput("This could be exploited by activist media.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Narrative inflation")));
});

Deno.test("passes measured alternative language", () => {
  const result = validateAIOutput("Opposition activity in the region warrants attention. Signal volume is above baseline.", {});
  assert(!result.warnings.some(w => w.includes("Narrative inflation")));
});

// ═══════════════════════════════════════════════════════════════
//  7. CAPABILITY FABRICATION
// ═══════════════════════════════════════════════════════════════

Deno.test("detects 'I have dispatched a patrol'", () => {
  const result = validateAIOutput("I've dispatched a patrol to the north perimeter.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Capability fabrication")));
});

Deno.test("detects 'I have contacted RCMP'", () => {
  const result = validateAIOutput("I've contacted RCMP to investigate the incident.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Capability fabrication")));
});

Deno.test("detects 'I have activated perimeter monitoring'", () => {
  const result = validateAIOutput("I've activated perimeter monitoring around the facility.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Capability fabrication")));
});

Deno.test("detects 'I will continue to monitor'", () => {
  const result = validateAIOutput("I will continue to monitor the situation and alert you if anything changes.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Capability fabrication")));
});

Deno.test("detects 'I am now monitoring'", () => {
  const result = validateAIOutput("I'm now monitoring the social media feeds for any mentions.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Capability fabrication")));
});

Deno.test("detects 'I will alert you when'", () => {
  const result = validateAIOutput("I will alert you when new posts appear on this topic.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Capability fabrication")));
});

Deno.test("detects 'I have sent a notification'", () => {
  const result = validateAIOutput("I've sent a push notification to the security team.", {});
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Capability fabrication")));
});

Deno.test("passes recommendation language", () => {
  const result = validateAIOutput("I recommend dispatching a patrol to the north perimeter.", {});
  assert(!result.warnings.some(w => w.includes("Capability fabrication")));
});

// ═══════════════════════════════════════════════════════════════
//  8. CROSS-AGENT CLAIM FABRICATION
// ═══════════════════════════════════════════════════════════════

Deno.test("detects 'Wraith has confirmed' without tool", () => {
  const result = validateAIOutput("Wraith has confirmed the vulnerability in the target system.", { toolsCalledThisTurn: [] });
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Cross-agent fabrication")));
});

Deno.test("detects 'Cerberus has analyzed' without tool", () => {
  const result = validateAIOutput("Cerberus has analyzed the financial transactions and found anomalies.", { toolsCalledThisTurn: [] });
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Cross-agent fabrication")));
});

Deno.test("detects 'coordinating with Meridian' without tool", () => {
  const result = validateAIOutput("I'm coordinating with Meridian on the geo-intelligence assessment.", { toolsCalledThisTurn: [] });
  assert(!result.isValid);
  assert(result.warnings.some(w => w.includes("Cross-agent fabrication")));
});

Deno.test("passes cross-agent claim WITH agent_debate tool", () => {
  const result = validateAIOutput("Wraith has confirmed the vulnerability.", { toolsCalledThisTurn: ['agent_debate_analysis'] });
  assert(!result.warnings.some(w => w.includes("Cross-agent fabrication")));
});

Deno.test("passes cross-agent claim WITH task_force tool", () => {
  const result = validateAIOutput("Cerberus has analyzed the transactions.", { toolsCalledThisTurn: ['task_force_deploy'] });
  assert(!result.warnings.some(w => w.includes("Cross-agent fabrication")));
});

// ═══════════════════════════════════════════════════════════════
//  COMBINED / EDGE CASES
// ═══════════════════════════════════════════════════════════════

Deno.test("detects multiple hallucination types simultaneously", () => {
  const text = `There are several incidents in the region. This coordinated campaign was first identified on January 5. 
  I've dispatched a patrol and Wraith has confirmed the threat. See: https://example.com/report-99999`;
  
  const result = validateAIOutput(text, { toolsCalledThisTurn: [] });
  assert(!result.isValid);
  // Should catch at least 4 types
  assert(result.warnings.length >= 4, `Expected >= 4 warnings, got ${result.warnings.length}: ${result.warnings.join('; ')}`);
});

Deno.test("completely clean output passes validation", () => {
  const text = `Based on the database query, there are 3 open incidents for Petronas Canada as of today.
  Signal volume is at baseline levels with no material change detected. 
  I recommend enhanced monitoring at the northern facility for the next 48 hours.
  Source: Fortress internal record FID-2026-02-17-PETRONAS-SIG-001.`;
  
  const result = validateAIOutput(text, { incidentCount: 3 });
  assertEquals(result.isValid, true, `Unexpected warnings: ${result.warnings.join('; ')}`);
  assertEquals(result.warnings.length, 0);
});

Deno.test("getCriticalDateContext returns valid structure", () => {
  const ctx = getCriticalDateContext();
  assert(ctx.currentDateISO.length > 0, "Date ISO should not be empty");
  assert(ctx.currentTime24h.length > 0, "Time should not be empty");
  assert(ctx.currentTimezone.length > 0, "Timezone should not be empty");
  assert(ctx.timestamp > 0, "Timestamp should be positive");
  assert(ctx.currentDateTimeLocal.length > 0, "Local datetime should not be empty");
});
