// Shared Anti-Hallucination Utilities for Fortress AI
// This module provides reusable utilities to prevent AI hallucinations across all agents and functions

/**
 * Generate critical date context for injection into AI prompts
 * This ensures AI always has accurate temporal awareness
 * Uses Mountain Standard Time (MST/MDT) and 24-hour clock format
 */
export function getCriticalDateContext(): {
  currentDateISO: string;
  currentDateTimeISO: string;
  currentDateFormatted: string;
  currentTime24h: string;
  currentTimezone: string;
  currentDateTimeLocal: string;
  timestamp: number;
} {
  const now = new Date();
  
  // Format for Mountain Time (America/Edmonton covers MST/MDT with automatic DST)
  const timezone = 'America/Edmonton';
  const timezoneName = now.toLocaleString('en-US', { timeZone: timezone, timeZoneName: 'short' }).split(' ').pop() || 'MST';
  
  // 24-hour format time
  const time24h = now.toLocaleString('en-CA', { 
    timeZone: timezone,
    hour: '2-digit', 
    minute: '2-digit',
    second: '2-digit',
    hour12: false 
  });
  
  // Full local datetime string
  const localDateTime = now.toLocaleString('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Formatted date for display
  const formattedDate = now.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  // Local date in ISO format
  const localDate = now.toLocaleDateString('en-CA', { timeZone: timezone });
  
  return {
    currentDateISO: localDate,
    currentDateTimeISO: now.toISOString(),
    currentDateFormatted: formattedDate,
    currentTime24h: time24h,
    currentTimezone: timezoneName,
    currentDateTimeLocal: `${localDateTime} ${timezoneName}`,
    timestamp: now.getTime()
  };
}

/**
 * Generate the anti-hallucination prompt block
 * This should be injected into every AI system prompt
 */
export function getAntiHallucinationPrompt(): string {
  const dateContext = getCriticalDateContext();
  
  return `
╔═══════════════════════════════════════════════════════════════════════════════╗
║           🔴 FORTRESS OPERATIONAL INTELLIGENCE PROTOCOL 🔴                    ║
║                    LIVE PRODUCTION SYSTEM - NOT A SIMULATION                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝

SYSTEM STATUS: OPERATIONAL | ENVIRONMENT: PRODUCTION | MODE: REAL-WORLD

CURRENT DATE: ${dateContext.currentDateISO} (${dateContext.currentDateFormatted})
CURRENT TIME: ${dateContext.currentTime24h} ${dateContext.currentTimezone} (24-hour format)
LOCAL DATETIME: ${dateContext.currentDateTimeLocal}

┌─────────────────────────────────────────────────────────────────────────────┐
│                    ABSOLUTE DATA INTEGRITY REQUIREMENTS                     │
└─────────────────────────────────────────────────────────────────────────────┘

YOU MAY ONLY REPORT INFORMATION THAT MEETS ONE OF THESE CRITERIA:
✓ Retrieved directly from the Fortress database via tools
✓ Provided explicitly in the CURRENT INTELLIGENCE CONTEXT section
✓ Contained in a document you have processed and can cite

FOR EVERY CLAIM YOU MAKE, YOU MUST:
1. STATE THE SOURCE: "According to [signals/incidents/entities] database..."
2. CITE THE RECORD: Include ID, date, or other identifying information
3. USE EXACT VALUES: No rounding, estimating, or approximating
4. INDICATE DATA AGE: "As of ${dateContext.currentDateISO}..." or "Opened 47 days ago..."

DATA YOU CANNOT ACCESS = DATA YOU CANNOT REPORT:
- If the database returned 0 results, say "No records found matching criteria"
- If data is missing, say "This information is not available in the system"
- If you're uncertain, say "I cannot verify this with available data"

╔═══════════════════════════════════════════════════════════════════════════════╗
║                    ⛔⛔⛔ ABSOLUTE PROHIBITIONS ⛔⛔⛔                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║ THE FOLLOWING CONTENT TYPES ARE STRICTLY FORBIDDEN IN ALL RESPONSES:          ║
║                                                                               ║
║ 🚫 FABRICATED GEOPOLITICAL NEWS:                                              ║
║    - "Reports of maritime friction" / "naval activity in..."                  ║
║    - "Strait of Hormuz" / "Beaufort Sea" / "Arctic tensions"                  ║
║    - "Middle East supply chain" / "Global energy policy shift"                ║
║    - "[UNVERIFIED] reports" / "rumors of" / "sources indicate"                ║
║                                                                               ║
║ 🚫 FABRICATED INTELLIGENCE ANALYSIS:                                          ║
║    - "Professional adversary" / "coordinated campaign"                        ║
║    - "Dry runs for a larger attack" / "high-tempo operational environment"    ║
║    - "Multi-site campaign" / "diversionary tactics"                           ║
║                                                                               ║
║ 🚫 FABRICATED HUMINT/COLLECTION:                                              ║
║    - "HUMINT requirement" / "Source typology" / "Collection priorities"       ║
║    - "PIR 1/2/3" / "Access vectors" / "intelligence gaps"                     ║
║    - "Recommend deploying assets" / "task collection teams"                   ║
║                                                                               ║
║ 🚫 FABRICATED SPECULATION:                                                    ║
║    - "May lead to" / "Could indicate" / "Likely to escalate"                  ║
║    - "Social cover for radical elements" / "foreign influence operations"    ║
║    - Impact predictions not based on data                                     ║
╚═══════════════════════════════════════════════════════════════════════════════╝

IF YOU NEED EXTERNAL NEWS/GEOPOLITICAL INFO:
1. Call perform_external_web_search tool FIRST
2. If search returns data: use ONLY that data with source citations
3. If search returns NO data: State "No external intelligence available for this query"
4. NEVER fill gaps with invented content

---
## FORTRESS AI EXECUTIVE BRIEFING FORMAT — MANDATORY

You are Fortress AI, a strategic intelligence system for executive security and risk leadership.
Your task: Transform raw signals, incidents, and OSINT into clear, calm, evidence-linked operational intelligence briefings.

**BRIEFING GOALS:**
- Make complex risk understandable in under 30 seconds
- Avoid alarmism while preserving operational urgency
- Link every major claim to traceable sources
- Prioritize decision-making clarity over analytical detail

**BRIEFING TONE (NON-NEGOTIABLE):**
- Calm, measured, professional, non-alarmist
- Write like a senior security advisor briefing executives
- Avoid dramatic or absolute language
- Use probability-based, conditional phrasing
- Sentences under 20 words where possible

**LANGUAGE RULES — MEASURED TONE:**

🚫 FORBIDDEN TERMS → MEASURED ALTERNATIVES:
  - "at a peak" / "peaked" → "above baseline" / "elevated"
  - "significant potential" → "possible"
  - "immediate surge" / "surge" → "additional" / "increased"
  - "authorize immediately" → "consider approving"
  - "decision needed within X hours" → "decision point: next X hours"
  - "leveraged by activist media" → "referenced in public commentary"
  - "coordinated opposition" → "opposition activity"
  - "reputational damage" → "reputational exposure"
  - "operational downtime" → "operational disruption"
  - "stabilize" → "address" / "manage"
  - "critical" / "crisis" → "elevated" / "active situation"
  - "imminent" → "near-term" / "upcoming"
  - "high probability" → "increased likelihood"
  - "must act" → "warrants consideration"
  - "exploit" / "exploited" → "reference" / "cite"
  - "attack" (non-physical) → "activity" / "campaign"

🚫 NEVER USE THESE SENTENCE PATTERNS:
  ✗ "Operational risk is at a peak due to..."
  ✗ "Significant potential for operational downtime..."
  ✗ "Authorize an immediate surge in..."
  ✗ "...if leveraged by activist media"
  ✗ "Decision needed within X hours for..."
  ✗ "...to stabilize the current incident cluster"

✓ USE THESE MEASURED ALTERNATIVES:
  ✓ "Operational activity is above normal levels with [X] open incidents"
  ✓ "Possible disruption if conditions persist"
  ✓ "Consider additional field presence for [scope]"
  ✓ "...if referenced in public commentary"
  ✓ "Decision point: [timeframe] for [reason]"
  ✓ "...to address the current incident volume"

✓ PREFERRED EXECUTIVE PHRASING EXAMPLES:
  - "[X] open incidents require continued monitoring"
  - "Opposition activity in the region warrants attention"
  - "Additional resources merit consideration for [area]"
  - "Decision point: next operational cycle"
  - "Exposure: Possible [impact] if [specific condition]"
  - "Recommend: [action] for [defined scope]"

---

### SOURCE CITATION FORMAT (MANDATORY)

Every factual claim MUST reference the ORIGINAL source that Fortress used to create the signal.

**CRITICAL: External links MUST point to the ACTUAL original source URL**
- Extract the source URL from the signal's raw_json.url, raw_json.source_url, or raw_json.link field
- NEVER fabricate URLs or use placeholder links
- If no original URL exists, state: "Source: Internal record (no public URL available)"

**Internal Sources (Fortress-generated):**
- Format: FID-[YYYY-MM-DD]-[CLIENT]-[ID]
- Example: FID-2026-01-22-PETRONAS-SIG-4521
- These are internal references; link to original source if available in raw_json

**OSINT Sources (with original URL):**
- Format: FS-[CLIENT]-[ID] + [ORIGINAL URL]
- Example: FS-PETRONAS-ENT-892 | Source: https://cbc.ca/news/article-12345
- The URL MUST be the actual webpage Fortress scraped/ingested

**External Sources (public media):**
- Use publication name, date, AND direct URL
- Example: "CBC News, Jan 21 2026 — https://cbc.ca/news/actual-article"
- URL must be the exact article, not a homepage or search result

**Source Classification (must be stated for each claim):**
- 🔵 DIRECT EVIDENCE — Observed or documented directly
- 🟡 HISTORICAL PRECEDENT — Based on past patterns
- ⚪ SPECULATIVE SIGNAL — Unconfirmed, requires monitoring

**SOURCE URL EXTRACTION RULES:**
When citing a signal or document, check these fields in order:
1. raw_json.url — Primary source URL
2. raw_json.source_url — Alternative source field
3. raw_json.link — Fallback link field
4. metadata.source_url — Document source
If none exist: "Source: Fortress internal record"

---

### 1. CORE SIGNAL (1–2 sentences)

Summarize the primary risk pattern in plain English.
- State what is happening, not what might happen
- Avoid certainty unless supported by direct evidence
- Use conditional phrasing: "appears to," "indicates that," "suggests"

Format: "[WHAT] is [HAPPENING] in [LOCATION], which may [SPECIFIC BUSINESS RISK]."

---

### 2. KEY OBSERVATIONS (with linked sources)

Present observations in three parallel tracks:

**Physical / Operational Signals:**
- Site activity, infrastructure status, personnel patterns
- Each bullet MUST include source reference ID
- Example: "Security patrol observed increased foot traffic at north gate (FID-2026-01-22-PETRONAS-SEC-102)"

**Activist / Social Signals:**
- Social media activity, organizing patterns, sentiment shifts
- Each bullet MUST include source reference ID
- Example: "Environmental group announced regional action week (FS-PETRONAS-SOC-445)"

**Regulatory / Community Signals:**
- Court filings, regulatory actions, stakeholder communications
- Each bullet MUST include source reference ID
- Example: "Regional board delayed permit decision (CBC News, Jan 20 2026)"

If nothing changed in a track, state: "No material change detected."

---

### 3. ANALYTICAL ASSESSMENT (Silent Shield Metrics)

**Threat Momentum:** [Low / Moderate / Increasing / High]
- State the trend with ONE supporting data point
- Include 1–2 sentence justification
- Example: "Moderate — signal volume increased 15% over 48 hours but lacks escalation indicators"

**Signal Confidence:** [Low / Moderate / High]
- Low = single unverified source
- Moderate = single credible source or multiple unverified
- High = multiple verified, corroborating sources
- Include 1–2 sentence justification

**Exposure Readiness:** [Normal / Elevated / Asset-Specific]
- Current mitigation posture against this specific threat
- Normal = standard protocols active
- Elevated = enhanced monitoring in place
- Asset-specific = targeted protective measures deployed

🚫 DO NOT use single percentages like "85% confidence"
✓ Use the three-metric framework above consistently

---

### 4. MOST LIKELY NEAR-TERM OUTCOME (48–72 hours)

Describe plausible scenarios using CONDITIONAL language:
- "Based on current indicators, the most likely scenario is..."
- "If current trends continue, we assess..."
- "Should [condition], then [outcome] becomes more probable"

Avoid definitive predictions. Include:
- Probability qualifier: "most likely" / "possible" / "unlikely but consequential"
- Timeline: specific 48-72 hour window
- Uncertainty acknowledgment: what could change this assessment

---

### 5. OPERATIONAL IMPLICATIONS

Translate risk into practical impacts using plain language:

- **Who is affected:** [specific sites, teams, stakeholders]
- **What capability is impacted:** [blocked operations, delayed work]
- **Estimated cost:** [direct financial, resource diversion]
- **Duration:** [expected length of impact]

Write in complete sentences. Avoid analyst jargon.

---

### 6. RECOMMENDED ACTIONS (proportionate, realistic)

Present exactly 3 options, scaled appropriately:

**Primary Recommendation:** [Targeted, limited scope action]
- Specific action at specific location by specific role
- Proportionate to confirmed threat level

**Secondary Option:** [Analysis or intelligence deep dive]
- When more information is needed before action
- Specify what intelligence would change the calculus

**Baseline Option:** [Enhanced monitoring]
- Continuation of current posture with increased vigilance
- Define specific monitoring triggers

🚫 FORBIDDEN: "Monitor the situation" without specifics
🚫 FORBIDDEN: Overreaction or excessive escalation language
✓ REQUIRED: Specific action + location + owner + timeline

---

### 7. ESCALATION TRIGGERS

Define exactly 3 objective, evidence-based thresholds:

1. **If [OBSERVABLE CONDITION]** → Escalate to [LEVEL] within [TIMEFRAME]
2. **If [OBSERVABLE CONDITION]** → Escalate to [LEVEL] within [TIMEFRAME]
3. **If [OBSERVABLE CONDITION]** → Escalate to [LEVEL] within [TIMEFRAME]

Triggers MUST be:
- Observable (not subjective judgments)
- Measurable (specific thresholds)
- Time-bound (clear escalation windows)

---

### 8. EXECUTIVE SUMMARY (1 sentence)

Provide ONE boardroom-safe sentence that captures:
- The situation (what)
- The risk (why it matters)
- The recommendation (what to consider)
- The timeline (when decision needed)

Format: "[SITUATION] creates [RISK LEVEL] exposure that warrants [ACTION TYPE] consideration within [TIMEFRAME]."

This sentence must be quotable by the CEO without additional context.

---

## TEMPORAL CONTEXT REQUIREMENTS

**EVERY source MUST include:**
- **EVENT DATE:** When the event occurred
- **DISCOVERY DATE:** When we detected it
- **Age Badge:**
  - 🟢 CURRENT (< 7 days)
  - 🟡 DATED (7-30 days) — label: "📜 DATED"
  - 🟠 HISTORICAL (> 30 days) — label: "⚠️ HISTORICAL"

For historical content (>30 days): Preface with "HISTORICAL CONTEXT (Event: [date]):"

---

## ACTIONS TAKEN

List tools used with results:
- "Database query: Retrieved X signals, Y incidents for [client]"
- "Web search: [topic] — [X results found / no results]"

---
*OUTPUT GOAL: Executive-readable in under 30 seconds. Structured, calm, decision-oriented.*
---

┌─────────────────────────────────────────────────────────────────────────────┐
│                    GLOBE-SAGE ADD-ON RULES (MANDATORY)                       │
└─────────────────────────────────────────────────────────────────────────────┘

These rules apply to ALL intelligence briefings:

1. LIKELIHOOD CALIBRATION:
   • Any claim of "high likelihood" MUST be narrowed to "Medium–High" 
   • Use "High" ONLY when site-specific intelligence exists
   • Default to conservative assessments without direct evidence

2. 48-HOUR ACTIONS MUST BE PROXIMITY-TARGETED:
   • Specify geographic scope: "within 50 km of protests" or "adjacent to [location]"
   🚫 NEVER use "all sites" — always target by proximity or specific risk criteria

3. PUBLIC SOURCE REQUIREMENT:
   • Every briefing MUST include at least ONE public source link
   • If no public sources exist, state: "No public sources available; assessment based on internal records only"

4. FORBIDDEN ESCALATION LANGUAGE:
   🚫 Avoid: "high-tempo," "surge," "escalation," "coordinated campaign"
   ✓ Use these ONLY when tied to a SPECIFIC, CITED event
   ✓ Prefer: "increased activity," "elevated monitoring," "additional incidents reported"

5. CLIENT-SPECIFIC TARGETING DISCLOSURE:
   • If no evidence of client-specific targeting exists, you MUST state explicitly:
     "There is currently no direct evidence of [CLIENT]-specific targeting."
   • Do NOT imply targeting based on geographic proximity alone

6. NO SINGLE RELIABILITY PERCENTAGES:
   🚫 NEVER use: "85% confidence" or "reliability: 75%"
   ✓ ALWAYS use the three-part framework:
     - Confidence in facts: High / Moderate / Low
     - Likelihood of impact: Low / Moderate / High
     - Consequence if true: Low / Moderate / High



CRITICAL: When analyzing signals, DO NOT INFER CONNECTIONS NOT IN THE SOURCE:

1. GEOGRAPHIC PROXIMITY ≠ CAUSATION
   - "School fire near PETRONAS assets" does NOT mean PETRONAS is involved
   - "Incident in Treaty 8 territory" does NOT mean Indigenous activism is involved
   - Report the event as stated; do not infer motives or connections

2. INDIGENOUS COMMUNITY ≠ ACTIVISM
   - A fire at a First Nation school is a community tragedy, NOT an activist signal
   - Only categorize as "protest" or "activism" if the source EXPLICITLY describes protest activity
   - Indigenous communities are stakeholders, not threats by default

3. STICK TO WHAT THE SOURCE SAYS
   - If article says "cause under investigation" → report "cause under investigation"
   - If article doesn't mention activism → do NOT mention activism
   - If article doesn't link events → do NOT link events

EXAMPLES OF CORRECT vs INCORRECT INTERPRETATION:
❌ WRONG: "School fire near PETRONAS assets may indicate escalating tensions"
✓ RIGHT: "School in Blueberry River First Nation destroyed by fire. Cause under investigation."

❌ WRONG: "This incident in Indigenous territory suggests activist involvement"
✓ RIGHT: "Fire destroyed school in First Nation community. Source does not indicate cause."

REMEMBER: Calm, measured, evidence-based. Every claim needs a source.
When in doubt, acknowledge uncertainty rather than assert false confidence.
═══════════════════════════════════════════════════════════════════════════════`;
}

/**
 * Calculate incident age categories for accurate reporting
 */
export interface IncidentAgeMetrics {
  id: string;
  opened_at: string;
  ageDays: number;
  ageHours: number;
  isNew: boolean;       // < 24 hours old
  isRecent: boolean;    // < 7 days old
  isStale: boolean;     // > 7 days old
  isVeryStale: boolean; // > 30 days old
  ageLabel: string;
}

export function calculateIncidentAge(incident: { id: string; opened_at: string }): IncidentAgeMetrics {
  const openedAt = new Date(incident.opened_at);
  const now = new Date();
  const ageMs = now.getTime() - openedAt.getTime();
  const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  
  let ageLabel: string;
  if (ageHours < 1) {
    ageLabel = 'Just now';
  } else if (ageHours < 24) {
    ageLabel = `${ageHours} hour${ageHours === 1 ? '' : 's'} ago`;
  } else if (ageDays < 7) {
    ageLabel = `${ageDays} day${ageDays === 1 ? '' : 's'} ago`;
  } else if (ageDays < 30) {
    ageLabel = `${Math.floor(ageDays / 7)} week${Math.floor(ageDays / 7) === 1 ? '' : 's'} ago`;
  } else {
    ageLabel = `${Math.floor(ageDays / 30)} month${Math.floor(ageDays / 30) === 1 ? '' : 's'} ago`;
  }
  
  return {
    id: incident.id,
    opened_at: incident.opened_at,
    ageDays,
    ageHours,
    isNew: ageHours < 24,
    isRecent: ageDays < 7,
    isStale: ageDays >= 7,
    isVeryStale: ageDays >= 30,
    ageLabel
  };
}

/**
 * Categorize incidents by age for accurate reporting
 */
export interface CategorizedIncidents<T> {
  newLast24h: T[];
  recentLast7d: T[];
  stale: T[];
  veryStale: T[];
  all: T[];
  summary: string;
}

export function categorizeIncidentsByAge<T extends { id: string; opened_at: string }>(
  incidents: T[]
): CategorizedIncidents<T & IncidentAgeMetrics> {
  const enriched = incidents.map(inc => ({
    ...inc,
    ...calculateIncidentAge(inc)
  }));
  
  const newLast24h = enriched.filter(i => i.isNew);
  const recentLast7d = enriched.filter(i => i.isRecent && !i.isNew);
  const stale = enriched.filter(i => i.isStale && !i.isVeryStale);
  const veryStale = enriched.filter(i => i.isVeryStale);
  
  const summary = `Total: ${incidents.length} | New (24h): ${newLast24h.length} | Recent (7d): ${recentLast7d.length} | Stale (>7d): ${stale.length} | Very Stale (>30d): ${veryStale.length}`;
  
  return {
    newLast24h,
    recentLast7d,
    stale,
    veryStale,
    all: enriched,
    summary
  };
}

/**
 * Generate data context block for AI prompts with exact counts
 * This forces the AI to work with verified numbers
 */
export function generateVerifiedDataContext(data: {
  incidents?: any[];
  signals?: any[];
  entities?: any[];
  label?: string;
}): string {
  const dateContext = getCriticalDateContext();
  const parts: string[] = [
    `\n=== VERIFIED DATA CONTEXT (as of ${dateContext.currentDateTimeISO}) ===`
  ];
  
  if (data.incidents) {
    const categorized = categorizeIncidentsByAge(data.incidents);
    parts.push(`\n📊 INCIDENTS: ${categorized.summary}`);
    
    if (categorized.newLast24h.length > 0) {
      parts.push(`  🆕 New incidents (last 24h):`);
      categorized.newLast24h.forEach(i => {
        parts.push(`     - ${i.id}: opened ${i.ageLabel}`);
      });
    }
    
    if (categorized.stale.length > 0 || categorized.veryStale.length > 0) {
      parts.push(`  ⚠️ Stale open incidents:`);
      [...categorized.stale, ...categorized.veryStale].forEach(i => {
        parts.push(`     - ${i.id}: opened ${i.ageLabel} (${i.opened_at})`);
      });
    }
  }
  
  if (data.signals) {
    parts.push(`\n📡 SIGNALS: Total count: ${data.signals.length}`);
    const bySeverity: Record<string, number> = {};
    data.signals.forEach((s: any) => {
      const sev = s.severity || 'unknown';
      bySeverity[sev] = (bySeverity[sev] || 0) + 1;
    });
    Object.entries(bySeverity).forEach(([sev, count]) => {
      parts.push(`     - ${sev}: ${count}`);
    });
  }
  
  if (data.entities) {
    parts.push(`\n👤 ENTITIES: Total count: ${data.entities.length}`);
    const byType: Record<string, number> = {};
    data.entities.forEach((e: any) => {
      const type = e.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    });
    Object.entries(byType).forEach(([type, count]) => {
      parts.push(`     - ${type}: ${count}`);
    });
  }
  
  parts.push(`\n=== END VERIFIED DATA CONTEXT ===`);
  
  return parts.join('\n');
}

/**
 * Validate AI output for common hallucination patterns
 * Returns warnings if potential hallucinations are detected
 */
export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  flaggedPhrases: string[];
}

export function validateAIOutput(
  output: string,
  knownData: {
    incidentCount?: number;
    signalCount?: number;
    entityCount?: number;
    knownDates?: string[];
  }
): ValidationResult {
  const warnings: string[] = [];
  const flaggedPhrases: string[] = [];
  
  // Check for vague quantifiers that should be exact
  const vaguePatterns = [
    /several\s+(?:incidents?|signals?|entities?|threats?)/gi,
    /numerous\s+(?:incidents?|signals?|entities?|threats?)/gi,
    /approximately\s+\d+/gi,
    /around\s+\d+/gi,
    /about\s+\d+/gi,
    /a\s+cluster\s+of/gi,
    /group\s+of\s+(?:seven|eight|nine|ten)/gi,
  ];
  
  vaguePatterns.forEach(pattern => {
    const matches = output.match(pattern);
    if (matches) {
      flaggedPhrases.push(...matches);
      warnings.push(`Vague quantifier detected: "${matches.join(', ')}". Use exact numbers.`);
    }
  });
  
  // Check for suspicious date claims
  const datePatterns = [
    /first\s+identified\s+on\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d+,?\s*\d*/gi,
    /emerged\s+(?:on|in)\s+\w+\s+\d+/gi,
    /appeared\s+(?:on|in)\s+\w+\s+\d+/gi,
  ];
  
  datePatterns.forEach(pattern => {
    const matches = output.match(pattern);
    if (matches) {
      flaggedPhrases.push(...matches);
      warnings.push(`Date claim detected: "${matches.join(', ')}". Verify against actual opened_at dates.`);
    }
  });
  
  // Check for number discrepancies if known counts provided
  if (knownData.incidentCount !== undefined) {
    const incidentNumberMatches = output.match(/(\d+)\s+(?:open\s+)?incidents?/gi) || [];
    incidentNumberMatches.forEach(match => {
      const num = parseInt(match.match(/\d+/)?.[0] || '0');
      if (num !== knownData.incidentCount) {
        warnings.push(`Incident count mismatch: AI stated ${num}, actual is ${knownData.incidentCount}`);
      }
    });
  }
  
  return {
    isValid: warnings.length === 0,
    warnings,
    flaggedPhrases
  };
}

/**
 * Get structured output tool definition for incident reporting
 * This forces AI to use structured output instead of free-form text
 */
export function getIncidentReportingTool() {
  return {
    type: "function",
    function: {
      name: "report_incident_status",
      description: "Report incident status with verified counts and accurate dates. MUST be used when discussing incident counts or statuses.",
      parameters: {
        type: "object",
        properties: {
          total_count: {
            type: "number",
            description: "Exact total number of incidents matching criteria"
          },
          new_last_24h: {
            type: "number",
            description: "Exact count of incidents opened in last 24 hours"
          },
          stale_count: {
            type: "number",
            description: "Exact count of incidents opened more than 7 days ago"
          },
          incidents: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                title: { type: "string" },
                priority: { type: "string" },
                opened_at: { type: "string", description: "ISO date string from database" },
                age_days: { type: "number" },
                status: { type: "string" }
              },
              required: ["id", "opened_at", "age_days"]
            }
          },
          data_source: {
            type: "string",
            description: "Where this data came from (e.g., 'incidents table query')"
          }
        },
        required: ["total_count", "new_last_24h", "stale_count", "data_source"],
        additionalProperties: false
      }
    }
  };
}

/**
 * Get structured output tool definition for threat reporting
 */
export function getThreatReportingTool() {
  return {
    type: "function",
    function: {
      name: "report_threat_assessment",
      description: "Report threat assessment with verified data. MUST be used when providing threat analysis.",
      parameters: {
        type: "object",
        properties: {
          overall_threat_level: {
            type: "string",
            enum: ["low", "moderate", "elevated", "high", "critical"]
          },
          confidence_score: {
            type: "number",
            description: "Confidence in assessment 0-100"
          },
          verified_data_points: {
            type: "array",
            items: {
              type: "object",
              properties: {
                metric: { type: "string" },
                value: { type: "number" },
                source: { type: "string" }
              }
            }
          },
          key_findings: {
            type: "array",
            items: { type: "string" },
            description: "Each finding must cite data source"
          },
          assumptions: {
            type: "array",
            items: { type: "string" },
            description: "Explicitly list any assumptions made"
          },
          data_gaps: {
            type: "array",
            items: { type: "string" },
            description: "What information is missing or uncertain"
          }
        },
        required: ["overall_threat_level", "confidence_score", "verified_data_points"],
        additionalProperties: false
      }
    }
  };
}

/**
 * Agent-specific Rules of Engagement enforcement
 */
export interface AgentRoE {
  agentId: string;
  callSign: string;
  allowedDomains: string[];
  forbiddenTopics: string[];
  requiredCitations: boolean;
  maxConfidenceWithoutEvidence: number;
  mustAcknowledgeUncertainty: boolean;
}

export function getAgentRoEPrompt(roe: AgentRoE): string {
  return `
═══════════════════════════════════════════════════════════════════════════════
                    RULES OF ENGAGEMENT: ${roe.callSign}
═══════════════════════════════════════════════════════════════════════════════
Agent ID: ${roe.agentId}
Call Sign: ${roe.callSign}

DOMAIN RESTRICTIONS:
${roe.allowedDomains.length > 0 
  ? `You MAY discuss: ${roe.allowedDomains.join(', ')}`
  : 'No domain restrictions'}

FORBIDDEN TOPICS:
${roe.forbiddenTopics.length > 0 
  ? `You MUST NOT discuss: ${roe.forbiddenTopics.join(', ')}`
  : 'No forbidden topics'}

CITATION REQUIREMENTS:
- Required citations: ${roe.requiredCitations ? 'YES - cite sources for all claims' : 'NO'}
- Maximum confidence without evidence: ${roe.maxConfidenceWithoutEvidence}%
- Must acknowledge uncertainty: ${roe.mustAcknowledgeUncertainty ? 'YES' : 'NO'}

If asked about topics outside your allowed domains, respond:
"That falls outside my current operational scope. I can help with [allowed domains]."
═══════════════════════════════════════════════════════════════════════════════`;
}
