import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

/**
 * Apply Monitoring Proposal
 * 
 * When an analyst approves a monitoring proposal, this function
 * applies the change to the client's monitoring configuration.
 */

interface ApplyRequest {
  proposal_id: string;
  action: 'approve' | 'reject';
  user_id: string;
}

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();
    const { proposal_id, action, user_id } = await req.json() as ApplyRequest;

    if (!proposal_id || !action || !user_id) {
      return errorResponse('Missing required fields: proposal_id, action, user_id', 400);
    }

    // Fetch proposal
    const { data: proposal, error: fetchError } = await supabase
      .from('monitoring_proposals')
      .select('*')
      .eq('id', proposal_id)
      .single();

    if (fetchError || !proposal) {
      return errorResponse('Proposal not found', 404);
    }

    if (proposal.status !== 'pending') {
      return errorResponse(`Proposal already ${proposal.status}`, 400);
    }

    if (action === 'reject') {
      await supabase.from('monitoring_proposals').update({
        status: 'rejected',
        reviewed_by: user_id,
        reviewed_at: new Date().toISOString()
      }).eq('id', proposal_id);

      return successResponse({ success: true, action: 'rejected' });
    }

    // Approve: apply the change to client monitoring config
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, monitoring_keywords, supply_chain_entities')
      .eq('id', proposal.client_id)
      .single();

    if (clientError || !client) {
      return errorResponse('Client not found', 404);
    }

    const currentKeywords: string[] = client.monitoring_keywords || [];
    const currentEntities: string[] = client.supply_chain_entities || [];
    let updatePayload: Record<string, any> = {};

    switch (proposal.proposal_type) {
      case 'add_keyword': {
        if (!currentKeywords.includes(proposal.proposed_value)) {
          updatePayload.monitoring_keywords = [...currentKeywords, proposal.proposed_value];
        }
        break;
      }
      case 'remove_keyword': {
        updatePayload.monitoring_keywords = currentKeywords.filter(
          k => k.toLowerCase() !== proposal.proposed_value.toLowerCase()
        );
        break;
      }
      case 'add_entity': {
        if (!currentEntities.includes(proposal.proposed_value)) {
          updatePayload.supply_chain_entities = [...currentEntities, proposal.proposed_value];
        }
        break;
      }
      default:
        return errorResponse(`Unsupported proposal type: ${proposal.proposal_type}`, 400);
    }

    // Apply the change
    if (Object.keys(updatePayload).length > 0) {
      const { error: updateError } = await supabase
        .from('clients')
        .update(updatePayload)
        .eq('id', client.id);

      if (updateError) {
        console.error('Failed to update client config:', updateError);
        return errorResponse('Failed to apply monitoring change', 500);
      }
    }

    // Mark proposal as applied
    await supabase.from('monitoring_proposals').update({
      status: 'applied',
      reviewed_by: user_id,
      reviewed_at: new Date().toISOString(),
      applied_at: new Date().toISOString()
    }).eq('id', proposal_id);

    // Log the action
    await supabase.from('autonomous_actions_log').insert({
      action_type: 'monitoring_proposal_applied',
      trigger_source: 'apply-monitoring-proposal',
      action_details: {
        proposal_id,
        client_id: client.id,
        client_name: client.name,
        proposal_type: proposal.proposal_type,
        proposed_value: proposal.proposed_value,
        approved_by: user_id
      },
      status: 'completed'
    });

    console.log(`Applied monitoring proposal ${proposal_id}: ${proposal.proposal_type} "${proposal.proposed_value}" for ${client.name}`);

    return successResponse({
      success: true,
      action: 'applied',
      proposal_type: proposal.proposal_type,
      proposed_value: proposal.proposed_value,
      client_name: client.name
    });

  } catch (error: any) {
    console.error('Error applying monitoring proposal:', error);
    return errorResponse(error.message || 'Unknown error', 500);
  }
});
