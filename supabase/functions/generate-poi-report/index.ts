/**
 * generate-poi-report
 *
 * Synthesizes an AI-written intelligence report for a Person of Interest
 * based on all available evidence: entity data, OSINT content, signals,
 * watch-list status, and investigation metadata.
 *
 * Called by investigate-poi once the search phase is complete.
 * Can also be triggered manually to re-generate a report.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

const REPORT_PROMPT = `You are a senior intelligence analyst writing a structured report about a Person of Interest (POI).

STRICT EVIDENCE RULE: Every factual claim (address, phone, email, associate name, criminal record, employer) MUST be sourced from the provided gathered intelligence. Do NOT fabricate, infer, or guess any specific personal details. If a detail is not in the provided data, say "Not identified in gathered intelligence."

FOR WELL-KNOWN PUBLIC FIGURES ONLY: If this subject is a widely documented public figure (politician, celebrity, executive, known criminal) you may note publicly documented facts from your training — but you MUST mark each with [AI-KNOWLEDGE] and treat them as unverified leads requiring confirmation, NOT as confirmed facts.

For private individuals: Use ONLY what was gathered. Do not invent addresses, phone numbers, emails, employers, or associates.

Label every claim: [OSINT] for gathered web data, [AGENT] for agent findings, [AI-KNOWLEDGE] for AI training knowledge (public figures only).

Format the report EXACTLY as follows (use these exact section headers):

## SUBJECT PROFILE
Full name, known aliases, entity type, risk level as assessed by the system, and a biographical summary. Draw on BOTH gathered OSINT and your own knowledge. Include known age, physical description, nationality, occupation, and background. Label each fact [OSINT] or [AI-KNOWLEDGE].

## AI KNOWLEDGE CONTRIBUTION
Only populate this section if the subject is a documented public figure in your training data. If so, list what you know with [AI-KNOWLEDGE] labels and note these are unverified leads. For private individuals, write: "Subject appears to be a private individual — no prior AI knowledge. All findings sourced from gathered intelligence only."

## EXECUTIVE SUMMARY
3-5 sentences synthesizing the full threat picture, combining OSINT findings, agent analysis, and AI knowledge for an executive audience.

## LOCATION & ADDRESS INTELLIGENCE
Priority section. Combine ALL sources:
- Last known address with source citation [OSINT]/[AI-KNOWLEDGE]/[AGENT]
- Previous addresses
- Current city/region of residence
- Workplace or frequently visited locations
- Property ownership or lease records
If nothing found: "No address data found. Recommend manual people-search query."

## POSITIVE FINDINGS
Bullet-pointed confirmed concerning findings from all sources. Label each [OSINT], [AI-KNOWLEDGE], or [AGENT]. Include: threats made, criminal history, threat actor associations, protest/extremist activity, surveillance sightings.

## NEGATIVE FINDINGS
What was searched but not found — important for analyst context.

## CRIMINAL & LEGAL HISTORY
Court cases, arrest records, warrants, civil suits. Draw on both gathered data and AI knowledge. Include case numbers and jurisdictions where known.

## SOCIAL MEDIA FOOTPRINT
All platforms identified, handles/usernames, notable posts. Include profile URLs.

## ASSOCIATES & NETWORK
All known associates, family members, organizational affiliations. Include relationship type and source. Draw on AI knowledge for known associates not yet in gathered data.

## CONTACT INFORMATION
Phone numbers, emails, other contact details found. Note source for each.

## AGENT INTELLIGENCE FINDINGS
Findings contributed by specialized AI agents during prior incident investigations involving this subject. Include agent call signs, their specialty, and key findings.

## BREACH DATA
Credential breach check results. List breach names, dates, data types exposed.

## SIGNAL HISTORY
Security intelligence signals mentioning this subject. Include dates, types, severity levels.

## CONFIDENCE ASSESSMENT
Rate overall confidence. Then output this exact JSON block:

\`\`\`json
{"confidence_score": <0-100>, "threat_level": "<none|low|medium|high|critical>"}
\`\`\`

## RECOMMENDED NEXT STEPS
Numbered actionable steps. Prioritize: address verification gaps, identity confirmation, associate investigation, legal record pull, and any leads from AI knowledge not yet confirmed by OSINT.`;

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createServiceClient();
    const body = await req.json();
    const { entity_id, investigation_id } = body;

    if (!entity_id) return successResponse({ error: "entity_id is required" });

    // ── Load entity ──────────────────────────────────────────────────────────
    const { data: entity, error: entityErr } = await supabase
      .from('entities')
      .select('id, name, type, risk_level, threat_score, description, aliases, attributes')
      .eq('id', entity_id)
      .single();

    if (entityErr || !entity) return successResponse({ error: "Entity not found" });

    // ── Load top OSINT content ───────────────────────────────────────────────
    const { data: contentRows } = await supabase
      .from('entity_content')
      .select('title, url, content_text, content_type, relevance_score, created_at')
      .eq('entity_id', entity_id)
      .order('relevance_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(50);

    // ── Load signals mentioning this entity ──────────────────────────────────
    const { data: signals } = await supabase
      .from('signals')
      .select('id, title, signal_type, severity, severity_score, source_name, event_date, normalized_text')
      .contains('related_entity_names', [entity.name])
      .order('event_date', { ascending: false })
      .limit(20);

    // ── Load watch-list status ───────────────────────────────────────────────
    const { data: watchEntries } = await supabase
      .from('entity_watch_list')
      .select('watch_level, reason, severity_boost, added_at, expiry_date')
      .or(`entity_id.eq.${entity_id},entity_name.ilike.${entity.name}`)
      .eq('is_active', true);

    // ── Load agent findings from incident investigations ──────────────────────
    // Find incidents linked to this entity via entity_mentions or related_entity_names
    const { data: linkedIncidents } = await supabase
      .from('incidents')
      .select('id, title, severity, status, ai_analysis_log, created_at')
      .not('ai_analysis_log', 'eq', '[]')
      .or(`related_entity_ids.cs.{${entity_id}},title.ilike.%${entity.name}%`)
      .order('created_at', { ascending: false })
      .limit(10);

    // Also check entity_mentions table for incidents linked to this entity
    const { data: mentionedIncidents } = await supabase
      .from('entity_mentions')
      .select('incident_id')
      .eq('entity_id', entity_id)
      .not('incident_id', 'is', null)
      .limit(20);

    const mentionedIncidentIds = (mentionedIncidents || [])
      .map((m: any) => m.incident_id)
      .filter(Boolean);

    let agentFindings: any[] = [];
    if (mentionedIncidentIds.length > 0) {
      const { data: mentionedIncidentData } = await supabase
        .from('incidents')
        .select('id, title, severity, ai_analysis_log, created_at')
        .in('id', mentionedIncidentIds)
        .not('ai_analysis_log', 'eq', '[]');

      if (mentionedIncidentData) {
        for (const inc of mentionedIncidentData) {
          const log: any[] = inc.ai_analysis_log || [];
          for (const entry of log) {
            if (entry.analysis) {
              agentFindings.push({
                incident_title: inc.title,
                incident_severity: inc.severity,
                agent: entry.agent_call_sign || 'Unknown Agent',
                specialty: entry.agent_specialty || '',
                analysis: (entry.analysis as string).substring(0, 800),
                timestamp: entry.timestamp,
              });
            }
          }
        }
      }
    }

    // Also pull from the title-matched incidents
    for (const inc of (linkedIncidents || [])) {
      const log: any[] = inc.ai_analysis_log || [];
      for (const entry of log) {
        if (entry.analysis && !agentFindings.find(f => f.incident_title === inc.title && f.agent === entry.agent_call_sign)) {
          agentFindings.push({
            incident_title: inc.title,
            incident_severity: inc.severity,
            agent: entry.agent_call_sign || 'Unknown Agent',
            specialty: entry.agent_specialty || '',
            analysis: (entry.analysis as string).substring(0, 800),
            timestamp: entry.timestamp,
          });
        }
      }
    }

    // Cap at 10 agent findings to stay within token limits
    agentFindings = agentFindings.slice(0, 10);

    // ── Load investigation metadata ──────────────────────────────────────────
    let investigation: any = null;
    if (investigation_id) {
      const { data: inv } = await supabase
        .from('poi_investigations')
        .select('queries_run, sources_searched, results_found, hibp_checked, hibp_breaches, created_at')
        .eq('id', investigation_id)
        .single();
      investigation = inv;
    }

    // ── Build context for AI ─────────────────────────────────────────────────
    const aliasesText = entity.aliases?.length
      ? `Aliases: ${Array.isArray(entity.aliases) ? entity.aliases.join(', ') : entity.aliases}`
      : 'No known aliases';

    const contentText = (contentRows || []).map((c, i) => {
      const date = c.created_at ? new Date(c.created_at).toLocaleDateString() : 'unknown date';
      const snippet = (c.content_text || '').substring(0, 1500);
      return `[Source ${i + 1}] ${c.title || 'Untitled'} (${c.content_type || 'web'}, ${date})\nURL: ${c.url || 'N/A'}\n${snippet}`;
    }).join('\n\n---\n\n');

    const signalsText = (signals || []).map(s => {
      const date = s.event_date ? new Date(s.event_date).toLocaleDateString() : 'unknown';
      return `- [${date}] ${s.signal_type?.toUpperCase()} | Severity: ${s.severity} (${s.severity_score}/100) | "${s.title}"`;
    }).join('\n');

    const watchText = (watchEntries || []).map(w =>
      `- Watch Level: ${w.watch_level} | Reason: ${w.reason} | Boost: +${w.severity_boost}`
    ).join('\n');

    const hibpText = investigation?.hibp_checked
      ? (investigation.hibp_breaches?.length
          ? `Breaches found:\n${investigation.hibp_breaches.map((b: any) =>
              `  - ${b.Name} (${b.BreachDate}): ${b.DataClasses?.join(', ')}`
            ).join('\n')}`
          : 'No credential breaches found in HaveIBeenPwned database.')
      : 'Breach check not performed.';

    const investigationMeta = investigation
      ? `Investigation run: ${new Date(investigation.created_at).toLocaleDateString()} | Sources searched: ${investigation.sources_searched} | Results found: ${investigation.results_found} | Queries run: ${investigation.queries_run?.length || 0}`
      : 'No investigation metadata available.';

    const agentFindingsText = agentFindings.length > 0
      ? agentFindings.map((f, i) =>
          `[Agent Finding ${i + 1}] ${f.agent} (${f.specialty}) — Incident: "${f.incident_title}" (Severity: ${f.incident_severity})\n${f.analysis}`
        ).join('\n\n---\n\n')
      : 'No prior agent investigation findings for this subject.';

    const userPrompt = `
# INTELLIGENCE REPORT REQUEST

**Subject:** ${entity.name}
**Type:** ${entity.type}
**Risk Level:** ${entity.risk_level || 'Unknown'}
**Threat Score:** ${entity.threat_score ?? 'Not assessed'}/10
**${aliasesText}**
${entity.description ? `**Description:** ${entity.description}` : ''}

## INVESTIGATION METADATA
${investigationMeta}

## CREDENTIAL BREACH DATA
${hibpText}

## WATCH LIST STATUS
${watchText || 'Not currently on watch list.'}

## PRIOR AGENT INVESTIGATION FINDINGS (${agentFindings.length} entries)
The following findings were contributed by specialized AI agents during prior incident investigations involving this subject:

${agentFindingsText}

## SIGNAL HISTORY (${(signals || []).length} signals)
${signalsText || 'No signals found mentioning this subject.'}

## OPEN SOURCE INTELLIGENCE (${(contentRows || []).length} sources)

${contentText || 'No OSINT content available.'}

---
REMINDER: You must also contribute your own knowledge about this subject from your training data. Label all claims with [OSINT], [AGENT], or [AI-KNOWLEDGE].
`.trim();

    // ── Call AI ──────────────────────────────────────────────────────────────
    const aiResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: REPORT_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      functionName: 'generate-poi-report',
      retries: 2,
      extraBody: { max_completion_tokens: 8192 },
    });

    if (aiResult.error || !aiResult.content) {
      throw new Error(aiResult.error || 'AI returned empty report');
    }

    const reportMarkdown = aiResult.content;

    // ── Extract confidence JSON from the report ──────────────────────────────
    let confidenceScore = 50;
    let threatLevel: string = 'low';
    const jsonMatch = reportMarkdown.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (typeof parsed.confidence_score === 'number') confidenceScore = Math.min(100, Math.max(0, parsed.confidence_score));
        if (parsed.threat_level) threatLevel = parsed.threat_level;
      } catch (_) { /* keep defaults */ }
    }

    // ── Build subject_profile JSONB ──────────────────────────────────────────
    const subjectProfile = {
      name: entity.name,
      type: entity.type,
      risk_level: entity.risk_level,
      threat_score: entity.threat_score,
      aliases: entity.aliases,
      watch_count: (watchEntries || []).length,
      signal_count: (signals || []).length,
      source_count: (contentRows || []).length,
      hibp_checked: investigation?.hibp_checked || false,
      hibp_breach_count: investigation?.hibp_breaches?.length || 0,
    };

    // ── Store report ─────────────────────────────────────────────────────────
    const { data: report, error: reportErr } = await supabase
      .from('poi_reports')
      .insert({
        entity_id,
        investigation_id: investigation_id || null,
        report_markdown: reportMarkdown,
        confidence_score: confidenceScore,
        threat_level: threatLevel,
        subject_profile: subjectProfile,
      })
      .select('id')
      .single();

    if (reportErr) return successResponse({ error: `Failed to save report: ${reportErr.message}` });

    // ── Update investigation with report_id ──────────────────────────────────
    if (investigation_id) {
      await supabase
        .from('poi_investigations')
        .update({ report_id: report.id, status: 'completed' })
        .eq('id', investigation_id);
    }

    return successResponse({
      report_id: report.id,
      entity_id,
      confidence_score: confidenceScore,
      threat_level: threatLevel,
      report_markdown: reportMarkdown,
    });

  } catch (error) {
    console.error('[generate-poi-report] Error:', error);
    return successResponse({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});
