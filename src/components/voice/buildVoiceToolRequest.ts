// Builds the request body sent to the server-side voice tool executor.
//
// The scope (tenant_id / client_id) carried here comes from the operator's CURRENT
// selected tenant + client. It ROUTES the request; the server (voice-tool-executor-v2)
// independently re-validates the caller's JWT + tenant membership + client ownership
// and fails closed (SCOPE_MISSING) on a forged/unauthorized tenant_id.

export interface VoiceScope {
  tenantId: string | null;
  clientId: string | null;
}

export interface VoiceToolRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
  tenant_id: string | null;
  client_id: string | null;
}

export function buildVoiceToolRequest(
  toolName: string,
  toolArgs: Record<string, unknown>,
  scope: VoiceScope,
): VoiceToolRequest {
  return {
    tool_name: toolName,
    arguments: toolArgs,
    tenant_id: scope.tenantId,
    client_id: scope.clientId,
  };
}
