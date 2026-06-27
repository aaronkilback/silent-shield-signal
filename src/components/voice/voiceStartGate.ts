// Tenant-scoped voice start gate (pure, testable).
//
// Guarantees a voice session — and therefore the openai-realtime-token mint + the
// WebRTC connection inside connect() — is NEVER started without an EXPLICIT selected
// tenant. There is no unscoped fallback: the only path to connect() is through an
// allowed decision. The browser-selected tenant merely ROUTES scope; the server
// (voice-tool-executor-v2) remains the authorization boundary.

export interface VoiceTenantContext {
  id?: string | null;
  name?: string | null;
}

export type VoiceStartDecision =
  | { allowed: false; reason: "no_tenant"; message: string }
  | { allowed: true; tenantId: string; tenantName: string | null };

export const SELECT_TENANT_MESSAGE = "Select a tenant on Home to begin before starting voice.";

export function resolveVoiceStart(currentTenant: VoiceTenantContext | null | undefined): VoiceStartDecision {
  if (!currentTenant?.id) {
    return { allowed: false, reason: "no_tenant", message: SELECT_TENANT_MESSAGE };
  }
  return { allowed: true, tenantId: currentTenant.id, tenantName: currentTenant.name ?? null };
}

export interface VoiceStartEffects {
  /** Performs the real voice connect (ephemeral token + WebRTC). Called ONLY when allowed. */
  connect: () => void;
  /** Surfaces the truthful "select a tenant" message to the user. */
  onBlocked: (message: string) => void;
}

export function startVoiceIfAllowed(
  currentTenant: VoiceTenantContext | null | undefined,
  fx: VoiceStartEffects,
): VoiceStartDecision {
  const decision = resolveVoiceStart(currentTenant);
  if (!decision.allowed) {
    fx.onBlocked(decision.message);
    return decision;
  }
  fx.connect();
  return decision;
}
