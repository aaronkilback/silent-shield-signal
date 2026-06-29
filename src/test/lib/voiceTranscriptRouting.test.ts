import { describe, it, expect } from 'vitest';
import {
  routeFinalTranscript,
  sttOnlySessionUpdate,
  admitVoiceTurn,
  VOICE_DUP_WINDOW_MS,
  type VoiceAdmissionState,
} from '@/lib/voiceTranscriptRouting';

const idle: VoiceAdmissionState = { pending: false, lastNormalized: null, lastAtMs: 0 };

describe('routeFinalTranscript — voice feeds the same Aegis path as typed text', () => {
  it('routes a FINAL non-empty transcript for submission (same as typed send)', () => {
    expect(routeFinalTranscript('what is the threat level for petronas', true))
      .toEqual({ route: true, text: 'what is the threat level for petronas' });
  });
  it('trims surrounding whitespace before submitting', () => {
    expect(routeFinalTranscript('   hello aegis  ', true)).toEqual({ route: true, text: 'hello aegis' });
  });
  it('does NOT route interim (non-final) partials — caption only', () => {
    expect(routeFinalTranscript('what is the th', false)).toEqual({ route: false, reason: 'interim' });
  });
  it('does NOT route empty/whitespace finals', () => {
    expect(routeFinalTranscript('   ', true)).toEqual({ route: false, reason: 'empty' });
    expect(routeFinalTranscript('', true)).toEqual({ route: false, reason: 'empty' });
    expect(routeFinalTranscript(null, true)).toEqual({ route: false, reason: 'empty' });
  });
  it('adds/strips no client/tenant context (text passes through unchanged)', () => {
    // The submit path derives tenant identically for typed + voice; the router
    // must not mutate or annotate the message.
    const r = routeFinalTranscript('scope to client X', true);
    expect(r.text).toBe('scope to client X');
  });
});

describe('admitVoiceTurn — one utterance → one voice turn', () => {
  it('admits one final transcript when idle', () => {
    expect(admitVoiceTurn('what is the threat level', true, idle, 1000))
      .toEqual({ admit: true, text: 'what is the threat level', normalized: 'what is the threat level' });
  });
  it('does NOT admit while a voice turn is pending (no overlapping turns)', () => {
    expect(admitVoiceTurn('another question', true, { ...idle, pending: true }, 1000))
      .toEqual({ admit: false, reason: 'pending' });
  });
  it('does NOT admit a duplicate of the just-admitted utterance within the window', () => {
    const state: VoiceAdmissionState = { pending: false, lastNormalized: 'hello aegis', lastAtMs: 1000 };
    // same utterance re-emitted 500ms later, punctuation/case differ
    expect(admitVoiceTurn('Hello, Aegis.', true, state, 1500)).toEqual({ admit: false, reason: 'duplicate' });
  });
  it('admits the same text again AFTER the dedup window (a genuine repeat ask)', () => {
    const state: VoiceAdmissionState = { pending: false, lastNormalized: 'hello aegis', lastAtMs: 1000 };
    const r = admitVoiceTurn('hello aegis', true, state, 1000 + VOICE_DUP_WINDOW_MS + 1);
    expect(r.admit).toBe(true);
  });
  it('does NOT admit interim partials or empties', () => {
    expect(admitVoiceTurn('what is th', false, idle, 1000)).toEqual({ admit: false, reason: 'interim' });
    expect(admitVoiceTurn('   ', true, idle, 1000)).toEqual({ admit: false, reason: 'empty' });
  });
  it('admission ignores typed-chat loading state entirely (typed never blocked)', () => {
    // The guard takes only voice state; there is no isLoading parameter to gate typed.
    expect(admitVoiceTurn.length).toBe(4); // (text, isFinal, state, nowMs)
  });
});

describe('sttOnlySessionUpdate — realtime is speech-to-text only (no competing brain)', () => {
  it('emits a session.update disabling realtime auto-response', () => {
    const u = sttOnlySessionUpdate();
    expect(u.type).toBe('session.update');
    expect(u.session.turn_detection.create_response).toBe(false);
    expect(u.session.turn_detection.type).toBe('server_vad');
  });
});
