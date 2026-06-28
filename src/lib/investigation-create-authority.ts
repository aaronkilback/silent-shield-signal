export type CreateInvestigationV2Args = {
  p_client_id: string;
  p_template_id?: string | null;
  p_incident_id?: string | null;
};

export const buildCreateInvestigationV2Args = ({
  clientId,
  templateId = null,
  incidentId = null,
}: {
  clientId: string;
  templateId?: string | null;
  incidentId?: string | null;
}): CreateInvestigationV2Args => ({
  p_client_id: clientId,
  p_template_id: templateId,
  p_incident_id: incidentId,
});

export const investigationCreateFailureMessage =
  "Failed to create investigation. Check the selected client and try again.";
