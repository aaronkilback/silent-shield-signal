// Alert Delivery v2 — per-alert processing with injectable provider/DB dependencies, so the
// provider-failure and post-provider-DB-finalization paths are testable with mocks (no live
// provider/DB, no shared-credential disturbance).
import { buildSendParams, classifyError, isRecipientAllowedForClient, isSupportedChannel, nextState } from "./lib.ts";

export interface ProviderSendResult { data?: { id?: string } | null; error?: unknown }
export type ProviderSend = (params: ReturnType<typeof buildSendParams>) => Promise<ProviderSendResult>;
export type FinalizeFn = (
  alert: any,
  ns: ReturnType<typeof nextState>,
  classified?: { error_message_safe: string; retryable: boolean },
) => Promise<void>;

export interface ProcessDeps { fromEmail: string; allow: Set<string>; send: ProviderSend; finalize: FinalizeFn }
export interface ProcessResult { outcome: string; error_class?: string; provider_message_id?: string | null; send_calls: number }

/**
 * Process exactly one claimed alert. Truthful-state guarantees:
 *  - unsupported channel / blocked recipient -> 'failed' (explicit class), NO send.
 *  - already-accepted (provider_message_id present) -> finalize 'sent', NO resend (idempotent).
 *  - provider error -> 'failed' (+ sanitized class), NO sent_at.
 *  - provider ACCEPTED but DB finalize FAILS -> DO NOT mark 'failed' and DO NOT resend; leave the
 *    row 'sending' for lease-based recovery (within the provider idempotency window a later resend
 *    is deduped by the Idempotency-Key = delivery_key; past the window the claim RPC moves it to
 *    'requires_reconciliation'). This is the no-duplicate / truthful-state contract.
 */
export async function processClaimedAlert(alert: any, deps: ProcessDeps): Promise<ProcessResult> {
  let send_calls = 0;
  if (!isSupportedChannel(alert.channel)) {
    await deps.finalize(alert, nextState({ kind: "unsupported_channel" }));
    return { outcome: "unsupported_channel", send_calls };
  }
  // Send-time re-verify is a PER-CLIENT PAIR check: the alert's resolved client (__client_id, set
  // by the handler from incident_id -> incidents.client_id) AND the recipient must both match an
  // active+verified client_alert_recipients row. Blocks the cross-client hole (email verified for
  // client A must not send client B's alert) and any TOCTOU deactivation between claim and send.
  if (!isRecipientAllowedForClient(alert.__client_id, alert.recipient, deps.allow)) {
    await deps.finalize(alert, nextState({ kind: "recipient_blocked" }));
    return { outcome: "recipient_blocked", send_calls };
  }
  if (alert.provider_message_id) {
    await deps.finalize(alert, nextState({ kind: "accepted", provider_message_id: alert.provider_message_id }));
    return { outcome: "already_accepted_finalized", provider_message_id: alert.provider_message_id, send_calls };
  }

  // 1) Provider send (only the send is guarded for the failure classification).
  let result: ProviderSendResult;
  try {
    send_calls++;
    result = await deps.send(buildSendParams(deps.fromEmail, alert));
    if (result.error) throw result.error;
  } catch (e) {
    const classified = classifyError(e);
    await deps.finalize(alert, nextState({ kind: "failed", classified }), classified);
    return { outcome: "failed", error_class: classified.error_class, send_calls };
  }

  // 2) Provider ACCEPTED. Finalize separately: a DB failure here must NOT mark 'failed' and must
  //    NOT trigger a resend — leave 'sending' for recovery.
  const pmid = result.data?.id ?? null;
  try {
    await deps.finalize(alert, nextState({ kind: "accepted", provider_message_id: pmid }));
    return { outcome: "sent", provider_message_id: pmid, send_calls };
  } catch (_dbErr) {
    return { outcome: "accepted_unfinalized", provider_message_id: pmid, send_calls };
  }
}
