// Aegis Home Voice — Slice 1 reliability state machine (PURE, no I/O).
//
// Derives the canonical loop IDLE → LISTENING → (final transcript) → PROCESSING →
// SPEAKING → LISTENING from the events the OpenAI Realtime hook already receives,
// and emits abstract EFFECTS the hook executes (close/open gate, request/cancel
// response, arm/clear watchdog, telemetry). Keeping it pure makes the loop
// deterministically testable and guarantees recovery to LISTENING — it is NOT a
// parallel voice stack; it consumes the same events `useOpenAIRealtime` handles.

export type VoicePhase = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking';

export type DiscardReason = 'hallucination' | 'duplicate' | 'gate_closed';
export type WatchdogKind = 'processing' | 'speaking';

export type VoiceEvent =
  | { type: 'connect' }
  | { type: 'connected' }
  | { type: 'transcript_final'; accepted: boolean; discardReason?: DiscardReason }
  | { type: 'response_created' }
  | { type: 'request_refused' }
  | { type: 'audio_delta' }
  | { type: 'response_done' }
  | { type: 'watchdog'; which: WatchdogKind }
  | { type: 'gate_reopened' }
  | { type: 'disconnect' }
  | { type: 'error'; kind?: string };

export type VoiceEffect =
  | { kind: 'close_gate' }
  | { kind: 'open_gate' }            // immediate reopen (recovery)
  | { kind: 'schedule_gate_open' }   // tail reopen after a clean response.done
  | { kind: 'request_response' }
  | { kind: 'cancel_response' }
  | { kind: 'arm_watchdog'; which: WatchdogKind }
  | { kind: 'clear_watchdog' }
  | { kind: 'begin_turn' }
  | { kind: 'telemetry'; event: string; data?: Record<string, unknown> };

export interface VoiceTransition {
  phase: VoicePhase;
  effects: VoiceEffect[];
}

// Watchdog budgets (ms). PROCESSING covers response.create → response.created;
// SPEAKING covers response.created/audio → response.done.
export const WATCHDOG_MS: Record<WatchdogKind, number> = {
  processing: 8000,
  speaking: 30000,
};

// Invariant: the mic input gate may be closed ONLY while a response is in flight.
export function gateShouldBeClosed(phase: VoicePhase): boolean {
  return phase === 'processing' || phase === 'speaking';
}

const tel = (event: string, data?: Record<string, unknown>): VoiceEffect => ({ kind: 'telemetry', event, data });

export function voiceTransition(phase: VoicePhase, ev: VoiceEvent): VoiceTransition {
  // Global events valid in any phase.
  switch (ev.type) {
    case 'connect':
      return { phase: 'connecting', effects: [tel('session.start')] };
    case 'disconnect':
      return { phase: 'idle', effects: [{ kind: 'clear_watchdog' }, tel('session.end')] };
    case 'error':
      return { phase: 'idle', effects: [{ kind: 'clear_watchdog' }, tel('error', { kind: ev.kind })] };
    case 'gate_reopened':
      return { phase, effects: [tel('gate.open', { reason: 'tail' })] };
    default:
      break;
  }

  if (phase === 'connecting' && ev.type === 'connected') {
    return { phase: 'listening', effects: [tel('phase.change', { to: 'listening', reason: 'connected' })] };
  }

  if (phase === 'listening' && ev.type === 'transcript_final') {
    if (ev.accepted) {
      return {
        phase: 'processing',
        effects: [
          { kind: 'begin_turn' },
          tel('transcript.final'),
          { kind: 'close_gate' },
          { kind: 'request_response' },
          { kind: 'arm_watchdog', which: 'processing' },
          tel('phase.change', { to: 'processing', reason: 'transcript' }),
        ],
      };
    }
    // Discards (hallucination / duplicate / gate_closed) never stall the loop.
    return { phase: 'listening', effects: [tel('transcript.discarded', { reason: ev.discardReason })] };
  }

  if (phase === 'processing') {
    if (ev.type === 'response_created') {
      return { phase: 'processing', effects: [{ kind: 'clear_watchdog' }, { kind: 'arm_watchdog', which: 'speaking' }, tel('response.created')] };
    }
    if (ev.type === 'audio_delta') {
      return { phase: 'speaking', effects: [tel('speaking.start'), tel('phase.change', { to: 'speaking' })] };
    }
    if (ev.type === 'request_refused') {
      return { phase: 'listening', effects: [{ kind: 'clear_watchdog' }, { kind: 'open_gate' }, tel('response.refused'), tel('recover', { type: 'request_refused' }), tel('phase.change', { to: 'listening', reason: 'refused' })] };
    }
    if (ev.type === 'watchdog' && ev.which === 'processing') {
      return { phase: 'listening', effects: [{ kind: 'cancel_response' }, { kind: 'open_gate' }, tel('recover', { type: 'no_response_created' }), tel('phase.change', { to: 'listening', reason: 'watchdog' })] };
    }
    if (ev.type === 'response_done') {
      // Response finished with no audio (e.g. tool-only turn) — return cleanly.
      return { phase: 'listening', effects: [{ kind: 'clear_watchdog' }, { kind: 'schedule_gate_open' }, tel('response.done', { audio: false })] };
    }
  }

  if (phase === 'speaking') {
    if (ev.type === 'audio_delta') {
      return { phase: 'speaking', effects: [] };
    }
    if (ev.type === 'response_done') {
      return { phase: 'listening', effects: [{ kind: 'clear_watchdog' }, { kind: 'schedule_gate_open' }, tel('speaking.end'), tel('response.done', { audio: true }), tel('phase.change', { to: 'listening', reason: 'response_done' })] };
    }
    if (ev.type === 'watchdog' && ev.which === 'speaking') {
      return { phase: 'listening', effects: [{ kind: 'cancel_response' }, { kind: 'open_gate' }, tel('recover', { type: 'response_stall' }), tel('phase.change', { to: 'listening', reason: 'watchdog' })] };
    }
  }

  // Unexpected event for this phase: do not crash, do not change phase — record it.
  return { phase, effects: [tel('event.ignored', { phase, type: ev.type })] };
}
