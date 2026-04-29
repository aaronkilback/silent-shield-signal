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

async function runHibpCheck(email: string, apiKey: string): Promise<any[]> {
  try {
    const response = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      {
        headers: {
          'hibp-api-key': apiKey,
          'user-agent': 'Fortress-Silent-Shield-Signal/1.0',
        },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (response.status === 404) return [];
    if (!response.ok) {
      console.log(`[HIBP] HTTP ${response.status} for ${email}`);
      return [];
    }
    return await response.json();
  } catch (err) {
    console.log(`[HIBP] Check failed for ${email}: ${err}`);
    return [];
  }
}

const REPORT_PROMPT = `You are a senior intelligence analyst writing a structured report about a Person of Interest (POI).

STRICT EVIDENCE RULE: Every factual claim (address, phone, email, associate name, criminal record, employer) MUST be sourced from the provided gathered intelligence. Do NOT fabricate, infer, or guess any specific personal details. If a detail is not in the provided data, say "Not identified in gathered intelligence."

STRICT SOURCING RULE — NO VAGUE CLAIMS ALLOWED:
- Every specific finding (activist mention, threat, protest, negative media, legal record) MUST cite the exact [Source N] number from the OSINT section AND quote the relevant URL.
- Do NOT write general statements like "activists are discussing this online" or "there is online activity" without naming the specific publication, post, or page.
- If a claim of activist/threat activity cannot be tied to a specific named source with a URL in the provided data, DO NOT include it. Write "Not identified in gathered intelligence" instead.
- When quoting from a source, include: the publication/platform name, the article title or post description, and the URL. Example: "Named in activist media [Source 4] — environmentalprogress.org: 'WPATH Files: BC Children's Hospital doctor...' (https://...)"
- Images: If a source URL has an associated image (thumbnail_url or image in metadata), reference it explicitly as "Image available: [URL]".

FOR WELL-KNOWN PUBLIC FIGURES ONLY: If this subject is a widely documented public figure (politician, celebrity, executive, known criminal) you may note publicly documented facts from your training — but you MUST mark each with [AI-KNOWLEDGE] and treat them as unverified leads requiring confirmation, NOT as confirmed facts.

For private individuals: Use ONLY what was gathered. Do not invent addresses, phone numbers, emails, employers, or associates.

Label every claim: [OSINT: source-name URL] for gathered web data, [AGENT] for agent findings from prior investigations, [TASK-FORCE: agent_call_sign] for findings from the current task force debate (if present), [AI-KNOWLEDGE] for AI training knowledge (public figures only).

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
      .select('id, name, type, risk_level, threat_score, description, aliases, attributes, ai_assessment')
      .eq('id', entity_id)
      .single();

    if (entityErr || !entity) return successResponse({ error: "Entity not found" });

    // ── Load top OSINT content ───────────────────────────────────────────────
    // Fetch more rows than needed — temporal decay re-ranks them before slicing to 50.
    // Old findings (>6 months) are down-weighted so fresh intelligence surfaces first.
    const { data: rawContentRows } = await supabase
      .from('entity_content')
      .select('title, url, content_text, content_type, relevance_score, created_at, source, metadata')
      .eq('entity_id', entity_id)
      .order('created_at', { ascending: false })
      .limit(150);

    const now = Date.now();
    const contentRows = (rawContentRows || [])
      .map((c: any) => {
        const ageDays = (now - new Date(c.created_at || 0).getTime()) / 86400000;
        const decay = ageDays < 180 ? 1.0
          : ageDays < 365 ? 0.85
          : ageDays < 730 ? 0.65
          : 0.45;
        return { ...c, _adjustedScore: (c.relevance_score || 50) * decay };
      })
      .sort((a: any, b: any) => b._adjustedScore - a._adjustedScore)
      .slice(0, 50);

    // ── Load signals mentioning this entity ──────────────────────────────────
    // Check related_entity_names (array), entity_tags (array), and normalized_text (text)
    const { data: signals } = await supabase
      .from('signals')
      .select('id, title, signal_type, severity, severity_score, source_name, event_date, normalized_text')
      .or(`related_entity_names.cs.{"${entity.name}"},entity_tags.cs.{"${entity.name}"},normalized_text.ilike.%${entity.name}%`)
      .order('event_date', { ascending: false })
      .limit(20);

    // ── Load speculative agent analyses for this entity's signals ────────────
    let signalAnalyses: any[] = [];
    if (signals && signals.length > 0) {
      const { data: analyses } = await supabase
        .from('signal_agent_analyses')
        .select('signal_id, agent_call_sign, analysis, confidence_score, trigger_reason, created_at')
        .in('signal_id', signals.map(s => s.id))
        .order('created_at', { ascending: false })
        .limit(15);
      signalAnalyses = analyses || [];
    }

    // ── Load entity relationships (associates & network) ─────────────────────
    const { data: relationships } = await supabase
      .from('entity_relationships')
      .select('entity_a_id, entity_b_id, relationship_type, description, strength')
      .or(`entity_a_id.eq.${entity_id},entity_b_id.eq.${entity_id}`)
      .order('strength', { ascending: false })
      .limit(20);

    // Resolve related entity names
    let relationshipsText = 'No known associates in database.';
    if (relationships && relationships.length > 0) {
      const relatedIds = relationships.map((r: any) =>
        r.entity_a_id === entity_id ? r.entity_b_id : r.entity_a_id
      );
      const { data: relatedEntities } = await supabase
        .from('entities')
        .select('id, name, type, description')
        .in('id', relatedIds);

      const nameMap = new Map((relatedEntities || []).map((e: any) => [e.id, e]));
      relationshipsText = relationships.map((r: any) => {
        const relatedId = r.entity_a_id === entity_id ? r.entity_b_id : r.entity_a_id;
        const related = nameMap.get(relatedId);
        const relatedName = related?.name || relatedId;
        const relatedType = related?.type || 'unknown';
        return `- ${relatedName} (${relatedType}) — ${r.relationship_type}: ${r.description} [strength: ${Math.round((r.strength || 0) * 100)}%]`;
      }).join('\n');
    }

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
      const imageNote = c.metadata?.image_url ? `\nImage: ${c.metadata.image_url}` : '';
      const relevance = c.relevance_score ? ` [relevance: ${c.relevance_score}]` : '';
      return `[Source ${i + 1}]${relevance}\nTitle: ${c.title || 'Untitled'}\nURL: ${c.url || 'N/A'}\nSource: ${c.source || 'unknown'} (${c.content_type || 'web'}, ${date})${imageNote}\nContent: ${snippet}`;
    }).join('\n\n---\n\n');

    const signalsText = (signals || []).map(s => {
      const date = s.event_date ? new Date(s.event_date).toLocaleDateString() : 'unknown';
      return `- [${date}] ${s.signal_type?.toUpperCase()} | Severity: ${s.severity} (${s.severity_score}/100) | "${s.title}"`;
    }).join('\n');

    const watchText = (watchEntries || []).map(w =>
      `- Watch Level: ${w.watch_level} | Reason: ${w.reason} | Boost: +${w.severity_boost}`
    ).join('\n');

    const attrs = (entity.attributes as any) || {};
    const contactInfoEmails: string[] = Array.isArray(attrs.contact_info?.email)
      ? attrs.contact_info.email
      : (typeof attrs.contact_info?.email === 'string' ? [attrs.contact_info.email] : []);
    const entityEmails: string[] = [...new Set([...(attrs.emails || []), ...contactInfoEmails])];

    const contactInfoPhones: string[] = Array.isArray(attrs.contact_info?.phone)
      ? attrs.contact_info.phone
      : (typeof attrs.contact_info?.phone === 'string' ? [attrs.contact_info.phone] : []);
    const entityPhones: string[] = [...new Set([...(attrs.phones || []), ...contactInfoPhones])];

    // Format stored ai_assessment as context for the report
    const aiAssessment = (entity as any).ai_assessment;
    const aiAssessmentText = aiAssessment
      ? `Risk Summary: ${aiAssessment.risk_summary || 'N/A'}\n\nKey Findings:\n${(aiAssessment.key_findings || []).map((f: string) => `- ${f}`).join('\n')}\n\nRecommended Actions:\n${(aiAssessment.recommended_actions || []).map((a: string) => `- ${a}`).join('\n')}`
      : null;
    // Run HIBP live if the stored investigation didn't complete it
    const hibpApiKey = Deno.env.get('HIBP_API_KEY') || '';
    let liveBreaches: any[] = [];
    let liveHibpRan = false;

    if (!investigation?.hibp_checked && entityEmails.length > 0 && hibpApiKey) {
      console.log(`[generate-poi-report] Running live HIBP check for ${entityEmails.length} email(s)`);
      for (const email of entityEmails.slice(0, 3)) {
        const results = await runHibpCheck(email, hibpApiKey);
        liveBreaches.push(...results);
        if (entityEmails.length > 1) await new Promise(r => setTimeout(r, 1500));
      }
      liveHibpRan = true;
    }

    const hibpBreaches = investigation?.hibp_breaches ?? (liveHibpRan ? liveBreaches : null);
    const hibpChecked = investigation?.hibp_checked || liveHibpRan;

    const hibpText = hibpChecked
      ? (hibpBreaches?.length
          ? `Breaches found:\n${hibpBreaches.map((b: any) =>
              `  - ${b.Name} (${b.BreachDate}): ${b.DataClasses?.join(', ')}`
            ).join('\n')}`
          : 'No credential breaches found in HaveIBeenPwned database.')
      : entityEmails.length > 0
        ? `Breach check not performed despite ${entityEmails.length} known email(s) on file: ${entityEmails.join(', ')}. HIBP_API_KEY may not be configured.`
        : 'Breach check not performed — no email address on file for this subject.';

    const investigationMeta = investigation
      ? `Investigation run: ${new Date(investigation.created_at).toLocaleDateString()} | Sources searched: ${investigation.sources_searched} | Results found: ${investigation.results_found} | Queries run: ${investigation.queries_run?.length || 0}`
      : 'No investigation metadata available.';

    const agentFindingsText = agentFindings.length > 0
      ? agentFindings.map((f, i) =>
          `[Agent Finding ${i + 1}] ${f.agent} (${f.specialty}) — Incident: "${f.incident_title}" (Severity: ${f.incident_severity})\n${f.analysis}`
        ).join('\n\n---\n\n')
      : 'No prior agent investigation findings for this subject.';

    const signalAnalysesText = signalAnalyses.length > 0
      ? signalAnalyses.map((a, i) => {
          const sig = (signals || []).find(s => s.id === a.signal_id);
          return `[Signal Analysis ${i + 1}] ${a.agent_call_sign} — Signal: "${sig?.title || a.signal_id}" (${sig?.severity || 'unknown'} severity)\nConfidence: ${a.confidence_score != null ? Math.round(a.confidence_score * 100) + '%' : 'N/A'} | Trigger: ${a.trigger_reason || 'auto'}\n${a.analysis}`;
        }).join('\n\n---\n\n')
      : null;

    // ── Multi-agent task force debate ────────────────────────────────────────
    // Triggers a structured debate between three specialty-matched agents, then
    // injects their independent analyses + judge synthesis into the report
    // prompt. Best-effort: if the debate fails or times out, the report still
    // generates with the existing single-AI synthesis. Disabled with
    // env POI_REPORT_DEBATE_ENABLED=false.
    let taskForceDebateText: string | null = null;
    if (Deno.env.get('POI_REPORT_DEBATE_ENABLED') !== 'false') {
      try {
        const debateCallSigns = ['GUARDIAN', 'MCGRAW', 'SHERLOCK'];
        const debateQuestion =
          `Provide a current threat-posture assessment for the following Person of Interest based on the available intelligence. ` +
          `Subject: ${entity.name} (type: ${entity.type}). ` +
          `Risk level: ${entity.risk_level || 'unknown'}. Threat score: ${entity.threat_score ?? 'not assessed'}/10. ` +
          `Available evidence: ${(signals || []).length} signals, ${agentFindings.length} prior agent findings, ${(contentRows || []).length} OSINT sources, ${watchText ? 'on watch list' : 'not on watch list'}. ` +
          `Surface: (a) the highest-priority concerns each of you sees from your specialty, ` +
          `(b) where your analyses diverge, ` +
          `(c) the recommended monitoring posture going forward.`;

        const debateInvocation = await Promise.race([
          supabase.functions.invoke('multi-agent-debate', {
            body: { call_signs: debateCallSigns, question: debateQuestion, debate_type: 'poi_report' },
          }),
          new Promise<{ data: null; error: { message: string } }>((resolve) =>
            setTimeout(() => resolve({ data: null, error: { message: 'task force debate timeout (90s)' } }), 90_000)
          ),
        ]);

        const debateData: any = (debateInvocation as any)?.data;
        if (debateData?.individual_analyses?.length) {
          const analysesBlock = debateData.individual_analyses
            .map((a: any) => {
              const overall = a.overall_assessment || '(no overall assessment)';
              const conf = a.confidence != null ? ` | confidence: ${a.confidence}` : '';
              const hyps = (a.hypotheses || []).slice(0, 3)
                .map((h: any, i: number) => `  ${i + 1}. ${h.statement || h.hypothesis || JSON.stringify(h).slice(0, 200)}`)
                .join('\n');
              return `### ${a.agent} — ${a.specialty}${conf}\n${overall}\n${hyps ? `Hypotheses:\n${hyps}` : ''}`;
            })
            .join('\n\n');

          const synthesis = debateData.synthesis || {};
          const synthesisSummary = synthesis.final_assessment || synthesis.summary || synthesis.content || '(no synthesis)';
          const recs = (debateData.recommended_actions || []).slice(0, 5);
          const recsBlock = recs.length ? `\nRecommended actions:\n${recs.map((r: any, i: number) => `  ${i + 1}. ${typeof r === 'string' ? r : (r.action || JSON.stringify(r).slice(0, 200))}`).join('\n')}` : '';

          taskForceDebateText =
            `Three specialist agents independently analysed this subject without seeing each other's work. ` +
            `Judge consensus score: ${(debateData.consensus_score ?? 0).toFixed(0)}/100.\n\n` +
            `${analysesBlock}\n\n### Judge synthesis\n${synthesisSummary}${recsBlock}`;

          console.log(`[generate-poi-report] task force debate: ${debateData.agents_participated}/${debateCallSigns.length} agents, consensus ${debateData.consensus_score}`);
        } else {
          console.warn('[generate-poi-report] task force debate returned no analyses (non-fatal)');
        }
      } catch (debateErr) {
        console.warn('[generate-poi-report] task force debate failed (non-fatal):', debateErr instanceof Error ? debateErr.message : String(debateErr));
      }
    }

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

## STORED CONTACT INFORMATION
Emails on file: ${entityEmails.length > 0 ? entityEmails.join(', ') : 'None'}
Phones on file: ${entityPhones.length > 0 ? entityPhones.join(', ') : 'None'}

## CREDENTIAL BREACH DATA
${hibpText}

${aiAssessmentText ? `## PRIOR AI THREAT ASSESSMENT (stored from previous analysis)\n${aiAssessmentText}\n` : ''}## WATCH LIST STATUS
${watchText || 'Not currently on watch list.'}

${taskForceDebateText ? `## TASK FORCE DEBATE (current multi-agent analysis)\n${taskForceDebateText}\n\n` : ''}## PRIOR AGENT INVESTIGATION FINDINGS (${agentFindings.length} entries)
The following findings were contributed by specialized AI agents during prior incident investigations involving this subject:

${agentFindingsText}
${signalAnalysesText ? `\n## SIGNAL PRE-ANALYSIS (${signalAnalyses.length} agent analyses of signals mentioning this subject)\n${signalAnalysesText}` : ''}

## KNOWN ASSOCIATES & NETWORK (from entity_relationships database)
${relationshipsText}

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
