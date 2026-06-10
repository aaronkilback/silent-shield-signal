import { createServiceClient, corsHeaders, handleCors, successResponse, errorResponse, getCallerIdentity } from "../_shared/supabase-client.ts";
import { callAiGateway } from "../_shared/ai-gateway.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    const rawBody = await req.json();
    const { clientData, tenant_id: requestedTenantId } = rawBody;

    if (!clientData) {
      return errorResponse('Client data is required', 400);
    }

    // Basic validation
    const name = clientData.name || clientData['Client Name'] || clientData['Name'] || '';
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return errorResponse('Client name is required', 400);
    }

    // Provenance doctrine: a client MUST be tenant-owned. This function runs
    // as service-role (RLS-bypassing), so it is the non-bypassable write
    // seam — it must resolve the owning tenant itself and FAIL CLOSED rather
    // than insert a tenant_id=null orphan. (Orphaning was the bug that
    // stranded "Kilbacks" outside Silent Shield Operations: the wizard sent
    // no tenant_id and this insert defaulted it to null, invisible to every
    // tenant-scoped surface.)
    //
    // Owning tenant is derived from the AUTHENTICATED caller (verify_jwt=true):
    //   - explicit body.tenant_id is honored only if the caller is super_admin
    //     OR a member of that tenant (never a grant);
    //   - otherwise, a single-tenant caller's sole membership is used;
    //   - anything ambiguous (no membership, multi-tenant caller with no
    //     selection, unauthenticated) is rejected — no client is created.
    const caller = await getCallerIdentity(req);
    if (caller.kind === 'unauthorized') {
      return errorResponse(caller.error, caller.status);
    }

    let tenantId: string | null = null;
    if (caller.kind === 'user') {
      const { data: memberships } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', caller.userId);
      const callerTenantIds = (memberships || [])
        .map((m: { tenant_id: string | null }) => m.tenant_id)
        .filter((id): id is string => !!id);
      const { data: isSuper } = await supabase.rpc('is_super_admin', { _user_id: caller.userId });

      if (requestedTenantId) {
        if (isSuper === true || callerTenantIds.includes(requestedTenantId)) {
          tenantId = requestedTenantId;
        } else {
          return errorResponse('Not authorized to create a client in the requested tenant', 403);
        }
      } else if (callerTenantIds.length === 1) {
        tenantId = callerTenantIds[0];
      }
    } else if (caller.kind === 'service_role') {
      // Inter-function/service callers must name the owning tenant explicitly.
      if (requestedTenantId) tenantId = requestedTenantId;
    }

    if (!tenantId) {
      return errorResponse(
        'Cannot determine the owning tenant for this client. Select a tenant (or pass tenant_id) and retry — clients cannot be created without a tenant.',
        400,
      );
    }

    // Confirm the resolved tenant actually exists before owning a row to it.
    const { data: tenantRow, error: tenantErr } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle();
    if (tenantErr || !tenantRow) {
      return errorResponse('Resolved tenant does not exist', 400);
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
      model: 'gpt-4o-mini',
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
        tenant_id: tenantId,
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
