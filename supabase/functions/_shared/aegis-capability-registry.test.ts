// Capability Registry — Deno test suite.
// Run: deno test supabase/functions/_shared/aegis-capability-registry.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertGreater,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCapabilityRegistryPromptBlock,
  buildPerQuestionCapabilityWarning,
  CAPABILITY_REGISTRY,
  detectTargetedCapabilities,
  getCapability,
  type CapabilityEntry,
} from "./aegis-capability-registry.ts";

// ─── Registry shape ────────────────────────────────────────────────────────
Deno.test("registry: every entry has required fields populated", () => {
  for (const c of CAPABILITY_REGISTRY) {
    assert(c.id, `missing id`);
    assert(c.name, `missing name in ${c.id}`);
    assert(["OPERATIONAL", "PARTIAL", "NOT_OPERATIONAL"].includes(c.status), `bad status in ${c.id}`);
    assert(c.description, `missing description in ${c.id}`);
    assert(Array.isArray(c.supported_questions), `bad supported_questions in ${c.id}`);
    assert(Array.isArray(c.unsupported_questions), `bad unsupported_questions in ${c.id}`);
    // OPERATIONAL items legitimately have empty required_language
    if (c.status !== "OPERATIONAL") {
      assertGreater(c.required_language.length, 20, `missing required_language in ${c.id}`);
    }
    assert(Array.isArray(c.detection_keywords), `bad detection_keywords in ${c.id}`);
  }
});
Deno.test("registry: ids are unique", () => {
  const ids = new Set<string>();
  for (const c of CAPABILITY_REGISTRY) {
    assert(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
  }
});

// ─── Known capabilities present ────────────────────────────────────────────
Deno.test("registry: Account Cycling Detection is NOT_OPERATIONAL", () => {
  const c = getCapability("account-cycling-detection");
  assert(c);
  assertEquals(c!.status, "NOT_OPERATIONAL");
});
Deno.test("registry: Image Recognition is NOT_OPERATIONAL", () => {
  const c = getCapability("image-recognition");
  assert(c);
  assertEquals(c!.status, "NOT_OPERATIONAL");
});
Deno.test("registry: Historical Reconstruction is NOT_OPERATIONAL", () => {
  const c = getCapability("historical-reconstruction");
  assert(c);
  assertEquals(c!.status, "NOT_OPERATIONAL");
});
Deno.test("registry: Cross-Platform Entity Resolution is NOT_OPERATIONAL", () => {
  const c = getCapability("entity-resolution-cross-platform");
  assert(c);
  assertEquals(c!.status, "NOT_OPERATIONAL");
});
Deno.test("registry: Trajectory Analysis is NOT_OPERATIONAL", () => {
  const c = getCapability("trajectory-analysis");
  assert(c);
  assertEquals(c!.status, "NOT_OPERATIONAL");
});
Deno.test("registry: Social Intelligence Collection is PARTIAL", () => {
  const c = getCapability("social-intelligence-collection");
  assert(c);
  assertEquals(c!.status, "PARTIAL");
});
Deno.test("registry: Threat Attribution is PARTIAL", () => {
  const c = getCapability("threat-attribution");
  assert(c);
  assertEquals(c!.status, "PARTIAL");
});
Deno.test("registry: Executive Threat Assessment is PARTIAL", () => {
  const c = getCapability("executive-threat-assessment");
  assert(c);
  assertEquals(c!.status, "PARTIAL");
});
Deno.test("registry: Evidence Package Generation is PARTIAL", () => {
  const c = getCapability("evidence-package-generation");
  assert(c);
  assertEquals(c!.status, "PARTIAL");
});

// ─── Detection by keyword ──────────────────────────────────────────────────
Deno.test("detect: cycling question matches Account Cycling Detection", () => {
  const matches = detectTargetedCapabilities(
    "Has any threat actor been cycling between social media accounts to target our principals?",
  );
  const ids = matches.map((c) => c.id);
  assert(ids.includes("account-cycling-detection"), `expected account-cycling-detection; got ${ids.join(",")}`);
});
Deno.test("detect: face match question matches Image Recognition", () => {
  const matches = detectTargetedCapabilities(
    "Run face matching on this surveillance photo to identify the person.",
  );
  const ids = matches.map((c) => c.id);
  assert(ids.includes("image-recognition"));
});
Deno.test("detect: reconstruct question matches Historical Reconstruction", () => {
  const matches = detectTargetedCapabilities(
    "Reconstruct a defensible timeline of activist activity over the last 90 days.",
  );
  const ids = matches.map((c) => c.id);
  assert(ids.includes("historical-reconstruction"));
});
Deno.test("detect: escalation question matches Trajectory Analysis", () => {
  const matches = detectTargetedCapabilities(
    "What is the escalation probability for this threat? Is it becoming more dangerous?",
  );
  const ids = matches.map((c) => c.id);
  assert(ids.includes("trajectory-analysis"));
});
Deno.test("detect: Reddit question matches Social Intelligence Collection [PARTIAL]", () => {
  const matches = detectTargetedCapabilities("What is being discussed on Reddit about X?");
  const ids = matches.map((c) => c.id);
  assert(ids.includes("social-intelligence-collection"));
});
Deno.test("detect: NOT_OPERATIONAL ranks before PARTIAL in match order", () => {
  // "cycling between Twitter accounts" — should match BOTH Account Cycling (NOT_OP) and Social Intel (PARTIAL)
  const matches = detectTargetedCapabilities(
    "Has any threat actor been cycling between Twitter accounts to evade bans?",
  );
  assert(matches.length >= 2);
  // First match must be NOT_OPERATIONAL
  assertEquals(matches[0].status, "NOT_OPERATIONAL");
});
Deno.test("detect: question with no capability keyword returns empty array", () => {
  const matches = detectTargetedCapabilities("What's the weather like?");
  assertEquals(matches.length, 0);
});
Deno.test("detect: case-insensitive matching", () => {
  const matches = detectTargetedCapabilities("WHO IS BEHIND this campaign?");
  const ids = matches.map((c) => c.id);
  assert(ids.includes("threat-attribution"));
});

// ─── Prompt-block builder ──────────────────────────────────────────────────
Deno.test("prompt block: includes the principle", () => {
  const block = buildCapabilityRegistryPromptBlock();
  assertStringIncludes(
    block,
    "Fortress must never imply a capability exists when it does not.",
  );
  assertStringIncludes(
    block,
    "Absence of findings is NOT the same as absence of capability.",
  );
});
Deno.test("prompt block: lists NOT_OPERATIONAL section", () => {
  const block = buildCapabilityRegistryPromptBlock();
  assertStringIncludes(block, "NOT_OPERATIONAL");
  assertStringIncludes(block, "Account Cycling Detection");
  assertStringIncludes(block, "Image Recognition");
  assertStringIncludes(block, "Trajectory Analysis");
});
Deno.test("prompt block: lists PARTIAL section with disclosures", () => {
  const block = buildCapabilityRegistryPromptBlock();
  assertStringIncludes(block, "PARTIAL");
  assertStringIncludes(block, "Social Intelligence Collection");
});
Deno.test("prompt block: integration-with-Coverage-Confidence guidance present", () => {
  const block = buildCapabilityRegistryPromptBlock();
  assertStringIncludes(block, "INTEGRATION WITH COVERAGE CONFIDENCE");
});
Deno.test("prompt block: prohibits 'no signals indicating <X>' phrasing when capability missing", () => {
  const block = buildCapabilityRegistryPromptBlock();
  // The block should explicitly mention this anti-pattern so the LLM is on notice
  assertStringIncludes(block, "no signals indicating");
});

// ─── Per-question warning block ────────────────────────────────────────────
Deno.test("per-question warning: empty when no matches", () => {
  const out = buildPerQuestionCapabilityWarning([]);
  assertEquals(out, "");
});
Deno.test("per-question warning: emits NOT_OPERATIONAL block with required language verbatim", () => {
  const c = getCapability("account-cycling-detection")!;
  const out = buildPerQuestionCapabilityWarning([c]);
  assertStringIncludes(out, "NOT_OPERATIONAL");
  assertStringIncludes(out, "Account Cycling Detection");
  assertStringIncludes(out, "Account Cycling Detection is not yet operational");
});
Deno.test("per-question warning: emits PARTIAL disclosure when only PARTIAL matched", () => {
  const c = getCapability("social-intelligence-collection")!;
  const out = buildPerQuestionCapabilityWarning([c]);
  assertStringIncludes(out, "PARTIAL");
  assertStringIncludes(out, "Direct Social Media Collection is currently limited");
});
Deno.test("per-question warning: mixed NOT_OP + PARTIAL — NOT_OP block first", () => {
  const notOp = getCapability("account-cycling-detection")!;
  const partial = getCapability("social-intelligence-collection")!;
  const out = buildPerQuestionCapabilityWarning([notOp, partial]);
  const notOpIdx = out.indexOf("NOT_OPERATIONAL");
  const partialIdx = out.indexOf("PARTIAL");
  assert(notOpIdx >= 0 && partialIdx > notOpIdx, "NOT_OPERATIONAL must appear before PARTIAL");
});

// ─── Tenant-boundary guard (operator-ratified 2026-06-01) ──────────────────
// Customer-facing strings (description + required_language + unsupported_questions)
// MUST be tenant-agnostic. These regression tests fail if any entry reintroduces
// a customer name, roadmap tier, internal project label, internal function name,
// or engineering implementation detail.
const FORBIDDEN_IN_CUSTOMER_FACING = [
  // Specific customer / tenant names
  /\bCRT\b/i,
  /\bPetronas\b/i,
  /\bBC[- ]Place\b/i,
  /\bFIFA\b/i,
  // Internal roadmap tiers
  /\bTier [ABC]\b/,
  // Internal project labels
  /\bWorkstream [A-Z]\b/,
  /\bT-[0-9]\s*chain\b/i,
  /\bC-[0-9]\b/,
  /\bPhase [A-Z]\b/,
  // Internal function names
  /\banalyze-threat-escalation\b/,
  /\bgenerate-poi-report\b/,
  /\bdashboard-ai-assistant\b/,
  // Internal audit labels
  /\bOverconfidence Audit\b/i,
  /\bclassified RED\b/i,
  /\bclassified GREEN\b/i,
  // Engineering implementation details
  /\bfeature[- ]?flag/i,
  /\btoken reactivation\b/i,
  /\bCSE path\b/i,
  // Internal task references
  /\bTask #\d+\b/,
];

function scanForLeaks(label: string, text: string): { pattern: string; match: string }[] {
  const out: { pattern: string; match: string }[] = [];
  for (const re of FORBIDDEN_IN_CUSTOMER_FACING) {
    const m = re.exec(text);
    if (m) out.push({ pattern: re.toString(), match: m[0] });
  }
  return out;
}

for (const c of CAPABILITY_REGISTRY) {
  Deno.test(`tenant-boundary: ${c.id} description is customer-safe`, () => {
    const leaks = scanForLeaks(`${c.id}.description`, c.description);
    assertEquals(leaks, [], `${c.id}.description contains forbidden tokens: ${JSON.stringify(leaks)}`);
  });
  Deno.test(`tenant-boundary: ${c.id} required_language is customer-safe`, () => {
    const leaks = scanForLeaks(`${c.id}.required_language`, c.required_language);
    assertEquals(leaks, [], `${c.id}.required_language contains forbidden tokens: ${JSON.stringify(leaks)}`);
  });
  Deno.test(`tenant-boundary: ${c.id} supported_questions are customer-safe`, () => {
    for (const q of c.supported_questions) {
      const leaks = scanForLeaks(`${c.id}.supported_question`, q);
      assertEquals(leaks, [], `${c.id}.supported_questions item contains forbidden tokens: ${JSON.stringify(leaks)}`);
    }
  });
  Deno.test(`tenant-boundary: ${c.id} unsupported_questions are customer-safe`, () => {
    for (const q of c.unsupported_questions) {
      const leaks = scanForLeaks(`${c.id}.unsupported_question`, q);
      assertEquals(leaks, [], `${c.id}.unsupported_questions item contains forbidden tokens: ${JSON.stringify(leaks)}`);
    }
  });
}

Deno.test("tenant-boundary: buildCapabilityRegistryPromptBlock emits no forbidden tokens", () => {
  const block = buildCapabilityRegistryPromptBlock();
  const leaks = scanForLeaks("registry-prompt-block", block);
  assertEquals(leaks, [], `registry prompt block contains forbidden tokens: ${JSON.stringify(leaks)}`);
});

Deno.test("tenant-boundary: per-question warning emits no forbidden tokens for any NOT_OPERATIONAL entry", () => {
  for (const c of CAPABILITY_REGISTRY.filter((c) => c.status === "NOT_OPERATIONAL")) {
    const warn = buildPerQuestionCapabilityWarning([c]);
    const leaks = scanForLeaks(`warning(${c.id})`, warn);
    assertEquals(leaks, [], `per-question warning for ${c.id} contains forbidden tokens: ${JSON.stringify(leaks)}`);
  }
});

Deno.test("tenant-boundary: per-question warning emits no forbidden tokens for any PARTIAL entry", () => {
  for (const c of CAPABILITY_REGISTRY.filter((c) => c.status === "PARTIAL")) {
    const warn = buildPerQuestionCapabilityWarning([c]);
    const leaks = scanForLeaks(`warning(${c.id})`, warn);
    assertEquals(leaks, [], `per-question warning for ${c.id} contains forbidden tokens: ${JSON.stringify(leaks)}`);
  }
});

// ─── End-to-end scenario probes (the operator's named test cases) ─────────
const scenarios: Array<{ q: string; mustMatchId: string }> = [
  {
    q: "Has any threat actor been cycling between social media accounts to target our principals? Show me the cluster.",
    mustMatchId: "account-cycling-detection",
  },
  {
    q: "Reconstruct a defensible timeline of activist activity near the BC Place stadium over the last 90 days.",
    mustMatchId: "historical-reconstruction",
  },
  {
    q: "What is the escalation probability for this threat?",
    mustMatchId: "trajectory-analysis",
  },
  {
    q: "Is this Twitter account the same person as this Reddit user?",
    mustMatchId: "entity-resolution-cross-platform",
  },
  {
    q: "Run face matching on this surveillance image against our ban list.",
    mustMatchId: "image-recognition",
  },
];
for (const sc of scenarios) {
  Deno.test(`scenario: detection matches ${sc.mustMatchId}`, () => {
    const matches = detectTargetedCapabilities(sc.q);
    const ids = matches.map((c) => c.id);
    assert(ids.includes(sc.mustMatchId), `expected ${sc.mustMatchId}; got ${ids.join(",")}`);
  });
}
