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
      // HOTFIX-2 (#219): the role lookup must FAIL CLOSED. If is_super_admin errors, an unknown
      // role is NOT a non-super-admin — do not fall through to the membership path (that could let
      // an unverified caller land a client via a single-membership guess). Refuse the write.
      const { data: isSuper, error: roleErr } = await supabase.rpc('is_super_admin', { _user_id: caller.userId });
      if (roleErr) {
        console.error('[onboarding] is_super_admin lookup failed — failing closed:', roleErr);
        return errorResponse('Could not verify caller role; refusing to create a client. Retry, or contact an operator.', 400);
      }

      if (requestedTenantId) {
        if (isSuper === true || callerTenantIds.includes(requestedTenantId)) {
          tenantId = requestedTenantId;
        } else {
          return errorResponse('Not authorized to create a client in the requested tenant', 403);
        }
      } else if (isSuper === true) {
        // WO-CLIENT-ONBOARD-SCOPE step 2: a super-admin acts ACROSS tenants, so their own
        // sole membership must NOT be an implicit target — that is exactly how "Kyle Kane"
        // misfiled into Silent Shield Operations when the UI sent no tenant_id. Require an
        // explicit selection; never fall through to the caller's home tenant.
        return errorResponse('Select a tenant before creating a client', 400);
      } else if (callerTenantIds.length === 1) {
        // Single-tenant (non-super) user: their sole membership is unambiguous.
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

    // WO-CLIENT-ONBOARD-SCOPE step 1 (Finding 4): onboarding produces NO numeric risk score.
    // A score is only meaningful once ATTRIBUTED SIGNALS exist; at onboard there are none, so
    // risk_score is null and every surface renders "Unscored" (no colour, no bar). The LLM read of
    // the profile is retained ONLY as free-text `analyst_notes` — it is never a score, level,
    // colour, or bar. The previous hardcoded 50 fallback is removed: it manufactured a number from
    // nothing (Row A showed exactly that — "Insufficient data" → 50).
    //
    // PROVENANCE FLAG (do not change here): this call still sends prospect identity + location to
    // gpt-4o-mini. Whether prospect PII should leave Fortress for a model API is an open provenance
    // question tracked in WO-CLIENT-ONBOARD-SCOPE; unchanged in this step.
    const aiResult = await callAiGateway({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a security analyst. Given client onboarding data, write a brief prose note (max 120 words) on plausible security considerations for this profile. Do NOT output any score, rating, number, or level. Plain text only.`
        },
        {
          role: 'user',
          content: JSON.stringify(normalizedData)
        }
      ],
      functionName: 'process-client-onboarding',
    });

    const analystNotes = (typeof aiResult.content === 'string' && aiResult.content.trim().length > 0)
      ? aiResult.content.trim()
      : null;

    const riskAssessment = {
      risk_score: null,          // no attributed signals at onboard → unscored; NEVER a fallback number
      analyst_notes: analystNotes,
      generated_at: new Date().toISOString(),
    };

    // Insert client with risk assessment
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        ...normalizedData,
        tenant_id: tenantId,
        threat_profile: [],   // no LLM-derived threat "profile" masquerading as a level/colour
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
