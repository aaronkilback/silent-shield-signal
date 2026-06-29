/**
 * Aegis Home voice → Aegis routing (pure).
 *
 * The conversational brain for Aegis Home is the typed-text path
 * (`dashboard-ai-assistant`, tenant-scoped, grounded, full tools). Voice must
 * feed the SAME path: a captured **final** transcript is submitted exactly like
 * typed text. The realtime model is used for speech-to-text only and must not
 * produce a separate, tenant-blind answer.
 *
 * Pure module: no network, no React, no side effects — unit-testable decision
 * logic only. The component wires the decision to its existing `streamChat()`.
 */

export interface TranscriptRouteDecision {
  /** true → submit `text` through the same Aegis path as typed text. */
  route: boolean;
  /** the message to submit (trimmed) when route=true. */
  text?: string;
  /** why not routed (interim/empty) when route=false. */
  reason?: 'interim' | 'empty';
}

/**
 * Decide whether a transcript event should be submitted to Aegis.
 * Only FINAL, non-empty transcripts are submitted (interim partials update the
 * live caption only). The returned `text` is what gets submitted — identical in
 * shape to a typed message, so no client/tenant context is added or stripped
 * here (the submit path derives tenant context the same way for both).
 */
export function routeFinalTranscript(
  text: string | null | undefined,
  isFinal: boolean,
): TranscriptRouteDecision {
  if (!isFinal) return { route: false, reason: 'interim' };
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { route: false, reason: 'empty' };
  return { route: true, text: trimmed };
}

/** Short window in which an identical utterance is treated as a duplicate emit. */
export const VOICE_DUP_WINDOW_MS = 4000;

export function normalizeTranscript(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?,]+/g, '').trim();
}

export interface VoiceAdmissionState {
  /** a voice-originated Aegis turn is currently in flight */
  pending: boolean;
  /** normalized text of the last ADMITTED voice turn (null if none yet) */
  lastNormalized: string | null;
  /** timestamp (ms) the last voice turn was admitted */
  lastAtMs: number;
}

export interface VoiceAdmissionDecision {
  admit: boolean;
  /** message to submit to Aegis (present when admit=true) */
  text?: string;
  /** normalized form the caller should record as last-admitted (when admit=true) */
  normalized?: string;
  reason?: 'interim' | 'empty' | 'pending' | 'duplicate';
}

/**
 * Admission guard: ONE final transcript creates ONE voice-originated Aegis turn.
 *
 * Rejects: interim partials, empties, a final that arrives while a voice turn is
 * still pending (`pending`), and a duplicate of the just-admitted utterance
 * (same normalized text within VOICE_DUP_WINDOW_MS) — so a doubly-emitted final
 * for the same utterance cannot create two messages.
 *
 * Pure: the caller owns the refs and updates them on admit. It deliberately does
 * NOT consider typed-chat loading state, so the typed path is never blocked.
 */
export function admitVoiceTurn(
  text: string | null | undefined,
  isFinal: boolean,
  state: VoiceAdmissionState,
  nowMs: number,
): VoiceAdmissionDecision {
  const routed = routeFinalTranscript(text, isFinal);
  if (!routed.route) return { admit: false, reason: routed.reason };
  if (state.pending) return { admit: false, reason: 'pending' };
  const normalized = normalizeTranscript(routed.text as string);
  if (
    state.lastNormalized !== null &&
    normalized === state.lastNormalized &&
    nowMs - state.lastAtMs < VOICE_DUP_WINDOW_MS
  ) {
    return { admit: false, reason: 'duplicate' };
  }
  return { admit: true, text: routed.text, normalized };
}

/**
 * Realtime session override that makes the session speech-to-text ONLY:
 * server VAD + input transcription stay on, but the model does not
 * auto-generate (or speak) a response — preventing a second, tenant-blind brain
 * from competing with the Aegis answer. Sent as an OpenAI Realtime
 * `session.update` once the session is created.
 */
export function sttOnlySessionUpdate() {
  return {
    type: 'session.update' as const,
    session: {
      turn_detection: {
        type: 'server_vad' as const,
        // Keep detecting speech start/stop (so transcription fires) but do NOT
        // let the realtime model answer — Aegis (dashboard-ai-assistant) answers.
        create_response: false,
      },
    },
  };
}
