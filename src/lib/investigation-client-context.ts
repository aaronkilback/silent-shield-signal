export type TenantClientIds = string[] | null | undefined;

type InvestigationClientContextResult =
  | { ok: true; clientId: string }
  | { ok: false; message: string };

export const resolveInvestigationClientContext = ({
  selectedClientId,
  tenantClientIds,
}: {
  selectedClientId: string | null | undefined;
  tenantClientIds: TenantClientIds;
}): InvestigationClientContextResult => {
  if (selectedClientId) {
    if (Array.isArray(tenantClientIds) && !tenantClientIds.includes(selectedClientId)) {
      return {
        ok: false,
        message: "Select a client within the current tenant before creating an investigation.",
      };
    }

    return { ok: true, clientId: selectedClientId };
  }

  if (tenantClientIds === undefined) {
    return {
      ok: false,
      message: "Client context is still loading. Try again in a moment.",
    };
  }

  if (Array.isArray(tenantClientIds) && tenantClientIds.length === 0) {
    return {
      ok: false,
      message: "No eligible clients are available for this tenant.",
    };
  }

  return {
    ok: false,
    message: "Select a client before creating an investigation.",
  };
};

export const buildInvestigationInsertPayload = ({
  fileNumber,
  preparedBy,
  createdByName,
  clientId,
}: {
  fileNumber: string;
  preparedBy: string;
  createdByName: string;
  clientId: string;
}) => ({
  file_number: fileNumber,
  prepared_by: preparedBy,
  created_by_name: createdByName,
  client_id: clientId,
});
