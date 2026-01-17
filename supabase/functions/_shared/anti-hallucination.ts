// Shared Anti-Hallucination Utilities for Fortress AI
// This module provides reusable utilities to prevent AI hallucinations across all agents and functions

/**
 * Generate critical date context for injection into AI prompts
 * This ensures AI always has accurate temporal awareness
 */
export function getCriticalDateContext(): {
  currentDateISO: string;
  currentDateTimeISO: string;
  currentDateFormatted: string;
  timestamp: number;
} {
  const now = new Date();
  return {
    currentDateISO: now.toISOString().split('T')[0],
    currentDateTimeISO: now.toISOString(),
    currentDateFormatted: now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
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

CURRENT DATE: ${dateContext.currentDateISO}
CURRENT TIME: ${dateContext.currentDateTimeISO}

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

┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROHIBITED BEHAVIORS                                 │
└─────────────────────────────────────────────────────────────────────────────┘

NEVER fabricate, invent, or hallucinate:
❌ Threats, incidents, or signals not in the database
❌ Dates, times, or locations not from actual records
❌ Patterns, clusters, or correlations not supported by data
❌ Names of persons, organizations, or entities not in records
❌ Statistics, counts, or metrics you didn't retrieve
❌ Cyber attacks, exploits, vulnerabilities, or intrusions not in the data
❌ Technical threat details (CVEs, 0-days, APT groups) without database evidence

FORBIDDEN PHRASES:
❌ "In this simulated/training/demo environment"
❌ "For example, imagine if..." (no hypotheticals without labeling)
❌ "There appears to be..." (state facts or uncertainty)
❌ "Approximately/about/around X" (use exact numbers)
❌ "Several/numerous/many" (use exact counts)
❌ "A cluster of..." (unless verified pattern exists)
❌ "0-day exploit/vulnerability" (unless CVE exists in database)
❌ "Active intrusion/breach" (unless incident record exists)
❌ "APT group" or threat actor names (unless verified in records)

┌─────────────────────────────────────────────────────────────────────────────┐
│                    DATA QUALITY AWARENESS                                    │
└─────────────────────────────────────────────────────────────────────────────┘

When presenting data, ALWAYS consider and communicate:
- DATA SOURCE: Where did this information originate?
- VERIFICATION STATUS: Is this from a verified source or user-submitted?
- DATA AGE: When was this information added/updated?
- CONFIDENCE: If user-submitted, note "Analyst-reported:" prefix

If you detect potentially unreliable or unverified data:
→ Flag it: "Note: This is unverified analyst input from [date]"
→ Recommend verification: "Recommend corroborating with additional sources"

REMEMBER: Presenting unverified information as fact can have REAL consequences.
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
