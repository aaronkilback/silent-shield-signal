import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const { investigationId } = await req.json();
    console.log('Suggesting cross-references for investigation:', investigationId);

    const supabase = createServiceClient();

    // Get current investigation details
    const { data: currentInvestigation, error: currentError } = await supabase
      .from('investigations')
      .select('file_number, synopsis, information, client_id')
      .eq('id', investigationId)
      .single();

    if (currentError || !currentInvestigation) {
      return errorResponse('Investigation not found', 404);
    }

    // Get all other investigations
    const { data: allInvestigations, error: allError } = await supabase
      .from('investigations')
      .select('id, file_number, synopsis, information, client_id')
      .neq('id', investigationId);

    if (allError) {
      return errorResponse(`Failed to fetch investigations: ${allError.message}`, 500);
    }

    if (!allInvestigations || allInvestigations.length === 0) {
      return successResponse({ suggestions: [] });
    }

    // Prepare context for AI
    const currentContext = `
File: ${currentInvestigation.file_number}
Synopsis: ${currentInvestigation.synopsis || 'N/A'}
Information: ${currentInvestigation.information || 'N/A'}
    `.trim();

    const otherInvestigations = allInvestigations.map(inv => `
ID: ${inv.id}
File: ${inv.file_number}
Synopsis: ${inv.synopsis || 'N/A'}
Information: ${inv.information?.substring(0, 500) || 'N/A'}
    `).join('\n---\n');

    const prompt = `You are analyzing investigation files to find potential cross-references. 

Current Investigation:
${currentContext}

Other Investigations:
${otherInvestigations}

Based on the content, identify which investigations should be cross-referenced with the current one. Look for:
- Similar incidents, persons, or locations
- Related timeframes or patterns
- Connected entities or organizations
- Similar methods or tactics

Return ONLY a JSON array of investigation IDs that should be cross-referenced, ordered by relevance (most relevant first).
Format: ["id1", "id2", "id3"]
Maximum 5 suggestions.`;

    const aiResult = await callAiGateway({
      model: 'google/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are an expert investigation analyst. Return ONLY valid JSON arrays.' },
        { role: 'user', content: prompt }
      ],
      functionName: 'suggest-investigation-references',
      dlqOnFailure: true,
      dlqPayload: { investigationId },
    });

    const aiResponse = aiResult.content;

    if (!aiResponse) {
      return errorResponse('No response from AI', 500);
    }

    // Parse AI response - handle potential markdown code blocks
    let suggestedIds: string[] = [];
    try {
      const jsonMatch = aiResponse.match(/\[.*\]/s);
      if (jsonMatch) {
        suggestedIds = JSON.parse(jsonMatch[0]);
      } else {
        suggestedIds = JSON.parse(aiResponse);
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiResponse);
      suggestedIds = [];
    }

    // Validate and get investigation details for suggestions
    const validatedSuggestions = [];
    for (const id of suggestedIds.slice(0, 5)) {
      const investigation = allInvestigations.find(inv => inv.id === id);
      if (investigation) {
        validatedSuggestions.push({
          id: investigation.id,
          file_number: investigation.file_number,
          synopsis: investigation.synopsis
        });
      }
    }

    console.log('AI suggested cross-references:', validatedSuggestions.length);

    return successResponse({ suggestions: validatedSuggestions });
  } catch (error) {
    console.error('Error in suggest-investigation-references:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error occurred', 500);
  }
});
