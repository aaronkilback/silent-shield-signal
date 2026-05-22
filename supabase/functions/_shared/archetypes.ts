/**
 * Per-tenant monitoring archetypes — single source of truth.
 *
 * Replaces the Petronas-era hardcoded "Canadian energy infrastructure"
 * framing that lived inside monitor-social-unified (and will be adopted
 * by other monitors as they migrate). Each archetype declares:
 *   - threat_vocab: short OR-joinable string for Google CSE queries
 *   - ai_system_prompt: archetype-scoped prompt for the relevance gate
 *   - own_channel_handles: optional curated list of known canonical
 *     handles for the protected entity (used by the profile filter
 *     so e.g. @bcplace doesn't get killed as "generic profile")
 *
 * Resolution rule:
 *   client.monitoring_config.archetype → ARCHETYPE_DEFS[archetype]
 *   missing/unknown → fall back to 'energy_infrastructure' (preserves
 *   existing Petronas behavior so this module is backward-compatible
 *   on day one).
 *
 * Operator override path:
 *   client.monitoring_config.threat_vocab_override (optional string)
 *   wins over the archetype default. Leaves the AI prompt unchanged.
 *
 * Schema: this module READS monitoring_config (JSONB). No DDL needed.
 */

export type Archetype =
  | 'energy_infrastructure'
  | 'sports_venue'
  | 'celebrity_vip'
  | 'tournament_event'
  | 'executive'
  | 'corporate'
  | 'critical_infrastructure';

export const ARCHETYPE_LIST: Archetype[] = [
  'energy_infrastructure',
  'sports_venue',
  'celebrity_vip',
  'tournament_event',
  'executive',
  'corporate',
  'critical_infrastructure',
];

interface ArchetypeDef {
  /**
   * Threat-vocab string used inside parentheses on Google CSE queries.
   * Format: `term OR term OR "multi word"`. Keep under ~150 chars total
   * so the full query stays under CSE's 256-char practical ceiling
   * when combined with site filter and client name.
   */
  threat_vocab: string;

  /**
   * System prompt used by the AI relevance gate for client-scope
   * searches (not entity-scope — that prompt is already
   * subject-agnostic and stays unchanged in monitor-social-unified).
   *
   * The `${sourceName}` placeholder is replaced at call time with the
   * client/entity name. Keep tight: every extra paragraph here costs
   * tokens on every CSE result evaluated.
   */
  ai_system_prompt: (sourceName: string) => string;
}

const COMMON_TEMPORAL_RULE = `TEMPORAL RULE: Reject content whose original post or event date is CLEARLY MORE THAN 180 DAYS OLD. If no date is discernible, DEFAULT TO ACCEPTING — Google CSE often strips dates, and real recent posts often look undated. The downstream pipeline will dedupe and rescore.`;

const COMMON_OUTPUT_RULE = `Return JSON: { "relevant": boolean, "reason": string (1 sentence), "confidence": number (0-1), "category": string, "location": string }`;

export const ARCHETYPE_DEFS: Record<Archetype, ArchetypeDef> = {
  // ─────────────────────────────────────────────────────────────────
  // ENERGY INFRASTRUCTURE — preserves original Petronas-era behavior.
  // Anything missing/unknown archetype falls back here, so existing
  // clients (Petronas Canada, BCCH) continue to work without changes.
  // ─────────────────────────────────────────────────────────────────
  energy_infrastructure: {
    threat_vocab: 'protest OR blockade OR breach OR sabotage OR activist OR pipeline OR LNG',
    ai_system_prompt: (sourceName) => `You are an intelligence analyst filtering social media search results for security monitoring of "${sourceName}" — a Canadian energy infrastructure operator (pipelines, LNG facilities, energy companies).

${COMMON_TEMPORAL_RULE}

CRITICAL GEOGRAPHIC RULE: Reject content about protests, activism, or events that physically occurred OUTSIDE of Canada, even if the organization name matches (e.g. "Extinction Rebellion Austria", "XR Cape Town" are NOT relevant). Only Canadian-occurring events or content about Canadian energy companies qualify.

A result is RELEVANT if ANY of:
- Activism, protests, blockades, sabotage, organizing targeting Canadian energy infrastructure
- Specific threat / breach / security incident on a monitored entity
- Specific post about a Canadian energy company, pipeline, LNG facility
- References Canadian geography or Canadian energy companies
- Names a tracked person/group/campaign active in Canadian energy activism
- Is undated but otherwise specific and on-topic (DEFAULT ACCEPT)

A result is NOT relevant if:
- Unrelated topic that matches a keyword incidentally
- Generic platform homepage with no specific content
- International with no Canadian connection
- Entertainment / marketing / spam
- Explicit date older than 180 days
- Extinction Rebellion chapter explicitly outside Canada
- Wikipedia / archived historical content

${COMMON_OUTPUT_RULE}`,
  },

  // ─────────────────────────────────────────────────────────────────
  // SPORTS VENUE — stadiums, arenas (BC Place, Rogers Arena).
  // Threat surface: drones, perimeter, ticket/accreditation fraud,
  // crowd disruption, protests AT the venue, threats to venue.
  // ─────────────────────────────────────────────────────────────────
  sports_venue: {
    threat_vocab: 'protest OR drone OR "unauthorized access" OR "ticket fraud" OR "crowd disruption" OR threat OR breach OR "security incident"',
    ai_system_prompt: (sourceName) => `You are an intelligence analyst filtering social media search results for security monitoring of "${sourceName}" — a sports venue / stadium.

${COMMON_TEMPORAL_RULE}

A result is RELEVANT if ANY of:
- Protests, demonstrations, or organized mobilization AT or ABOUT the venue (including protests targeting events the venue hosts)
- Drone sightings, perimeter incidents, unauthorized access reports
- Ticket fraud, scalping, accreditation fraud tied to the venue
- Crowd-control incidents, transit disruption around the venue, evacuation chatter
- Direct threats or security incidents involving the venue
- Posts from or referencing the venue's official channels (e.g. official account announcements, scheduled events)
- Content about events scheduled at the venue (concerts, matches, tournaments) that could draw security-relevant attention
- Is undated but otherwise specific and on-topic (DEFAULT ACCEPT)

A result is NOT relevant if:
- Unrelated topic that matches a keyword incidentally
- Generic platform homepage for an unrelated account
- Entertainment / marketing with no security angle (e.g. ticket sale promotions with no fraud component)
- Spam, auto-generated content
- Explicit date older than 180 days
- Wikipedia / archived historical content

${COMMON_OUTPUT_RULE}`,
  },

  // ─────────────────────────────────────────────────────────────────
  // CELEBRITY VIP — public figures, performers, athletes (Trent Reznor).
  // Threat surface: stalking, doxxing, harassment, impersonation,
  // schedule leaks, fan threats.
  // ─────────────────────────────────────────────────────────────────
  celebrity_vip: {
    threat_vocab: 'stalking OR harass OR dox OR doxxed OR "home address" OR threat OR impersonation OR "personal safety"',
    ai_system_prompt: (sourceName) => `You are an intelligence analyst filtering social media search results for security monitoring of "${sourceName}" — a celebrity / public figure / VIP requiring personal-security protection.

${COMMON_TEMPORAL_RULE}

A result is RELEVANT if ANY of:
- Stalking, harassment, doxxing, threats, or hostile fan behavior directed at the subject
- Disclosure of home address, family details, travel plans, or schedule
- Impersonation accounts, identity fraud, or accounts misrepresenting the subject
- Coordinated harassment campaigns or organized hostile attention
- Direct threats of violence or coercion against the subject
- Posts from the subject's own official channels (announcements, location disclosures, schedule)
- Mentions of physical sightings or fan encounters in operationally relevant contexts (venue, residence area, transit)
- Is undated but otherwise specific and on-topic (DEFAULT ACCEPT)

A result is NOT relevant if:
- Generic celebrity news / entertainment coverage without a security angle
- Music/film reviews, fan praise posts, merchandise
- Wikipedia / archived biographical content
- Unrelated person with the same name
- Spam, auto-generated content
- Explicit date older than 180 days

${COMMON_OUTPUT_RULE}`,
  },

  // ─────────────────────────────────────────────────────────────────
  // TOURNAMENT EVENT — multi-day events (FIFA Vancouver 2026).
  // Threat surface: protests, accreditation fraud, ticket fraud,
  // transit disruption, organized opposition, crowd control.
  // ─────────────────────────────────────────────────────────────────
  tournament_event: {
    threat_vocab: 'protest OR "accreditation fraud" OR "ticket fraud" OR "transit disruption" OR threat OR demonstration OR boycott OR security',
    ai_system_prompt: (sourceName) => `You are an intelligence analyst filtering social media search results for security monitoring of "${sourceName}" — a multi-day organized event (tournament, conference, festival).

${COMMON_TEMPORAL_RULE}

A result is RELEVANT if ANY of:
- Protests, demonstrations, boycotts, or organized opposition targeting the event or its sponsors
- Accreditation fraud, ticket fraud, identity fraud tied to the event
- Transit disruption, road closures, ride-share saturation, hotel issues impacting attendees
- Direct threats or security incidents against the event, venues, or officials
- Posts from the event's official channels (schedules, accreditation announcements, venue changes)
- Activist mobilization OUTSIDE the event venues that targets the event (e.g. protests at adjacent conference centers)
- Mentions of crowd-control incidents or coordinated disruption plans
- Is undated but otherwise specific and on-topic (DEFAULT ACCEPT)

A result is NOT relevant if:
- General sports/event commentary without a security angle (e.g. match predictions, fan reactions)
- Ticket sale promotions with no fraud component
- Wikipedia / archived historical content
- Unrelated event with the same name
- Spam, auto-generated content
- Explicit date older than 180 days

${COMMON_OUTPUT_RULE}`,
  },

  // ─────────────────────────────────────────────────────────────────
  // EXECUTIVE — named principals (CEOs, board members, key staff).
  // Threat surface: doxxing, harassment, impersonation, threats,
  // schedule leaks. Similar to celebrity_vip but corporate framing.
  // ─────────────────────────────────────────────────────────────────
  executive: {
    threat_vocab: 'dox OR doxxed OR threat OR harass OR "home address" OR impersonation OR "schedule leak" OR stalking',
    ai_system_prompt: (sourceName) => `You are an intelligence analyst filtering social media search results for security monitoring of "${sourceName}" — a named executive / principal requiring personal-security protection.

${COMMON_TEMPORAL_RULE}

A result is RELEVANT if ANY of:
- Doxxing, harassment, threats, or hostile attention directed at the executive
- Disclosure of home address, family details, travel plans, or schedule
- Impersonation accounts or identity fraud
- Coordinated hostile campaigns against the executive or their employer
- Direct threats of violence, coercion, or activism targeting the executive personally
- Posts from the executive's own official channels (statements, public schedule)
- References to the executive in protest/activism contexts (e.g. named target of a campaign)
- Is undated but otherwise specific and on-topic (DEFAULT ACCEPT)

A result is NOT relevant if:
- Routine corporate news (earnings, appointments, conferences) without a security angle
- Generic LinkedIn / professional networking content
- Wikipedia / archived biographical content
- Unrelated person with the same name
- Spam, auto-generated content
- Explicit date older than 180 days

${COMMON_OUTPUT_RULE}`,
  },

  // ─────────────────────────────────────────────────────────────────
  // CORPORATE — general companies (non-energy, non-infrastructure).
  // Threat surface: activist campaigns, boycotts, breach disclosures,
  // litigation, regulatory action.
  // ─────────────────────────────────────────────────────────────────
  corporate: {
    threat_vocab: 'protest OR breach OR boycott OR sabotage OR activist OR lawsuit OR investigation OR threat',
    ai_system_prompt: (sourceName) => `You are an intelligence analyst filtering social media search results for security monitoring of "${sourceName}" — a corporate entity.

${COMMON_TEMPORAL_RULE}

A result is RELEVANT if ANY of:
- Activist campaigns, boycotts, organized opposition targeting the company
- Security breaches, data exposures, cyber incidents involving the company
- Litigation, regulatory action, investigations that surface security implications
- Protests at corporate locations or events
- Direct threats against the company, executives, or facilities
- Posts from the company's own official channels (statements, incident disclosures)
- Whistleblower content or insider disclosures
- Is undated but otherwise specific and on-topic (DEFAULT ACCEPT)

A result is NOT relevant if:
- Routine business news (earnings, product launches, M&A) without a security angle
- Marketing content, sponsored posts, generic press releases
- Unrelated company with similar name
- Spam, auto-generated content
- Explicit date older than 180 days

${COMMON_OUTPUT_RULE}`,
  },

  // ─────────────────────────────────────────────────────────────────
  // CRITICAL INFRASTRUCTURE — utilities, water, grid, telecom, transit.
  // Threat surface: sabotage, attack, outage chatter, organized
  // opposition to infrastructure projects, physical breach.
  // ─────────────────────────────────────────────────────────────────
  critical_infrastructure: {
    threat_vocab: 'sabotage OR attack OR breach OR protest OR blockade OR outage OR "security incident" OR threat',
    ai_system_prompt: (sourceName) => `You are an intelligence analyst filtering social media search results for security monitoring of "${sourceName}" — a critical-infrastructure operator (utility, water, grid, telecom, transit).

${COMMON_TEMPORAL_RULE}

A result is RELEVANT if ANY of:
- Sabotage, physical attacks, deliberate outages, or coordinated disruption attempts
- Protests, blockades, organized opposition targeting infrastructure or its projects
- Cyber incidents, security breaches, or outage chatter relevant to operations
- Direct threats against personnel, facilities, or operations
- Posts from the operator's own official channels (incident reports, public advisories)
- References to the infrastructure in activism / protest contexts
- Is undated but otherwise specific and on-topic (DEFAULT ACCEPT)

A result is NOT relevant if:
- Routine operational updates without a security angle
- Generic utility marketing or customer service posts
- Unrelated infrastructure project with similar name
- Spam, auto-generated content
- Explicit date older than 180 days

${COMMON_OUTPUT_RULE}`,
  },
};

/**
 * Resolve the archetype for a client. Reads `monitoring_config.archetype`
 * JSONB field. Falls back to 'energy_infrastructure' on missing/unknown
 * so existing clients without an archetype set continue to work
 * with the original Petronas-era behavior.
 *
 * Logs a warning when the configured archetype is unknown so operators
 * can catch typos in the JSONB without silent fallthrough.
 */
export function resolveArchetype(monitoring_config: any): Archetype {
  const raw = (monitoring_config && typeof monitoring_config === 'object')
    ? (monitoring_config.archetype as string | undefined)
    : undefined;
  if (!raw) return 'energy_infrastructure';
  if ((ARCHETYPE_LIST as readonly string[]).includes(raw)) {
    return raw as Archetype;
  }
  console.warn(`[archetypes] Unknown archetype "${raw}" — falling back to energy_infrastructure. Set monitoring_config.archetype to one of: ${ARCHETYPE_LIST.join(', ')}`);
  return 'energy_infrastructure';
}

/**
 * Returns the OR-joined threat-vocab string for a client. Honors
 * `monitoring_config.threat_vocab_override` if set (operator-set string).
 * Otherwise returns the archetype default.
 */
export function getClientThreatVocab(monitoring_config: any): string {
  const override = (monitoring_config && typeof monitoring_config === 'object')
    ? (monitoring_config.threat_vocab_override as string | undefined)
    : undefined;
  if (override && override.trim().length > 0) return override.trim();
  return ARCHETYPE_DEFS[resolveArchetype(monitoring_config)].threat_vocab;
}

/**
 * Returns the archetype-keyed AI system prompt with `${sourceName}`
 * interpolated. Caller-supplied — does not depend on monitoring_config
 * directly, so the caller passes whatever name should appear in the
 * prompt (typically client.name).
 */
export function getClientAiSystemPrompt(monitoring_config: any, sourceName: string): string {
  return ARCHETYPE_DEFS[resolveArchetype(monitoring_config)].ai_system_prompt(sourceName);
}

/**
 * Heuristic: does this profile URL appear to belong to the protected
 * client/entity? Used by the social monitor's generic-profile filter
 * so e.g. https://x.com/bcplace is recognized as BC Place's own
 * channel rather than killed as a generic profile page.
 *
 * Match rule:
 *   - Extract the handle segment from the URL
 *   - Normalize (lowercase, strip non-alphanumeric)
 *   - Accept if the normalized handle equals OR is contained in OR
 *     contains the normalized sourceName (also normalized to remove
 *     spaces/punctuation)
 *
 * Tuned to be permissive — better to admit a few false positives than
 * to drop the venue/VIP/event's official channel. The downstream AI
 * gate is the final relevance check.
 */
export function isOwnedProfileFor(url: string, sourceName: string): boolean {
  if (!url || !sourceName) return false;

  // Extract the first path segment after the host (the handle for
  // x.com / facebook.com / instagram.com URLs of the form /handle).
  // Bail out if the URL has additional path segments — those are
  // already specific posts and would have passed the isSpecific*Url
  // check before reaching this helper.
  let handle = '';
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return false;
    handle = parts[0];
    // Instagram URLs use /p/ or /reel/ for specific posts — those
    // wouldn't reach this filter anyway. /handle/ for profile.
  } catch {
    return false;
  }

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const h = normalize(handle);
  const n = normalize(sourceName);
  if (!h || !n) return false;
  return h === n || h.includes(n) || n.includes(h);
}

/**
 * Fixture / synthetic client filter. Production monitoring loops
 * should skip clients whose names start with underscore — these are
 * benchmark / QA / invariant-test fixtures (e.g. `_qa_cipher_test_env`,
 * `_benchmark_petronas`, `_audit_test_client_B`). Wasted CSE budget if
 * scanned. Same convention as the snapshot exports in RiskSnapshotExport.
 */
export function isFixtureClient(clientName: string | null | undefined): boolean {
  return typeof clientName === 'string' && clientName.startsWith('_');
}
