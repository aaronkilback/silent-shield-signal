import { createClient } from "npm:@supabase/supabase-js@2";
import { callAiGateway, callAiGatewayJson } from "../_shared/ai-gateway.ts";
import { logError } from "../_shared/error-logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Interface for evidence source tracking
interface EvidenceSource {
  claim: string;
  sourceType: string;
  sourceId: string;
  sourceTitle: string;
  sourceUrl?: string;
  internalUrl: string;
  timestamp: string;
  confidence?: number;
}

// Interface for action items with ownership
interface ActionItem {
  description: string;
  ownerId?: string;
  ownerName?: string;
  ownerRole: string;
  deadline: string;
  firstUpdateDue: string;
  priority: string;
  relatedIncidentId?: string;
  relatedSignalId?: string;
}

// Interface for impact ladder
interface ImpactLadder {
  issue: string;
  worstConsequence: string;
  earliestIndicator: string;
  mitigation: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { client_id, period_days = 7 } = await req.json();
    
    console.log(`Generating enhanced executive report for client ${client_id}, ${period_days} days`);

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL DATE CONTEXT - Used throughout report generation
    // ═══════════════════════════════════════════════════════════════════════════
    const reportGeneratedAt = new Date();
    const currentDateISO = reportGeneratedAt.toISOString().split('T')[0];
    const currentDateTimeISO = reportGeneratedAt.toISOString();
    
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - period_days);
    const periodEnd = new Date();
    
    // Define stale threshold: incidents older than 7 days are considered stale
    const staleThresholdMs = 7 * 24 * 60 * 60 * 1000;
    const last24hThreshold = new Date(reportGeneratedAt.getTime() - 24 * 60 * 60 * 1000);
    
    console.log(`CRITICAL DATE CONTEXT: Report generated at ${currentDateTimeISO}, period ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

    // Fetch client details
    const { data: client, error: clientError } = await supabaseClient
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError) throw clientError;

    // Fetch signals with full details for traceability
    const { data: signals, error: signalsError } = await supabaseClient
      .from('signals')
      .select('*')
      .eq('client_id', client_id)
      .gte('received_at', periodStart.toISOString())
      .lte('received_at', periodEnd.toISOString())
      .order('received_at', { ascending: false });

    if (signalsError) throw signalsError;

    // Apply staleness filter: signals older than 14 days only if critical AND directly PECL-relevant
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const freshSignals = signals?.filter(s => {
      const signalDate = new Date(s.created_at || s.event_date || 0);
      const isRecent = signalDate >= new Date(fourteenDaysAgo);
      if (isRecent) return true;
      const text = (s.normalized_text || '').toLowerCase();
      const isPECLRelevant =
        text.includes('petronas') ||
        text.includes('pecl') ||
        text.includes('lng canada') ||
        text.includes('coastal gaslink');
      return s.severity === 'critical' && isPECLRelevant;
    }) ?? [];

    // Fetch incidents with classification rationale
    const { data: incidents, error: incidentsError } = await supabaseClient
      .from('incidents')
      .select(`
        *,
        incident_classification_rationale (
          classification,
          system_of_origin,
          rationale,
          classified_at
        )
      `)
      .eq('client_id', client_id)
      .gte('opened_at', periodStart.toISOString())
      .lte('opened_at', periodEnd.toISOString())
      .order('opened_at', { ascending: false });

    if (incidentsError) throw incidentsError;

    // Fetch tone transformation rules
    const { data: toneRules } = await supabase
      .from('executive_tone_rules')
      .select('original_phrase, replacement_phrase')
      .eq('is_active', true);

    // Fetch team members for ownership suggestions
    const { data: teamMembers } = await supabase
      .from('profiles')
      .select('id, name')
      .limit(50);

    // Fetch user roles for ownership matching
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('user_id, role');

    // Build team map with roles
    const teamMap = new Map<string, { id: string; name: string; roles: string[] }>();
    teamMembers?.forEach(member => {
      const roles = userRoles?.filter(ur => ur.user_id === member.id).map(ur => ur.role) || [];
      teamMap.set(member.id, { id: member.id, name: member.name, roles });
    });

    // Apply tone transformation function
    function applyToneTransformation(text: string): string {
      if (!text || !toneRules?.length) return text;
      let result = text;
      for (const rule of toneRules) {
        const regex = new RegExp(rule.original_phrase, 'gi');
        result = result.replace(regex, rule.replacement_phrase);
      }
      return result;
    }

    // Filter out junk signals before any analysis
    const EXCLUDE_CATEGORIES = new Set(['weather', 'test', 'work_interruption', 'advisory', 'health_concern', 'system_alert']);
    const HIGH_VALUE_CATEGORIES = new Set(['active_threat', 'cybersecurity', 'insider_threat', 'protest', 'regulatory', 'operational']);

    const reportableSignals = (signals || []).filter((s: any) => {
      if (EXCLUDE_CATEGORIES.has(s.category)) return false;
      if (HIGH_VALUE_CATEGORIES.has(s.category) && s.severity === 'low') return false;
      return true;
    });

    function getHostname(url: string | null | undefined): string {
      if (!url) return 'Fortress Intelligence';
      try { return new URL(url).hostname; } catch { return url; }
    }

    // Group signals by category and severity
    const signalsByCategory = reportableSignals.reduce((acc: any, s: any) => {
      const cat = s.category || 'uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(s);
      return acc;
    }, {});

    const criticalSignals = reportableSignals.filter((s: any) => s.severity === 'critical');
    const highSignals = reportableSignals.filter((s: any) => s.severity === 'high');
    const p1p2Incidents = incidents?.filter(i => i.priority === 'p1' || i.priority === 'p2') || [];
    
    // ═══════════════════════════════════════════════════════════════════════════
    // FIX: Unknown incident classification using REAL fields (not non-existent category column)
    // An incident is "unknown/unclassified" if:
    // 1. incident_type is null/empty/unknown, OR
    // 2. No linked signal (signal_id is null), OR
    // 3. Title contains generic "unknown"/"unidentified" patterns
    // ═══════════════════════════════════════════════════════════════════════════
    const unknownTitlePatterns = /unknown|unidentified|unclassified|anomal|unusual activity/i;
    const unknownIncidents = p1p2Incidents.filter(i => {
      const hasUnknownType = !i.incident_type || i.incident_type.toLowerCase() === 'unknown';
      const hasNoSignal = !i.signal_id;
      const hasUnknownTitle = unknownTitlePatterns.test(i.title || '');
      return hasUnknownType || hasNoSignal || hasUnknownTitle;
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // FIX: Separate NEW vs STALE incidents to prevent misleading "cluster" claims
    // ═══════════════════════════════════════════════════════════════════════════
    const newIncidentsLast24h = p1p2Incidents.filter(i => {
      const openedAt = new Date(i.opened_at || i.created_at);
      return openedAt >= last24hThreshold;
    });
    
    const staleOpenIncidents = p1p2Incidents.filter(i => {
      const openedAt = new Date(i.opened_at || i.created_at);
      const ageMs = reportGeneratedAt.getTime() - openedAt.getTime();
      return ageMs > staleThresholdMs;
    });
    
    // Calculate age metadata for each incident
    const incidentsWithAge = p1p2Incidents.map(i => {
      const openedAt = new Date(i.opened_at || i.created_at);
      const ageMs = reportGeneratedAt.getTime() - openedAt.getTime();
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const isStale = ageMs > staleThresholdMs;
      const isNew = openedAt >= last24hThreshold;
      return { ...i, ageDays, isStale, isNew, openedAtFormatted: openedAt.toISOString().split('T')[0] };
    });
    
    console.log(`Incident breakdown: ${p1p2Incidents.length} total P1/P2, ${newIncidentsLast24h.length} new (last 24h), ${staleOpenIncidents.length} stale (>7 days), ${unknownIncidents.length} unknown/unclassified`);

    // Calculate risk ratings
    const surveillanceRisk = freshSignals.filter(s =>
      s.category?.toLowerCase().includes('surveillance') ||
      s.normalized_text?.toLowerCase().includes('reconnaissance')
    ).length;

    const protestRisk = freshSignals.filter(s =>
      s.category?.toLowerCase().includes('protest') ||
      s.category?.toLowerCase().includes('activism') ||
      s.normalized_text?.toLowerCase().includes('rally')
    ).length;

    const sabotageThreat = freshSignals.filter(s =>
      s.category?.toLowerCase().includes('sabotage') ||
      s.category?.toLowerCase().includes('vandalism') ||
      s.severity === 'critical'
    ).length;

    function getRiskLevel(count: number): string {
      if (count >= 5) return 'HIGH';
      if (count >= 3) return 'ELEVATED';
      if (count >= 1) return 'MODERATE';
      return 'LOW';
    }

    const overallRiskLevel = getRiskLevel(
      Math.max(surveillanceRisk, protestRisk, sabotageThreat, criticalSignals.length)
    );

    // Build evidence sources array for traceability
    const evidenceSources: EvidenceSource[] = [];
    const appBaseUrl = Deno.env.get('APP_URL') || 'https://fortress.silentshieldsecurity.com';

    // Add signal evidence
    freshSignals.slice(0, 20).forEach(signal => {
      evidenceSources.push({
        claim: signal.normalized_text?.substring(0, 100) || 'Signal detected',
        sourceType: 'signal',
        sourceId: signal.id,
        sourceTitle: `${signal.category || 'Signal'} - ${signal.severity}`,
        sourceUrl: signal.source_url || undefined,
        internalUrl: `/signals?id=${signal.id}`,
        timestamp: signal.received_at,
        confidence: signal.confidence_score
      });
    });

    // Add incident evidence
    incidents?.forEach(incident => {
      const rationale = incident.incident_classification_rationale?.[0];
      evidenceSources.push({
        claim: `${incident.priority?.toUpperCase()} Incident: ${incident.category || 'Unknown'}`,
        sourceType: rationale?.system_of_origin || 'incident',
        sourceId: incident.id,
        sourceTitle: `Incident ${incident.id.substring(0, 8)}`,
        internalUrl: `/incidents?id=${incident.id}`,
        timestamp: incident.opened_at,
        confidence: undefined
      });
    });

    // Generate 1-Line Executive Call-to-Action with AI
    // ═══════════════════════════════════════════════════════════════════════════
    // CRITICAL DATE CONTEXT injected into AI prompts to prevent hallucination
    // ═══════════════════════════════════════════════════════════════════════════
    const criticalDateContext = `
═══════════════════════════════════════════════════════════════════════════════
CRITICAL DATE CONTEXT (MANDATORY - DO NOT DEVIATE):
- Report Generated: ${currentDateTimeISO}
- Today's Date: ${currentDateISO}
- Reporting Period: ${periodStart.toDateString()} to ${periodEnd.toDateString()}

ABSOLUTE DATE ACCURACY RULES:
1. NEVER claim incidents "appeared" or "emerged" on dates other than their actual opened_at dates
2. NEVER fabricate clusters or groups that don't exist in the data
3. Report EXACT counts from data - do not round, estimate, or hallucinate numbers
4. Distinguish clearly between NEW incidents (opened in last 24h) and STALE incidents (>7 days old)
5. If an incident opened in November 2025, report it as from November 2025, NOT as a new threat
═══════════════════════════════════════════════════════════════════════════════`;

    const flashPrompt = `You are a senior security advisor providing a flash briefing for C-level executives at ${client.name}.
${criticalDateContext}

VERIFIED INTELLIGENCE DATA (use ONLY these numbers):
- ${criticalSignals.length} critical severity signals
- ${highSignals.length} high severity signals
- ${p1p2Incidents.length} TOTAL P1/P2 priority incidents
- ${newIncidentsLast24h.length} NEW incidents (opened in last 24 hours)
- ${staleOpenIncidents.length} STALE open incidents (opened >7 days ago, still open)
- ${unknownIncidents.length} unknown/unclassified incidents (need triage)
- Overall risk level: ${overallRiskLevel}
- Key categories: ${Object.keys(signalsByCategory).slice(0, 5).join(', ')}

${newIncidentsLast24h.length > 0 ? `NEW INCIDENTS (last 24h):\n${newIncidentsLast24h.map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]}`).join('\n')}` : 'NO new incidents in the last 24 hours.'}

${staleOpenIncidents.length > 0 ? `STALE OPEN INCIDENTS (>7 days old, require review):\n${staleOpenIncidents.slice(0, 3).map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]}`).join('\n')}` : ''}

Top 3 signals:
${criticalSignals.slice(0, 3).map((s, i) => `${i + 1}. [${s.category}] ${s.normalized_text?.substring(0, 150)}`).join('\n')}

Provide a JSON response with exactly this structure:
{
  "mostPressingIssue": "One sentence describing the single most critical issue requiring attention — name specific individuals in CAPITALS if relevant. Do not use database field names or underscores — write in plain English.",
  "confidence": "High|Medium|Low",
  "recommendedAction": "One specific, actionable recommendation with a named owner role and timeframe",
  "ownerSuggestion": "Security Operations|Physical Security|Cyber Security|Intelligence|Executive Team",
  "deadlineUrgency": "Immediate|24 hours|48 hours|This week",
  "trajectory": "ESCALATING|STABLE|DE-ESCALATING",
  "trajectoryReason": "One sentence explaining the direction of risk vs the previous reporting period"
}

Be specific, cite EXACT data from above, and use executive-appropriate language. DO NOT claim clusters or groups that don't exist in the data.`;

    console.log('Generating executive flash banner...');
    let executiveFlash = {
      mostPressingIssue: 'Intelligence analysis in progress',
      confidence: 'Medium',
      recommendedAction: 'Review detailed findings below',
      ownerSuggestion: 'Security Operations',
      deadlineUrgency: '48 hours'
    };

    const flashResult = await callAiGatewayJson({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a security intelligence advisor. Always respond with valid JSON only, no markdown.' },
        { role: 'user', content: flashPrompt }
      ],
      functionName: 'generate-executive-report',
    });
    if (flashResult.data) executiveFlash = flashResult.data;

    // Generate Impact Ladders for top issues
    const impactPrompt = `As a security strategist, create impact ladders for the top 3 threats facing ${client.name}.

Current threat landscape:
${criticalSignals.slice(0, 5).map((s, i) => `${i + 1}. ${s.category}: ${s.normalized_text?.substring(0, 200)}`).join('\n')}

For each major threat, provide a JSON array with this structure:
[
  {
    "issue": "Brief description of the threat",
    "worstConsequence": "If true, worst credible consequence is...",
    "earliestIndicator": "The earliest indicator would be...",
    "mitigation": "Primary mitigation is..."
  }
]

Provide exactly 3 impact ladders. Be specific and actionable. Use executive language.`;

    console.log('Generating impact ladders...');
    let impactLadders: ImpactLadder[] = [];
    const impactResult = await callAiGatewayJson<ImpactLadder[]>({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a strategic security advisor. Always respond with valid JSON only.' },
        { role: 'user', content: impactPrompt }
      ],
      functionName: 'generate-executive-report',
    });
    if (impactResult.data) impactLadders = impactResult.data;

    // Generate executive summary with tone transformation
    const summaryPrompt = `You are a security intelligence analyst creating an executive summary for ${client.name}.
${criticalDateContext}

Client Context:
- Organization: ${client.organization || client.name}
- Industry: ${client.industry || 'N/A'}
- Locations: ${client.locations?.join(', ') || 'N/A'}
- High-Value Assets: ${client.high_value_assets?.join(', ') || 'N/A'}

VERIFIED INTELLIGENCE DATA (use ONLY these numbers):
- Total signals collected: ${freshSignals.length}
- Critical severity signals: ${criticalSignals.length}
- High severity signals: ${highSignals.length}
- TOTAL P1/P2 Incidents: ${p1p2Incidents.length}
- NEW incidents (last 24h): ${newIncidentsLast24h.length}
- STALE open incidents (>7 days old): ${staleOpenIncidents.length}
- Unknown/unclassified incidents: ${unknownIncidents.length}
- Open incidents total: ${incidents?.filter(i => i.status === 'open').length || 0}

${newIncidentsLast24h.length > 0 ? `NEW INCIDENTS (last 24h) - THESE ARE THE CURRENT THREATS:\n${newIncidentsLast24h.map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]}`).join('\n')}` : 'NO new P1/P2 incidents in the last 24 hours. Focus on signal intelligence and stale incident review.'}

${staleOpenIncidents.length > 0 ? `STALE OPEN INCIDENTS (opened >7 days ago, still unresolved):\n${staleOpenIncidents.map((i, idx) => `${idx + 1}. [${i.priority?.toUpperCase()}] ${i.title} - Opened: ${new Date(i.opened_at).toISOString().split('T')[0]} (${Math.floor((reportGeneratedAt.getTime() - new Date(i.opened_at).getTime()) / (24*60*60*1000))} days old)`).join('\n')}` : ''}

Top 5 Signals:
${freshSignals.slice(0, 5).map((s, i) => `${i + 1}. [${s.severity}] ${s.category}: ${s.normalized_text?.substring(0, 200)}`).join('\n')}

Write a professional 2-3 paragraph executive summary that:
1. Opens with a BLUF (Bottom Line Up Front) — one sentence stating the single most important thing the executive needs to know right now
2. Names all key individuals using SURNAME in CAPITALS following intelligence tradecraft convention (e.g., activist organizer Richard BROOKS, journalist Danny NUNES, Dr. Ulrike MEYER)
3. Clearly distinguishes between new threats (last 24h) and stale open incidents — never present stale incidents as current threats
4. States the threat trajectory explicitly: is overall risk ESCALATING, STABLE, or DE-ESCALATING compared to the previous reporting period, and why
5. Reports EXACT counts from verified data only — never round or estimate
6. Closes with one specific sentence on what ${client.name} leadership should prioritize in the next 24 hours

CRITICAL: Do NOT claim incidents "appeared" or "emerged" on dates other than their actual opened_at dates. Do NOT fabricate clusters or groups.

OUTPUT FORMAT RULES: Plain prose only. No markdown. No asterisks. No hash symbols. No bullet points using asterisks. No bold formatting. Write in complete sentences.`;

    console.log('Generating executive summary...');
    let executiveSummary = 'Analysis in progress...';
    const summaryResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a professional security intelligence analyst writing for C-level executives. Use formal, business-appropriate language.' },
        { role: 'user', content: summaryPrompt }
      ],
      functionName: 'generate-executive-report',
    });
    if (summaryResult.content) executiveSummary = applyToneTransformation(summaryResult.content);

    // Generate action items with ownership suggestions
    const actionsPrompt = `As a security operations advisor, create 3-5 actionable recommendations for ${client.name}.

Current situation:
- ${criticalSignals.length} critical signals requiring attention
- ${p1p2Incidents.length} P1/P2 incidents
- Overall risk: ${overallRiskLevel}

Available team roles: Security Operations, Physical Security Lead, Cyber Security Lead, Intelligence Analyst, Executive Team, Legal/Compliance

For each recommendation, provide JSON:
[
  {
    "description": "Specific action to take",
    "ownerRole": "Most appropriate team role",
    "priority": "critical|high|medium",
    "deadlineDays": 1|3|7|14,
    "firstUpdateDays": 1|2|3
  }
]

Be specific and actionable. Max 5 items.`;

    console.log('Generating action items...');
    let actionItems: ActionItem[] = [];
    const actionsResult = await callAiGatewayJson({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a security operations advisor. Always respond with valid JSON only.' },
        { role: 'user', content: actionsPrompt }
      ],
      functionName: 'generate-executive-report',
    });

    if (actionsResult.data) {
      try {
        const rawActions = actionsResult.data;
        const now = new Date();
        actionItems = rawActions.map((a: any) => {
          const deadline = new Date(now);
          deadline.setDate(deadline.getDate() + (a.deadlineDays || 7));
          const firstUpdate = new Date(now);
          firstUpdate.setDate(firstUpdate.getDate() + (a.firstUpdateDays || 2));
          
          // Try to find a matching team member
          let ownerName = a.ownerRole;
          let ownerId: string | undefined;
          for (const [id, member] of teamMap) {
            if (member.roles.some(r => a.ownerRole.toLowerCase().includes(r))) {
              ownerId = id;
              ownerName = member.name;
              break;
            }
          }

          return {
            description: a.description,
            ownerId,
            ownerName,
            ownerRole: a.ownerRole,
            deadline: deadline.toISOString(),
            firstUpdateDue: firstUpdate.toISOString(),
            priority: a.priority || 'medium'
          };
        });
      } catch (e) {
        console.error('Error parsing actions response:', e);
      }
    }

    // Generate deductions with tone transformation
    const deductionsPrompt = `You are a senior intelligence analyst writing strategic deductions for ${client.name} leadership. You write in the style of a professional government intelligence analyst — precise, direct, and specific.

MANDATORY TRADECRAFT RULES:
- Write ALL surnames of named individuals in CAPITALS (e.g., activist BROOKS, journalist NUNES, professor ANTWEILER)
- Label every analytical conclusion with DEDUCTIONS: as a plain text label — no bold, no asterisks, no hash symbols
- Do not use markdown formatting — no **bold**, no ### headers, no asterisks anywhere in the output
- Every deduction must end with a specific implication for ${client.name} — not generic industry risk
- State trajectory for each threat thread: ESCALATING / STABLE / DE-ESCALATING with one sentence of evidence
- Maximum 3 deduction paragraphs — quality and specificity over volume
- Never use vague language like "may pose risks" — state the specific risk clearly

Threat signals to analyze:
${[...criticalSignals, ...highSignals].slice(0, 10).map((s, i) =>
  `${i + 1}. ${s.category}: ${s.normalized_text}`
).join('\n')}

For each major threat thread write one deduction paragraph in this format:
DEDUCTIONS: [2-3 sentences connecting the signals to a specific implication for ${client.name}. Name threat actors in CAPITALS. State whether this thread is ESCALATING, STABLE, or DE-ESCALATING with one piece of evidence. End with one specific recommended action for ${client.name} with an owner role and timeframe.]

Use professional executive language. Be direct. Avoid hedging.

OUTPUT FORMAT RULES: Plain prose only. No markdown. No asterisks. No hash symbols. No bullet points using asterisks. No bold formatting. Write in complete sentences.`;

    console.log('Generating strategic deductions...');
    let deductions = 'Analysis in progress...';
    const deductionsResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a strategic security analyst providing executive-level threat assessment.' },
        { role: 'user', content: deductionsPrompt }
      ],
      functionName: 'generate-executive-report',
    });
    if (deductionsResult.content) deductions = applyToneTransformation(deductionsResult.content);

    const categoryDisplayNames: Record<string, string> = {
      'active_threat': 'Active Threat',
      'social_sentiment': 'Social Sentiment',
      'work_interruption': 'Work Interruption',
      'cyber': 'Cyber Security',
      'cybersecurity': 'Cyber Security',
      'civil_emergency': 'Civil Emergency',
      'insider_threat': 'Insider Threat',
      'active_shooter': 'Active Shooter',
      'protest': 'Protest Activity',
      'surveillance': 'Surveillance',
      'sabotage': 'Sabotage',
      'vandalism': 'Vandalism',
      'uncategorized': 'General Intelligence',
    };
    const getCategoryDisplay = (cat: string) =>
      categoryDisplayNames[cat] || cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Generate detailed narratives — top 3 categories by weighted score (critical×4, high×2, medium×1), min score 3
    const weightedCategories = Object.entries(signalsByCategory)
      .map(([category, categorySignals]: [string, any]) => {
        const score = (categorySignals as any[]).filter((s: any) => s.severity !== 'low').reduce((sum: number, s: any) => {
          if (s.severity === 'critical') return sum + 4;
          if (s.severity === 'high') return sum + 2;
          return sum + 1;
        }, 0);
        return { category, categorySignals, score };
      })
      .filter(({ score }) => score >= 3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const narrativesPromises = weightedCategories.map(async ({ category, categorySignals }) => {
        const topSignals = (categorySignals as any[]).slice(0, 5);

        const narrativePrompt = `Write a professional intelligence narrative about ${category} threats for ${client.name}.

MANDATORY TRADECRAFT RULES:
- Write ALL surnames of named individuals in CAPITALS (e.g., organizer Richard BROOKS, journalist Danny NUNES)
- Include exact dates for all cited events — never use vague references like "recently"
- State the trajectory for this threat category: ESCALATING, STABLE, or DE-ESCALATING vs last period
- End with a DEDUCTIONS: paragraph that connects this category specifically to ${client.name} operations, reputation, or personnel
- Include one RECOMMENDED ACTION with a specific owner role and timeframe
- If no significant activity occurred in this category during the reporting period, state clearly: "No significant ${category} activity detected in the reporting period." Do not pad with generic content.

Signals to analyze:
${topSignals.map((s: any, i: number) => `${i + 1}. [${s.severity?.toUpperCase()}] ${s.normalized_text} (Source: ${getHostname(s.source_url)}, ${new Date(s.received_at).toLocaleDateString('en-US', {year: 'numeric', month: 'long', day: 'numeric'})})`).join('\n')}

Write 2-3 paragraphs of narrative followed by a DEDUCTIONS: paragraph. Use executive-appropriate language. Be specific about names, dates, organizations, and implications for ${client.name}.

OUTPUT FORMAT RULES: Plain prose only. No markdown. No asterisks. No hash symbols. No bullet points using asterisks. No bold formatting. Write in complete sentences.`;

        const narrativeResult = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an intelligence analyst writing for executives.' },
            { role: 'user', content: narrativePrompt }
          ],
          functionName: 'generate-executive-report',
        });

        return {
          category,
          narrative: applyToneTransformation(narrativeResult.content || 'Analysis unavailable'),
          signals: topSignals
        };
      });

    console.log('Generating detailed narratives...');

    const threatCategories = Object.keys(signalsByCategory);

    const narratives = await Promise.all(narrativesPromises);

    // Format dates
    const reportDate = new Date().toLocaleDateString('en-US', { 
      year: 'numeric', month: 'short', day: 'numeric' 
    });

    // Generate HTML report with all enhancements
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Executive Intelligence Brief - ${client.name}</title>
  <style>
    @page { margin: 0.75in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Arial', 'Helvetica', sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #1a1a1a;
      background: white;
      max-width: 900px;
      margin: 0 auto;
    }

    .header {
      border-bottom: 3px solid #7c3aed;
      padding-bottom: 12pt;
      margin-bottom: 16pt;
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 12pt;
    }

    .classification {
      background: #7c3aed;
      color: white;
      padding: 6pt 12pt;
      font-weight: 700;
      font-size: 9pt;
      letter-spacing: 1px;
    }

    .report-date { font-size: 10pt; color: #666; font-weight: 600; }
    .logo-area { text-align: center; margin-bottom: 6pt; }
    .company-name { font-size: 20pt; font-weight: 700; color: #7c3aed; margin-bottom: 4pt; }
    .report-title { font-size: 14pt; color: #333; font-weight: 600; }

    /* EXECUTIVE FLASH BANNER */
    .executive-flash {
      background: #1B2A4A;
      color: white;
      padding: 20pt;
      margin: 16pt 0;
      border-radius: 6pt;
    }

    .flash-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12pt;
      border-bottom: 1px solid rgba(255,255,255,0.3);
      padding-bottom: 8pt;
    }

    .flash-title {
      font-size: 11pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5pt;
    }

    .flash-confidence {
      background: rgba(255,255,255,0.2);
      padding: 4pt 10pt;
      border-radius: 3pt;
      font-size: 9pt;
      font-weight: 600;
    }

    .flash-issue {
      font-size: 14pt;
      font-weight: 700;
      margin-bottom: 12pt;
      line-height: 1.4;
    }

    .flash-action {
      background: rgba(255,255,255,0.15);
      padding: 12pt;
      border-radius: 4pt;
      margin-bottom: 10pt;
    }

    .flash-action-label {
      font-size: 9pt;
      text-transform: uppercase;
      opacity: 0.8;
      margin-bottom: 4pt;
    }

    .flash-action-text {
      font-size: 12pt;
      font-weight: 600;
    }

    .flash-meta {
      display: flex;
      gap: 20pt;
      font-size: 9pt;
      opacity: 0.9;
    }

    .flash-meta-item strong {
      font-weight: 700;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12pt;
      background: #f8f9fa;
      padding: 12pt;
      border-radius: 4pt;
      margin-bottom: 24pt;
      border: 1px solid #e0e0e0;
    }

    .meta-item { font-size: 9pt; }
    .meta-label { text-transform: uppercase; font-weight: 700; color: #666; letter-spacing: 0.5pt; margin-bottom: 2pt; }
    .meta-value { color: #1a1a1a; font-weight: 600; }

    .section { margin-bottom: 28pt; page-break-inside: avoid; }
    .section-title {
      font-size: 12pt;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12pt;
      padding-bottom: 6pt;
      border-bottom: 2px solid #7c3aed;
    }

    .subsection-title { font-size: 12pt; font-weight: 700; color: #7c3aed; margin: 18pt 0 8pt 0; }

    .executive-summary {
      background: #f0f0f0;
      border-left: 4pt solid #7c3aed;
      padding: 16pt;
      margin: 16pt 0;
      font-size: 10.5pt;
      line-height: 1.6;
    }

    /* IMPACT LADDER - New */
    .impact-ladder {
      background: #fef3c7;
      border: 2pt solid #f59e0b;
      border-radius: 6pt;
      padding: 16pt;
      margin: 16pt 0;
    }

    .impact-ladder-title {
      font-weight: 700;
      color: #b45309;
      font-size: 11pt;
      margin-bottom: 12pt;
      display: flex;
      align-items: center;
      gap: 8pt;
    }

    .impact-item {
      background: white;
      border-radius: 4pt;
      padding: 12pt;
      margin-bottom: 10pt;
      border-left: 4pt solid #f59e0b;
    }

    .impact-issue {
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 8pt;
      font-size: 10.5pt;
    }

    .impact-row {
      display: flex;
      margin: 6pt 0;
      font-size: 9.5pt;
    }

    .impact-label {
      width: 140pt;
      font-weight: 600;
      color: #666;
    }

    .impact-value {
      flex: 1;
      color: #1a1a1a;
    }

    /* INCIDENT DETAIL TABLE - Enhanced */
    .incident-detail-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16pt 0;
      font-size: 9pt;
    }

    .incident-detail-table th {
      background: #991b1b;
      color: white;
      padding: 8pt;
      text-align: left;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 8pt;
      letter-spacing: 0.5pt;
    }

    .incident-detail-table td {
      padding: 8pt;
      border-bottom: 1px solid #e0e0e0;
      vertical-align: top;
    }

    .incident-detail-table tbody tr:nth-child(even) { background: #fef2f2; }

    .incident-id-link {
      color: #7c3aed;
      font-family: monospace;
      font-size: 8pt;
    }

    .system-badge {
      display: inline-block;
      padding: 2pt 6pt;
      border-radius: 3pt;
      font-size: 8pt;
      font-weight: 600;
      text-transform: uppercase;
    }

    .system-cyber { background: #dbeafe; color: #1e40af; }
    .system-physical { background: #dcfce7; color: #166534; }
    .system-intel { background: #f3e8ff; color: #7c3aed; }
    .system-social { background: #fef3c7; color: #b45309; }

    /* OWNERSHIP MATRIX - New */
    .ownership-section {
      background: #f0fdf4;
      border: 2pt solid #22c55e;
      border-radius: 6pt;
      padding: 16pt;
      margin: 16pt 0;
    }

    .ownership-title {
      font-weight: 700;
      color: #166534;
      font-size: 11pt;
      margin-bottom: 12pt;
    }

    .action-item {
      background: white;
      border-radius: 4pt;
      padding: 12pt;
      margin-bottom: 10pt;
      border-left: 4pt solid #22c55e;
    }

    .action-description {
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 8pt;
      font-size: 10pt;
    }

    .action-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10pt;
      font-size: 9pt;
    }

    .action-meta-item {
      display: flex;
      flex-direction: column;
    }

    .action-meta-label {
      font-weight: 700;
      color: #666;
      font-size: 8pt;
      text-transform: uppercase;
      margin-bottom: 2pt;
    }

    .action-meta-value {
      color: #1a1a1a;
    }

    .priority-badge {
      display: inline-block;
      padding: 2pt 6pt;
      border-radius: 3pt;
      font-size: 8pt;
      font-weight: 600;
      text-transform: uppercase;
    }

    .priority-critical { background: #fee2e2; color: #dc2626; }
    .priority-high { background: #fef3c7; color: #b45309; }
    .priority-medium { background: #dbeafe; color: #2563eb; }

    /* EVIDENCE CITATIONS - Enhanced */
    .evidence-citation {
      background: white;
      border-left: 3pt solid #7c3aed;
      padding: 10pt 12pt;
      margin: 8pt 0;
      font-size: 9.5pt;
      color: #333;
    }

    .evidence-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 6pt;
    }

    .evidence-source {
      font-size: 8pt;
      color: #7c3aed;
      font-weight: 600;
    }

    .evidence-timestamp {
      font-size: 8pt;
      color: #888;
      font-family: monospace;
    }

    .evidence-text {
      color: #1a1a1a;
      line-height: 1.5;
    }

    .evidence-links {
      display: flex;
      gap: 12pt;
      margin-top: 6pt;
      font-size: 8pt;
    }

    .evidence-link {
      color: #7c3aed;
      text-decoration: none;
    }

    .evidence-link:hover { text-decoration: underline; }

    .evidence-id {
      color: #888;
      font-family: monospace;
      font-size: 7pt;
    }

    .risk-table {
      width: 100%;
      border-collapse: collapse;
      margin: 16pt 0;
      font-size: 10pt;
    }

    .risk-table th {
      background: #7c3aed;
      color: white;
      padding: 8pt;
      text-align: left;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 9pt;
      letter-spacing: 0.5pt;
    }

    .risk-table td {
      padding: 8pt;
      border-bottom: 1px solid #e0e0e0;
    }

    .risk-table tbody tr:nth-child(even) { background: #f8f9fa; }

    .risk-badge {
      display: inline-block;
      padding: 3pt 8pt;
      border-radius: 3pt;
      font-weight: 700;
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
    }

    .risk-low { background: #22c55e; color: white; }
    .risk-moderate { background: #eab308; color: white; }
    .risk-elevated { background: #f97316; color: white; }
    .risk-high { background: #ef4444; color: white; }

    .narrative-section {
      margin: 20pt 0;
      padding: 16pt;
      background: #fafafa;
      border-radius: 4pt;
      border: 1px solid #e0e0e0;
    }

    .narrative-text {
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1a1a1a;
      margin: 12pt 0;
    }

    .deduction-box {
      background: #fff8e1;
      border: 2pt solid #f59e0b;
      border-radius: 4pt;
      padding: 16pt;
      margin: 16pt 0;
    }

    .deduction-label {
      font-weight: 700;
      color: #f59e0b;
      text-transform: uppercase;
      font-size: 9pt;
      letter-spacing: 1pt;
      margin-bottom: 8pt;
    }

    .deduction-text {
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1a1a1a;
    }

    .footer {
      text-align: center;
      font-size: 8pt;
      color: #999;
      padding: 12pt 0;
      border-top: 1px solid #e0e0e0;
      margin-top: 24pt;
    }

    .page-break { page-break-after: always; }
    @media print { .no-print { display: none; } }

  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div class="classification">SENSITIVE SECURITY INFORMATION</div>
      <div class="report-date">${reportDate}</div>
    </div>
    <div class="logo-area">
      <div class="company-name">Fortress AI</div>
      <div class="report-title">${client.name} – Executive Intelligence Brief</div>
    </div>
  </div>

  <!-- EXECUTIVE FLASH BANNER -->
  <div class="executive-flash">
    <div class="flash-header">
      <div class="flash-title">Executive Flash</div>
      <div class="flash-confidence">Confidence: ${executiveFlash.confidence}</div>
    </div>
    <div class="flash-issue">${executiveFlash.mostPressingIssue}</div>
    <div class="flash-action">
      <div class="flash-action-label">Recommended Action</div>
      <div class="flash-action-text">${executiveFlash.recommendedAction}</div>
    </div>
    <div class="flash-meta">
      <div class="flash-meta-item"><strong>Owner:</strong> ${executiveFlash.ownerSuggestion}</div>
      <div class="flash-meta-item"><strong>Timeline:</strong> ${executiveFlash.deadlineUrgency}</div>
      <div class="flash-meta-item"><strong>Risk Level:</strong> ${overallRiskLevel}</div>
      <div class="flash-meta-item"><strong>Trajectory:</strong> ${executiveFlash.trajectory || 'STABLE'} — ${executiveFlash.trajectoryReason || 'Insufficient data for trend comparison'}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <div class="meta-label">Client</div>
      <div class="meta-value">${client.name}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Reporting Period</div>
      <div class="meta-value">${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Report Generated</div>
      <div class="meta-value">${reportGeneratedAt.toLocaleString()}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Industry</div>
      <div class="meta-value">${client.industry || 'N/A'}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Signals Analyzed</div>
      <div class="meta-value">${freshSignals.length}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">P1/P2 Incidents</div>
      <div class="meta-value">${p1p2Incidents.length} total (${newIncidentsLast24h.length} new, ${staleOpenIncidents.length} stale)</div>
    </div>
  </div>

  <div class="section">
    <h2 class="section-title">Executive Summary</h2>
    <div class="executive-summary">
      ${executiveSummary.split('\n').map(p => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
    </div>
  </div>

  <!-- P1/P2 INCIDENT DETAIL TABLE -->
  ${p1p2Incidents.length > 0 ? `
  <div class="section">
    <h2 class="section-title">P1/P2 Incident Detail</h2>
    <p style="margin-bottom: 12pt; font-size: 10pt; color: #666;">
      <strong>${p1p2Incidents.length}</strong> priority incidents total: 
      <strong style="color: #22c55e;">${newIncidentsLast24h.length}</strong> new (last 24h), 
      <strong style="color: #f97316;">${staleOpenIncidents.length}</strong> stale (&gt;7 days old), 
      <strong>${unknownIncidents.length}</strong> require classification.
    </p>
    <table class="incident-detail-table">
      <thead>
        <tr>
          <th style="width: 80pt;">Incident ID</th>
          <th style="width: 60pt;">Priority</th>
          <th style="width: 60pt;">Age</th>
          <th style="width: 80pt;">System Origin</th>
          <th>Type / Classification Rationale</th>
          <th style="width: 100pt;">Opened At</th>
        </tr>
      </thead>
      <tbody>
        ${incidentsWithAge.slice(0, 10).map(incident => {
          const rationale = incident.incident_classification_rationale?.[0];
          const systemOrigin = rationale?.system_of_origin || 'unknown';
          const systemClass = systemOrigin.toLowerCase().includes('cyber') ? 'cyber' :
                              systemOrigin.toLowerCase().includes('physical') ? 'physical' :
                              systemOrigin.toLowerCase().includes('intel') ? 'intel' : 'social';
          const ageLabel = incident.isNew ? '🆕 NEW' : (incident.isStale ? '⚠️ STALE' : `${incident.ageDays}d`);
          const ageColor = incident.isNew ? '#22c55e' : (incident.isStale ? '#f97316' : '#6b7280');
          return `
        <tr>
          <td>
            <a href="/incidents?id=${incident.id}" class="evidence-link">
              <span class="incident-id-link">${incident.id.substring(0, 8).toUpperCase()}</span>
            </a>
          </td>
          <td>
            <span class="risk-badge ${incident.priority === 'p1' ? 'risk-high' : 'risk-elevated'}">
              ${incident.priority?.toUpperCase()}
            </span>
          </td>
          <td style="font-size: 9pt; color: ${ageColor}; font-weight: bold;">
            ${ageLabel}
          </td>
          <td>
            <span class="system-badge system-${systemClass}">${systemOrigin}</span>
          </td>
          <td>
            <strong>${incident.incident_type || 'Unknown'}</strong><br>
            <span style="font-size: 8pt; color: #666;">
              ${rationale?.rationale || 'Classification pending - requires analyst review'}
            </span>
          </td>
          <td style="font-size: 9pt; font-family: monospace;">
            ${incident.openedAtFormatted}
          </td>
        </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <div class="section">
    <h2 class="section-title">Risk Assessment</h2>
    <p style="margin-bottom: 12pt;">
      Overall inherent risk rating for ${client.name}: 
      <strong><span class="risk-badge risk-${overallRiskLevel.toLowerCase()}">${overallRiskLevel}</span></strong>
    </p>

    <table class="risk-table">
      <thead>
        <tr>
          <th>Threat Factor</th>
          <th>Risk Rating</th>
          <th>Signal Count</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Surveillance / Reconnaissance</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(surveillanceRisk).toLowerCase()}">${getRiskLevel(surveillanceRisk)}</span></td>
          <td>${surveillanceRisk}</td>
        </tr>
        <tr>
          <td><strong>Protest / Activism</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(protestRisk).toLowerCase()}">${getRiskLevel(protestRisk)}</span></td>
          <td>${protestRisk}</td>
        </tr>
        <tr>
          <td><strong>Work Interruption</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(incidents?.filter(i => i.status === 'open').length || 0).toLowerCase()}">${getRiskLevel(incidents?.filter(i => i.status === 'open').length || 0)}</span></td>
          <td>${incidents?.filter(i => i.status === 'open').length || 0}</td>
        </tr>
        <tr>
          <td><strong>Sabotage / Vandalism</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(sabotageThreat).toLowerCase()}">${getRiskLevel(sabotageThreat)}</span></td>
          <td>${sabotageThreat}</td>
        </tr>
        <tr>
          <td><strong>Critical Threats</strong></td>
          <td><span class="risk-badge risk-${getRiskLevel(criticalSignals.length).toLowerCase()}">${getRiskLevel(criticalSignals.length)}</span></td>
          <td>${criticalSignals.length}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- IMPACT LADDERS -->
  ${impactLadders.length > 0 ? `
  <div class="section">
    <div class="impact-ladder">
      <div class="impact-ladder-title">📊 Impact Analysis</div>
      ${impactLadders.map(ladder => `
      <div class="impact-item">
        <div class="impact-issue">${ladder.issue}</div>
        <div class="impact-row">
          <div class="impact-label">Worst Consequence:</div>
          <div class="impact-value">${ladder.worstConsequence}</div>
        </div>
        <div class="impact-row">
          <div class="impact-label">Earliest Indicator:</div>
          <div class="impact-value">${ladder.earliestIndicator}</div>
        </div>
        <div class="impact-row">
          <div class="impact-label">Mitigation:</div>
          <div class="impact-value">${ladder.mitigation}</div>
        </div>
      </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  <!-- OWNERSHIP + TIMELINE -->
  ${actionItems.length > 0 ? `
  <div class="section">
    <div class="ownership-section">
      <div class="ownership-title">📋 Action Items & Ownership</div>
      ${actionItems.map(item => `
      <div class="action-item">
        <div class="action-description">${item.description}</div>
        <div class="action-meta">
          <div class="action-meta-item">
            <div class="action-meta-label">Owner</div>
            <div class="action-meta-value">${item.ownerName || item.ownerRole}</div>
          </div>
          <div class="action-meta-item">
            <div class="action-meta-label">Deadline</div>
            <div class="action-meta-value">${new Date(item.deadline).toLocaleDateString()}</div>
          </div>
          <div class="action-meta-item">
            <div class="action-meta-label">First Update</div>
            <div class="action-meta-value">${new Date(item.firstUpdateDue).toLocaleDateString()}</div>
          </div>
        </div>
        <div style="margin-top: 8pt;">
          <span class="priority-badge priority-${item.priority}">${item.priority}</span>
        </div>
      </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${narratives.length > 0 ? `
  <div class="page-break"></div>
  <div class="section">
    <h2 class="section-title">Issues of Specific Concern</h2>
    ${narratives.map(item => `
      <div class="narrative-section">
        <h3 class="subsection-title">${getCategoryDisplay(item.category)}</h3>
        <div class="narrative-text">
          ${item.narrative.split('\n\n').map((p: string) => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
        </div>
        
        ${item.signals.slice(0, 3).map((signal: any) => `
          <div style="border-left: 3px solid #7c3aed; padding: 8px 14px; margin-bottom: 12px; background: #0f0f0f;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span style="color: #7c3aed; font-size: 11px; font-weight: bold;">Source: Fortress Intelligence Platform</span>
              <span style="color: #555; font-size: 10px;">${new Date(signal.received_at).toISOString()}</span>
            </div>
            <p style="margin: 0 0 6px; font-size: 12px; color: #ccc; line-height: 1.5;">
              <strong style="color: #aaa;">${getCategoryDisplay(signal.category || 'signal')}:</strong> ${signal.normalized_text?.substring(0, 250) || 'No details available'}
            </p>
            <div style="display: flex; gap: 12px; align-items: center;">
              <span style="font-size: 10px; color: #444;">ID: ${signal.id.substring(0, 8).toUpperCase()}</span>
              ${signal.source_url ? `<a href="${signal.source_url}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #7c3aed; text-decoration: underline;">Original Source →</a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')}
  </div>
  ` : ''}

  <div class="section">
    <div class="deduction-box">
      <div class="deduction-label">Strategic Deductions</div>
      <div class="deduction-text">
        ${deductions.split('\n\n').map(p => `<p style="margin-bottom: 10pt;">${p}</p>`).join('')}
      </div>
    </div>
  </div>

  <div class="footer">
    Client: ${client.name} | Effective Date: ${reportDate}<br>
    Copyright © 2026. Fortress AI Security Intelligence Platform. All Rights Reserved.
  </div>
</body>
</html>`;

    // Store report with enhanced metadata
    const { data: report, error: reportError } = await supabase
      .from('reports')
      .insert({
        type: 'executive_intelligence',
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        meta_json: {
          client_id,
          client_name: client.name,
          report_generated_at: currentDateTimeISO,
          total_signals: freshSignals.length,
          critical_signals: criticalSignals.length,
          high_signals: highSignals.length,
          p1p2_incidents: p1p2Incidents.length,
          new_incidents_last_24h: newIncidentsLast24h.length,
          stale_open_incidents: staleOpenIncidents.length,
          unknown_incidents: unknownIncidents.length,
          lead_time_advantage: freshSignals.filter(s =>
            new Date(s.received_at) < new Date(reportGeneratedAt.getTime() - 24*60*60*1000)
          ).length,
          overall_risk_level: overallRiskLevel,
          categories: Object.keys(signalsByCategory),
          executive_flash: executiveFlash,
          impact_ladders: impactLadders,
          action_items: actionItems.map(a => ({
            description: a.description,
            owner: a.ownerName || a.ownerRole,
            deadline: a.deadline,
            priority: a.priority
          })),
          executive_summary: executiveSummary,
          deductions,
          narratives: narratives.map(n => ({ category: n.category, narrative: n.narrative }))
        }
      })
      .select()
      .single();

    if (reportError) throw reportError;

    // Store evidence sources for traceability
    if (report && evidenceSources.length > 0) {
      await supabase.from('report_evidence_sources').insert(
        evidenceSources.slice(0, 50).map(es => ({
          report_id: report.id,
          claim_text: es.claim,
          source_type: es.sourceType,
          source_id: es.sourceId,
          source_title: es.sourceTitle,
          source_url: es.sourceUrl,
          internal_url: es.internalUrl,
          timestamp: es.timestamp,
          confidence_score: es.confidence
        }))
      );
    }

    // Store action items for tracking
    if (report && actionItems.length > 0) {
      await supabase.from('report_action_items').insert(
        actionItems.map(a => ({
          report_id: report.id,
          action_description: a.description,
          owner_id: a.ownerId,
          owner_role: a.ownerRole,
          deadline: a.deadline,
          first_update_due: a.firstUpdateDue,
          priority: a.priority,
          status: 'pending'
        }))
      );
    }

    console.log('Enhanced executive report generated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        report_id: report.id,
        html,
        metadata: {
          client: client.name,
          period: `${periodStart.toLocaleDateString()} - ${periodEnd.toLocaleDateString()}`,
          signals_analyzed: freshSignals.length,
          p1p2_incidents: p1p2Incidents.length,
          risk_level: overallRiskLevel,
          executive_flash: executiveFlash,
          action_items_count: actionItems.length,
          categories: Object.keys(signalsByCategory)
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating executive report:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});