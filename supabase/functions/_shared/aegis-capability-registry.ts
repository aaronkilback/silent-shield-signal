// supabase/functions/_shared/aegis-capability-registry.ts
//
// CAPABILITY REGISTRY — what Aegis can / cannot do today.
//
// Principle (operator-ratified 2026-06-01):
//   Fortress must never imply a capability exists when it does not.
//   Absence of findings is NOT the same as absence of capability.
//
// Without this layer, Aegis defaults to "no signals indicating <X>" which
// reads as "we looked and found nothing." For NOT_OPERATIONAL capabilities,
// the truth is "we are not able to look at all." The registry distinguishes
// these two states explicitly.
//
// The registry is consulted BEFORE Coverage Confidence:
//   - If targeted capability is NOT_OPERATIONAL → emit required_language;
//     Coverage Confidence is not applicable (no evidence to measure).
//   - If targeted capability is PARTIAL → emit partial-capability warning
//     + Coverage Confidence (with limitations explicit).
//   - If targeted capability is OPERATIONAL → standard Coverage Confidence.
//
// HARD RULES:
//   • Status changes require explicit PR + operator sign-off (auditable).
//   • required_language is operator-tunable; emitted VERBATIM by Aegis when
//     the capability is invoked but NOT_OPERATIONAL.
//   • Pure data module + helper functions; no side effects.

// ─────────────────────────────────────────────────────────────────────────────
// §1 — Types
// ─────────────────────────────────────────────────────────────────────────────

export type CapabilityStatus = "OPERATIONAL" | "PARTIAL" | "NOT_OPERATIONAL";

export interface CapabilityEntry {
  /** Stable identifier (kebab-case). */
  id: string;
  /** Operator-facing name. */
  name: string;
  /** Current status. */
  status: CapabilityStatus;
  /** One-line description of what the capability does. */
  description: string;
  /** Example natural-language questions the capability CAN answer. */
  supported_questions: string[];
  /** Example questions that LOOK like they belong to this capability but are NOT supported today. */
  unsupported_questions: string[];
  /**
   * Customer-facing language Aegis MUST use VERBATIM (or near-verbatim) when
   * the capability is invoked but NOT_OPERATIONAL or PARTIAL. This is the
   * honest framing that prevents capability misrepresentation.
   *
   * TENANT-BOUNDARY RULE (operator-ratified 2026-06-01):
   *   This string is EMITTED to the customer. It MUST be tenant-agnostic and
   *   customer-safe. Forbidden in this string:
   *     • Specific customer / tenant names (CRT, Petronas, BC Place, etc.)
   *     • Internal roadmap tiers (Tier A, Tier B, etc.)
   *     • Internal project labels (Workstream D, T-3 chain, etc.)
   *     • Internal function names (analyze-threat-escalation, etc.)
   *     • Internal audit classifications (RED/GREEN/Overconfidence Audit)
   *     • Engineering implementation details (feature flags, budget, token state)
   *     • References to other tenants existing
   *   Allowed: generic capability concepts (entity resolution, temporal grounding,
   *   etc.) — these are platform-wide concepts symmetric across tenants.
   */
  required_language: string;
  /** Keywords for server-side detection (lower-cased; matches via regex word-boundary). */
  detection_keywords: string[];
  /**
   * Roadmap pointer (Task ID, doc, etc.) for operator drill-down.
   * INTERNAL-ONLY: never emitted to customer-facing prompt blocks.
   */
  roadmap_ref?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 — Registry contents
//
// Status assignments are evidence-backed:
//   - NOT_OPERATIONAL = the capability does NOT exist in production today
//     (and so cannot produce findings, valid or otherwise).
//   - PARTIAL = the capability exists in some form but has significant
//     limitations operators should know about (and Aegis should disclose).
//   - OPERATIONAL = the capability exists, is healthy, and can produce
//     findings reliably for its supported question set.
// ─────────────────────────────────────────────────────────────────────────────

export const CAPABILITY_REGISTRY: CapabilityEntry[] = [
  // ━━━ NOT_OPERATIONAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: "account-cycling-detection",
    name: "Account Cycling Detection",
    status: "NOT_OPERATIONAL",
    description: "Detection of single actor controlling multiple new accounts to evade bans, rate limits, or platform takedowns.",
    supported_questions: [],
    unsupported_questions: [
      "Has any threat actor been cycling between social media accounts to target our principals?",
      "Is this banned user reappearing under a new identity?",
      "Show me the cycling cluster targeting X.",
      "Are these accounts the same person?",
    ],
    required_language:
      "Account Cycling Detection is not yet operational. Fortress cannot detect cycling activity at this time. " +
      "This capability is planned but currently requires additional development. " +
      "Note: this is a capability gap, not an absence of findings — Fortress is not yet able to look.",
    detection_keywords: [
      "cycling", "cycle accounts", "alternate account", "alt account", "alt-account",
      "sockpuppet", "sock puppet", "sock-puppet",
      "ban evasion", "banned reappear", "evading ban",
      "new identity", "same person new account",
      "account fingerprint",
    ],
    roadmap_ref: "Task #154 §1; Task #173 #9 (internal — never emitted)",
  },
  {
    id: "image-recognition",
    name: "Image Recognition / Suspect Identification",
    status: "NOT_OPERATIONAL",
    description: "Face matching against operator-curated ban list or entity-photos; visual evidence correlation.",
    supported_questions: [],
    unsupported_questions: [
      "Is this person in the photo on our ban list?",
      "Does this image match anyone we are watching?",
      "Identify the person in this surveillance still.",
      "Run face matching on this image.",
    ],
    required_language:
      "Image Recognition is not yet operational. Fortress cannot perform face matching at this time. " +
      "This capability requires a legal-authorization framework and a pre-deployment bias audit as hard gates " +
      "before it can ship. " +
      "Note: this is a capability gap, not an absence of findings.",
    detection_keywords: [
      "face match", "face matching", "facial recognition", "facial-recognition",
      "image recognition", "identify person", "who is in",
      "suspect identification", "photo matching", "photo match",
      "match this image", "match this photo",
      "visual identification",
    ],
    roadmap_ref: "Task #154 §2; Task #173 #10 (internal — never emitted)",
  },
  {
    id: "historical-reconstruction",
    name: "Historical Reconstruction (defensible timeline)",
    status: "NOT_OPERATIONAL",
    description: "Defensible chronology of past events with original-content evidence, suitable for legal / board / insurance use.",
    supported_questions: [],
    unsupported_questions: [
      "Reconstruct what happened at a past protest event.",
      "Build a defensible timeline of activity since date X.",
      "Produce a forensic chronology for this incident.",
      "Show me the legally-defensible reconstruction of the event.",
    ],
    required_language:
      "Defensible Historical Reconstruction is not yet operational. Fortress can summarize available signals about a past " +
      "event, but cannot produce a defensible chronological reconstruction at this time. " +
      "This is a compound capability that depends on temporal grounding, original-content preservation, retrieval-chain " +
      "coverage, and cross-platform entity resolution — components that are currently incomplete. " +
      "Note: when summarizing past signals, Fortress will mark them as best-effort summary, not defensible reconstruction.",
    detection_keywords: [
      "reconstruct", "reconstruction",
      "defensible timeline", "defensible chronology",
      "build a timeline", "full timeline",
      "what happened at", "forensic timeline",
      "legally defensible", "insurance documentation",
      "board briefing reconstruction",
    ],
    roadmap_ref: "Task #156 Tier A compound; Task #173 #11",
  },
  {
    id: "entity-resolution-cross-platform",
    name: "Cross-Platform Entity Resolution",
    status: "NOT_OPERATIONAL",
    description: "Automated linking of the same actor across platforms / aliases / identifiers.",
    supported_questions: [],
    unsupported_questions: [
      "Is this Twitter account the same person as this Reddit user?",
      "Find all accounts belonging to person X across platforms.",
      "Are these two identities the same actor?",
      "Resolve identity X.",
    ],
    required_language:
      "Cross-platform Entity Resolution is not yet operational. Fortress can show operator-curated entity relationships " +
      "(currently a sparse graph) but cannot automatically link accounts across platforms. " +
      "This capability is planned but currently requires additional development. " +
      "Note: this is a capability gap, not an absence of findings.",
    detection_keywords: [
      "same person", "same actor",
      "cross-platform identity", "cross platform identity",
      "link these accounts", "who is behind",
      "identity correlation", "resolve identity",
      "find all accounts for", "find accounts belonging to",
    ],
    roadmap_ref: "Task #154 §1.3; Task #173 #8 (internal — never emitted)",
  },
  {
    id: "trajectory-analysis",
    name: "Trajectory Analysis",
    status: "NOT_OPERATIONAL",
    description: "Behavioral-change-over-time detection with defensible escalation/de-escalation/stability claims.",
    supported_questions: [],
    unsupported_questions: [
      "What is the escalation probability for this threat?",
      "Is this becoming more dangerous?",
      "What is the trajectory of activity around X?",
      "Are they escalating?",
      "Show me the behavioral trend.",
    ],
    required_language:
      "Trajectory Analysis (behavioral-change-over-time claims) is not yet operational at defensible coverage. Fortress can " +
      "report point-in-time signal severity but cannot produce defensible trajectory or escalation-probability claims. " +
      "Per-entity behavioral baselines (the foundation for anomaly detection) are not yet computed. " +
      "Note: this is a capability gap; numeric trajectory probabilities should not be relied upon today.",
    detection_keywords: [
      "trajectory", "escalating", "de-escalating", "deescalating",
      "getting worse", "getting more dangerous", "becoming more dangerous",
      "escalation probability", "escalation likelihood",
      "behavioral change", "behavioral trend",
      "trend over time", "trending up", "trending down",
    ],
    roadmap_ref: "Task #156 Tier A compound; Task #173 #11",
  },
  {
    id: "original-content-snapshotting",
    name: "Original-Content Snapshotting",
    status: "NOT_OPERATIONAL",
    description: "At-acquisition snapshot of source content into preserved storage (so URLs that decay don't destroy cited evidence).",
    supported_questions: [],
    unsupported_questions: [
      "Show me the original content of this article — verify it hasn't changed.",
      "Preserve this for legal use.",
      "Snapshot this source.",
    ],
    required_language:
      "Original-Content Snapshotting is not yet operational. Fortress preserves source URLs but does NOT snapshot the " +
      "content at acquisition time. URLs may decay or change between acquisition and review. For legal/insurance use, " +
      "additional independent preservation is recommended. " +
      "Note: this gap directly limits evidence-package defensibility and historical reconstruction quality.",
    detection_keywords: [
      "snapshot", "snapshotted", "snapshotting",
      "preserve evidence", "preserve the content",
      "original content", "archived content",
      "wayback", "internet archive",
    ],
    roadmap_ref: "Task #157 §9; Task #173 #7",
  },
  {
    id: "image-content-extraction",
    name: "Image Content Extraction (OCR / description / vectors)",
    status: "NOT_OPERATIONAL",
    description: "Extraction of text, description, or face vectors from image content; today only image URL is preserved.",
    supported_questions: [],
    unsupported_questions: [
      "What's in this image?",
      "Read the text in this photo.",
      "Describe what's in the image.",
      "Compare this face to entries in our entity-photos bucket.",
    ],
    required_language:
      "Image Content Extraction (OCR / description / face vectors) is not yet operational. Fortress preserves image URLs " +
      "but does not extract image content. This is a prerequisite for Image Recognition and contributes to overall " +
      "information fidelity.",
    detection_keywords: [
      "image content", "what's in the image", "what is in this image",
      "ocr", "read the text in", "extract text from image",
      "describe the image", "image description",
      "image text",
    ],
    roadmap_ref: "Task #157 §1; Task #154 §2 prereq",
  },

  // ━━━ PARTIAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: "social-intelligence-collection",
    name: "Social Intelligence Collection",
    status: "PARTIAL",
    description: "Acquisition of social-media signals across platforms.",
    supported_questions: [
      "What is in the news about X?",
      "Are there community-news mentions of X?",
      "What did the RSS feeds say about X?",
    ],
    unsupported_questions: [
      "What's happening on Twitter/X about X?",
      "What is being discussed on Reddit about X?",
      "Show me Discord / Telegram chatter about X.",
      "What's trending on Instagram about X?",
    ],
    required_language:
      "Direct Social Media Collection is currently limited. Twitter/X is not currently collected; Meta (Facebook/Instagram) " +
      "is not currently collected; Reddit, Discord, Telegram, and TikTok are not collected. News articles that reference " +
      "social-media content may still be collected. When a question requires direct social-platform context, Fortress will " +
      "NOTE the explicit collection gap (e.g., 'Reddit not collected for this entity').",
    detection_keywords: [
      "twitter", "x.com",
      "reddit", "subreddit",
      "instagram",
      "facebook", "meta",
      "tiktok", "discord", "telegram",
      "social media", "social chatter",
      "what's trending", "viral",
    ],
    roadmap_ref: "Task #167 #2 (Meta token reactivation); Task #173 #3",
  },
  {
    id: "threat-attribution",
    name: "Threat Attribution (automatic)",
    status: "PARTIAL",
    description: "Linking observed threats to specific named actors or groups.",
    supported_questions: [
      "Which entity is linked to this signal (operator-curated)?",
      "What entity relationships are recorded for X?",
      "Who has been named as a threat in our entities table?",
    ],
    unsupported_questions: [
      "Who is responsible for this threat? (automatic attribution)",
      "Attribute this attack to an actor based on content alone.",
      "Identify the threat actor automatically.",
    ],
    required_language:
      "Automated Threat Attribution is partial. Fortress can show operator-curated entity links on signals but cannot " +
      "automatically attribute threats to specific actors based on content alone. Where attribution would normally appear, " +
      "Fortress will indicate that attribution is operator-curated (or unknown).",
    detection_keywords: [
      "who is responsible", "who did this",
      "attribute", "attribution",
      "who is behind", "responsible party",
      "threat actor", "actor responsible",
    ],
    roadmap_ref: "Existing entity_relationships table; manual attribution",
  },
  {
    id: "executive-threat-assessment",
    name: "Executive Threat Assessment",
    status: "PARTIAL",
    description: "Per-entity threat profile with current signal context.",
    supported_questions: [
      "What is the current threat level for executive X?",
      "What are the recent signals about principal Y?",
      "Show me the risk profile for entity Z.",
    ],
    unsupported_questions: [
      "Will the threat to executive X increase next month?",
      "Is X becoming a higher-priority target?",
      "What's the trajectory of threats to executive X?",
    ],
    required_language:
      "Executive Threat Assessment provides current-state signal context and operator-curated risk profiles. It does NOT " +
      "produce trajectory predictions or behavioral-change claims (Trajectory Analysis is not yet operational). When " +
      "trajectory is implied, Fortress will note the gap.",
    detection_keywords: [
      "threat assessment", "threat level", "threat status",
      "executive risk", "executive threat",
      "principal threat", "principal risk",
      "vip threat", "vip risk",
    ],
    roadmap_ref: "Existing assess-entity function; Task #168 §1.6 YELLOW classification",
  },
  {
    id: "evidence-package-generation",
    name: "Evidence Package Generation",
    status: "PARTIAL",
    description: "Defensible artifact compilation for downstream legal / insurance / board use.",
    supported_questions: [
      "Generate a POI report on entity X.",
      "Produce an investigation summary on incident Y.",
      "Compile what we know about Z with cited sources.",
    ],
    unsupported_questions: [
      "Produce a snapshot-verified evidence package suitable for court use.",
      "Generate a legally-defensible artifact with preserved original content.",
      "Compile an Evidence Package with full chain-of-custody for every claim.",
    ],
    required_language:
      "Evidence Package Generation produces cited-source reports with operator-curated content. Original-content " +
      "snapshots are NOT preserved (URLs may decay). Structured per-claim confidence framing is available but not yet " +
      "default. For legal / insurance use, additional independent verification is recommended. " +
      "Note: this is the closest-to-defensible artifact Fortress can produce today; gaps are explicit.",
    detection_keywords: [
      "evidence package",
      "poi report", "p.o.i. report",
      "formal report", "investigation report",
      "defensible artifact", "legal documentation",
      "insurance documentation", "board briefing",
      "chain of custody", "chain-of-custody",
    ],
    roadmap_ref: "Existing generate-poi-report; Task #168 §1.3 GREEN-with-residual",
  },

  // ━━━ OPERATIONAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    id: "signal-feed-retrieval",
    name: "Signal Feed Retrieval (tenant-scoped, last 7d)",
    status: "OPERATIONAL",
    description: "Tenant-scoped signal feed lookup for recent operational intelligence.",
    supported_questions: [
      "What signals have we collected this week?",
      "What are the most recent high-severity signals for our tenant?",
      "Show me signals about entity X from the last 7 days.",
    ],
    unsupported_questions: [
      "Show me signals older than the available retrieval window.",
      "Show me signals from other tenants.",
    ],
    required_language: "",
    detection_keywords: [
      "signals", "recent signals", "signal feed",
      "what have we collected",
    ],
    roadmap_ref: "Existing signals table + tenant-scoping",
  },
  {
    id: "entity-profile-lookup",
    name: "Entity Profile Lookup",
    status: "OPERATIONAL",
    description: "Per-entity profile data: attributes, risk_level, recent activity, operator-curated relationships.",
    supported_questions: [
      "What do we know about entity X?",
      "Show me the profile for principal Y.",
      "List the operator-curated relationships of Z.",
    ],
    unsupported_questions: [
      "Find new entities not yet in our database.",
      "Identify unknown people in this content.",
    ],
    required_language: "",
    detection_keywords: [
      "entity profile", "profile for", "show me entity",
      "what do we know about", "tell me about",
    ],
    roadmap_ref: "Existing entities + entity_relationships tables",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Helpers (pure functions)
// ─────────────────────────────────────────────────────────────────────────────

const NORMALIZE = (s: string) => s.toLowerCase().normalize("NFKD");

/**
 * Detect which capabilities a question targets by keyword match.
 * Returns capabilities ordered by status priority:
 *   NOT_OPERATIONAL first (most-urgent disclosure), then PARTIAL, then OPERATIONAL.
 * Empty array = no capability detected (LLM uses default routing).
 */
export function detectTargetedCapabilities(question: string): CapabilityEntry[] {
  const norm = NORMALIZE(question);
  const matched: CapabilityEntry[] = [];
  for (const cap of CAPABILITY_REGISTRY) {
    for (const kw of cap.detection_keywords) {
      const kwNorm = NORMALIZE(kw);
      // word-boundary-ish match — accept multi-word phrases as substring
      if (norm.includes(kwNorm)) {
        matched.push(cap);
        break; // one keyword match per capability is enough
      }
    }
  }
  // Sort: NOT_OPERATIONAL > PARTIAL > OPERATIONAL
  const order: Record<CapabilityStatus, number> = {
    NOT_OPERATIONAL: 0, PARTIAL: 1, OPERATIONAL: 2,
  };
  matched.sort((a, b) => order[a.status] - order[b.status]);
  return matched;
}

/**
 * Build the system-prompt block that lists capabilities by status with
 * required language. Aegis consults this block BEFORE answering and uses
 * required_language verbatim when a NOT_OPERATIONAL capability is invoked.
 */
export function buildCapabilityRegistryPromptBlock(): string {
  const notOp = CAPABILITY_REGISTRY.filter((c) => c.status === "NOT_OPERATIONAL");
  const partial = CAPABILITY_REGISTRY.filter((c) => c.status === "PARTIAL");
  const op = CAPABILITY_REGISTRY.filter((c) => c.status === "OPERATIONAL");

  const lines: string[] = [];
  lines.push(
    "═══ CAPABILITY REGISTRY (DO NOT IMPLY UNAVAILABLE CAPABILITIES) ═══",
    "",
    "Before answering ANY question, identify which capabilities are required.",
    "If any required capability is NOT_OPERATIONAL, you MUST respond with the",
    "required_language for that capability INSTEAD of attempting to answer.",
    "",
    "Specifically: do NOT say 'no signals indicating <X>' if the capability to",
    "detect <X> does not exist. That phrasing falsely implies Fortress searched",
    "and found nothing. The truth is Fortress is not yet able to look.",
    "",
    "PRINCIPLE: Fortress must never imply a capability exists when it does not.",
    "Absence of findings is NOT the same as absence of capability.",
    "",
  );

  if (notOp.length > 0) {
    lines.push("── NOT_OPERATIONAL (refuse with the specified language) ─────────────");
    for (const c of notOp) {
      lines.push(``);
      lines.push(`• ${c.name}`);
      lines.push(`  Description: ${c.description}`);
      if (c.unsupported_questions.length > 0) {
        lines.push(`  Looks like: "${c.unsupported_questions[0]}"`);
      }
      lines.push(`  Required response: ${c.required_language}`);
    }
    lines.push("");
  }

  if (partial.length > 0) {
    lines.push("── PARTIAL (use, but disclose the limitation) ───────────────────────");
    for (const c of partial) {
      lines.push(``);
      lines.push(`• ${c.name}`);
      lines.push(`  Description: ${c.description}`);
      lines.push(`  Disclosure: ${c.required_language}`);
    }
    lines.push("");
  }

  if (op.length > 0) {
    lines.push("── OPERATIONAL (free to use; standard Coverage Confidence applies) ──");
    for (const c of op) {
      lines.push(`• ${c.name} — ${c.description}`);
    }
    lines.push("");
  }

  lines.push(
    "INTEGRATION WITH COVERAGE CONFIDENCE:",
    "  • If a NOT_OPERATIONAL capability is invoked, the Coverage Confidence section",
    "    is NOT applicable (there is no evidence to measure). Emit the capability",
    "    required_language INSTEAD of the standard SHORT/EXPANDED template.",
    "  • If a PARTIAL capability is invoked, include the disclosure in the response,",
    "    AND emit the standard Coverage Confidence section over what evidence exists.",
    "  • If only OPERATIONAL capabilities are invoked, proceed with the normal flow.",
  );

  return lines.join("\n");
}

/**
 * Build a focused per-question warning block when one or more capabilities
 * matched by detectTargetedCapabilities() have NOT_OPERATIONAL or PARTIAL status.
 * This is injected on TOP of the registry block (defense in depth) so that
 * for queries clearly targeting an unavailable capability, the LLM cannot miss it.
 */
export function buildPerQuestionCapabilityWarning(matches: CapabilityEntry[]): string {
  const notOp = matches.filter((c) => c.status === "NOT_OPERATIONAL");
  const partial = matches.filter((c) => c.status === "PARTIAL");
  if (notOp.length === 0 && partial.length === 0) return "";

  const lines: string[] = [];
  lines.push("═══ CAPABILITY WARNING — THIS QUESTION ═══");
  lines.push("");
  if (notOp.length > 0) {
    lines.push("This question appears to target the following NOT_OPERATIONAL capability/capabilities.");
    lines.push("You MUST respond with the required_language for the first listed capability INSTEAD");
    lines.push("of attempting to answer. Do NOT generate findings or 'no signals' phrasing.");
    lines.push("");
    for (const c of notOp) {
      lines.push(`▶ ${c.name} [NOT_OPERATIONAL]`);
      lines.push(`  Required response (verbatim or near-verbatim):`);
      lines.push(`  "${c.required_language}"`);
      lines.push("");
    }
  }
  if (partial.length > 0) {
    lines.push("This question also touches the following PARTIAL capability/capabilities.");
    lines.push("Include the disclosure language explicitly in your response.");
    lines.push("");
    for (const c of partial) {
      lines.push(`▶ ${c.name} [PARTIAL]`);
      lines.push(`  Disclosure: ${c.required_language}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Look up a capability by id (for tests + external callers). */
export function getCapability(id: string): CapabilityEntry | undefined {
  return CAPABILITY_REGISTRY.find((c) => c.id === id);
}
