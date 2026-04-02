import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

/**
 * Auto-summarize incidents by generating titles and summaries from linked signals.
 * Can be triggered for specific incidents or run in batch mode to fix missing data.
 */

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    const supabase = createServiceClient();

    const { incident_id, batch_mode = false, limit = 20 } = await req.json();

    console.log(`[auto-summarize-incident] Mode: ${batch_mode ? 'batch' : 'single'}, Incident: ${incident_id || 'N/A'}`);

    let incidentsToProcess: any[] = [];

    if (batch_mode) {
      // Find incidents missing title or summary
      const { data: incidentsMissingData } = await supabase
        .from('incidents')
        .select(`
          id, title, summary, incident_type, priority, severity_level, opened_at, client_id,
          incident_signals(signal_id),
          incident_entities(entity_id)
        `)
        .or('title.is.null,summary.is.null,title.eq.,summary.eq.')
        .order('opened_at', { ascending: false })
        .limit(limit);

      incidentsToProcess = incidentsMissingData || [];
      console.log(`Found ${incidentsToProcess.length} incidents needing summarization`);
    } else if (incident_id) {
      const { data: incident } = await supabase
        .from('incidents')
        .select(`
          id, title, summary, incident_type, priority, severity_level, opened_at, client_id,
          incident_signals(signal_id),
          incident_entities(entity_id)
        `)
        .eq('id', incident_id)
        .single();

      if (incident) {
        incidentsToProcess = [incident];
      }
    } else {
      return errorResponse('Either incident_id or batch_mode must be provided', 400);
    }

    const results: any[] = [];

    for (const incident of incidentsToProcess) {
      try {
        // Fetch linked signals for context
        const signalIds = (incident.incident_signals || []).map((s: any) => s.signal_id);
        let signalsContext = '';

        if (signalIds.length > 0) {
          const { data: signals } = await supabase
            .from('signals')
            .select('id, title, normalized_text, category, severity, location, created_at')
            .in('id', signalIds)
            .order('created_at', { ascending: true })
            .limit(10);

          if (signals && signals.length > 0) {
            signalsContext = signals.map((s, i) => 
              `Signal ${i + 1}: ${s.title || 'Untitled'}\n` +
              `Category: ${s.category || 'Unknown'}\n` +
              `Severity: ${s.severity || 'Unknown'}\n` +
              `Location: ${s.location || 'Unknown'}\n` +
              `Content: ${(s.normalized_text || '').substring(0, 500)}`
            ).join('\n\n---\n\n');
          }
        }

        // Fetch linked entities for additional context
        const entityIds = (incident.incident_entities || []).map((e: any) => e.entity_id);
        let entitiesContext = '';

        if (entityIds.length > 0) {
          const { data: entities } = await supabase
            .from('entities')
            .select('id, name, type, description, risk_level')
            .in('id', entityIds)
            .limit(10);

          if (entities && entities.length > 0) {
            entitiesContext = 'Linked Entities:\n' + entities.map(e => 
              `- ${e.name} (${e.type}): ${e.description || 'No description'} [Risk: ${e.risk_level || 'unknown'}]`
            ).join('\n');
          }
        }

        const aiResult = await callAiGateway({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are a corporate security analyst. Generate concise, actionable incident titles and summaries.

Rules:
- Title: 5-12 words, include threat type and key indicator (e.g., "Unauthorized Network Access Attempt at Data Center")
- Summary: 2-4 sentences covering: What happened, Who/What is affected, Current threat level, Immediate relevance
- Be specific but avoid unnecessary jargon
- Focus on business impact and actionability`
            },
            {
              role: 'user',
              content: `Generate a title and summary for this security incident:

Incident Type: ${incident.incident_type || 'Unknown'}
Priority: ${incident.priority || 'Unknown'}
Severity: ${incident.severity_level || 'Unknown'}
Opened: ${incident.opened_at || 'Unknown'}

${signalsContext ? `LINKED SIGNALS:\n${signalsContext}` : 'No linked signals available'}

${entitiesContext ? `\n${entitiesContext}` : ''}`
            }
          ],
          functionName: 'auto-summarize-incident',
          extraBody: {
            tools: [
              {
                type: "function",
                function: {
                  name: "generate_incident_summary",
                  description: "Generate a structured incident title and summary",
                  parameters: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Concise incident title (5-12 words)" },
                      summary: { type: "string", description: "2-4 sentence summary of the incident" },
                      incident_type_refined: { type: "string", description: "Refined incident type classification" },
                      key_indicators: { type: "array", items: { type: "string" }, description: "Key threat indicators identified" },
                      recommended_priority: { type: "string", enum: ["p1", "p2", "p3", "p4"], description: "Recommended priority based on analysis" }
                    },
                    required: ["title", "summary"],
                    additionalProperties: false
                  }
                }
              }
            ],
            tool_choice: { type: "function", function: { name: "generate_incident_summary" } }
          },
        });

        if (aiResult.error) {
          throw new Error(`AI gateway error: ${aiResult.error}`);
        }

        const toolCall = aiResult.raw?.choices?.[0]?.message?.tool_calls?.[0];

        if (!toolCall) {
          throw new Error('No tool call in AI response');
        }

        const generatedData = JSON.parse(toolCall.function.arguments);

        // Update the incident with generated title and summary
        const updatePayload: any = {
          updated_at: new Date().toISOString()
        };

        if (!incident.title || incident.title.trim() === '') {
          updatePayload.title = generatedData.title;
        }

        if (!incident.summary || incident.summary.trim() === '') {
          updatePayload.summary = generatedData.summary;
        }

        // Optionally update incident type if we have a better classification
        if (generatedData.incident_type_refined && (!incident.incident_type || incident.incident_type === 'unknown')) {
          updatePayload.incident_type = generatedData.incident_type_refined;
        }

        // Add AI insights to timeline
        const { data: currentIncident } = await supabase
          .from('incidents')
          .select('timeline_json')
          .eq('id', incident.id)
          .single();

        const existingTimeline = (currentIncident?.timeline_json as any[]) || [];
        updatePayload.timeline_json = [
          ...existingTimeline,
          {
            timestamp: new Date().toISOString(),
            action: 'ai_summarization',
            details: `AI auto-generated title and summary. Key indicators: ${(generatedData.key_indicators || []).join(', ') || 'None identified'}`
          }
        ];

        const { error: updateError } = await supabase
          .from('incidents')
          .update(updatePayload)
          .eq('id', incident.id);

        if (updateError) {
          throw updateError;
        }

        results.push({
          incident_id: incident.id,
          success: true,
          title: generatedData.title,
          summary_preview: (generatedData.summary || '').substring(0, 100) + '...',
          key_indicators: generatedData.key_indicators
        });

        console.log(`[auto-summarize-incident] Updated incident ${incident.id}: ${generatedData.title}`);

      } catch (incidentError) {
        console.error(`[auto-summarize-incident] Error processing ${incident.id}:`, incidentError);
        results.push({
          incident_id: incident.id,
          success: false,
          error: incidentError instanceof Error ? incidentError.message : 'Unknown error'
        });
      }
    }

    return successResponse({
      success: true,
      processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });

  } catch (error) {
    console.error('[auto-summarize-incident] Error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
