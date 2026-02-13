import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    const rawBody = await req.json();
    const { clientData } = rawBody;
    
    if (!clientData) {
      return errorResponse('Client data is required', 400);
    }

    // Basic validation
    const name = clientData.name || clientData['Client Name'] || clientData['Name'] || '';
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return errorResponse('Client name is required', 400);
    }

    console.log('Processing client onboarding data:', clientData);

    // Extract and normalize data from various form field names
    const normalizedData = {
      name: name.trim(),
      organization: clientData.organization || clientData['Organization'] || clientData['Company'] || '',
      contact_email: clientData.contact_email || clientData['Email'] || clientData['Contact Email'] || '',
      contact_phone: clientData.contact_phone || clientData['Phone'] || clientData['Contact Phone'] || '',
      industry: clientData.industry || clientData['Industry'] || clientData['Business Type'] || '',
      employee_count: parseInt(String(clientData.employee_count || clientData['Number of Employees'] || '0')),
      locations: Array.isArray(clientData.locations) 
        ? clientData.locations 
        : String(clientData.locations || clientData['Locations'] || '').split(',').map((l: string) => l.trim()).filter(Boolean),
      high_value_assets: Array.isArray(clientData.high_value_assets)
        ? clientData.high_value_assets
        : String(clientData.high_value_assets || clientData['High-Value Assets'] || '').split(',').map((a: string) => a.trim()).filter(Boolean),
      onboarding_data: clientData,
    };

    // Use AI to generate risk assessment via resilient gateway
    const aiResult = await callAiGateway({
      model: 'google/gemini-2.5-flash',
      messages: [
        {
          role: 'system',
          content: `You are a security risk analyst. Analyze client onboarding data and provide:
- threat_profile: array of potential threats based on industry and assets
- risk_score: 0-100 overall risk score
- risk_factors: array of specific risk factors
- recommendations: array of security recommendations
Respond ONLY with valid JSON.`
        },
        {
          role: 'user',
          content: JSON.stringify(normalizedData)
        }
      ],
      functionName: 'process-client-onboarding',
    });

    let riskAssessment = {
      threat_profile: ['General security threats'],
      risk_score: 50,
      risk_factors: ['Insufficient data for detailed assessment'],
      recommendations: ['Complete comprehensive security audit'],
      generated_at: new Date().toISOString(),
    };

    if (aiResult.content) {
      try {
        const parsed = JSON.parse(aiResult.content);
        riskAssessment = { ...riskAssessment, ...parsed, generated_at: new Date().toISOString() };
      } catch (e) {
        console.error('Failed to parse AI response:', e);
      }
    }

    // Insert client with risk assessment
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        ...normalizedData,
        threat_profile: riskAssessment.threat_profile,
        risk_assessment: riskAssessment,
        status: 'onboarding',
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client insert error:', clientError);
      throw clientError;
    }

    console.log('Client onboarded:', client.id);

    return successResponse({ 
      client_id: client.id, 
      risk_assessment: riskAssessment 
    });
  } catch (error) {
    console.error('Error in process-client-onboarding:', error);
    return errorResponse(error instanceof Error ? error.message : 'Unknown error', 500);
  }
});
