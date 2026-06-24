import { describe, it, expect } from 'vitest';
import { voiceTransition, gateShouldBeClosed } from '@/components/voice/voiceMachine';
import type { VoiceEvent, VoicePhase, VoiceEffect } from '@/components/voice/voiceMachine';
import { createVoiceTelemetry } from '@/components/voice/voiceTelemetry';

// Mirror of how the hook will wire the pure machine to telemetry.
function runSession(events: Array<{ ev: VoiceEvent; t: number }>, sessionId = 's1') {
  const tel = createVoiceTelemetry(sessionId);
  let phase: VoicePhase = 'idle';
  const effectsLog: VoiceEffect[] = [];
  for (const { ev, t } of events) {
    const out = voiceTransition(phase, ev);
    phase = out.phase;
    for (const e of out.effects) {
      effectsLog.push(e);
      if (e.kind === 'begin_turn') tel.beginTurn();
      else if (e.kind === 'telemetry') tel.emit(e.event, t, e.data);
    }
  }
  return { phase, tel, effectsLog };
}

// One clean turn's events, starting from LISTENING, at base time `t0`.
function cleanTurn(t0: number): Array<{ ev: VoiceEvent; t: number }> {
  return [
    { ev: { type: 'transcript_final', accepted: true }, t: t0 },
    { ev: { type: 'response_created' }, t: t0 + 200 },
    { ev: { type: 'audio_delta' }, t: t0 + 900 },   // speaking.start → latency 900ms
    { ev: { type: 'response_done' }, t: t0 + 4000 },
  ];
}

describe('voiceMachine — Slice 1 reliability', () => {
  it('A1: a clean turn returns to LISTENING and keeps the gate invariant', () => {
    const { phase } = runSession([
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
      ...cleanTurn(100),
    ]);
    expect(phase).toBe('listening');
    expect(gateShouldBeClosed('processing')).toBe(true);
    expect(gateShouldBeClosed('speaking')).toBe(true);
    expect(gateShouldBeClosed('listening')).toBe(false);
  });

  it('A4: one accepted transcript ⇒ exactly one request_response + one begin_turn', () => {
    const { effectsLog } = runSession([
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
      ...cleanTurn(100),
    ]);
    expect(effectsLog.filter((e) => e.kind === 'request_response')).toHaveLength(1);
    expect(effectsLog.filter((e) => e.kind === 'begin_turn')).toHaveLength(1);
  });

  it('A2: PROCESSING watchdog recovers to LISTENING when response.created never arrives', () => {
    const { phase, tel, effectsLog } = runSession([
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
      { ev: { type: 'transcript_final', accepted: true }, t: 100 },
      { ev: { type: 'watchdog', which: 'processing' }, t: 8100 },
    ]);
    expect(phase).toBe('listening');
    expect(effectsLog.some((e) => e.kind === 'cancel_response')).toBe(true);
    expect(effectsLog.some((e) => e.kind === 'open_gate')).toBe(true);
    expect(tel.all().some((r) => r.event === 'recover' && r.data?.type === 'no_response_created')).toBe(true);
  });

  it('A3: SPEAKING watchdog recovers to LISTENING when response.done never arrives', () => {
    const { phase, tel } = runSession([
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
      { ev: { type: 'transcript_final', accepted: true }, t: 100 },
      { ev: { type: 'response_created' }, t: 300 },
      { ev: { type: 'audio_delta' }, t: 900 },
      { ev: { type: 'watchdog', which: 'speaking' }, t: 31000 },
    ]);
    expect(phase).toBe('listening');
    expect(tel.all().some((r) => r.event === 'recover' && r.data?.type === 'response_stall')).toBe(true);
  });

  it('A5: each discard keeps phase LISTENING and emits exactly one transcript.discarded', () => {
    for (const reason of ['hallucination', 'duplicate', 'gate_closed'] as const) {
      const { phase, tel } = runSession([
        { ev: { type: 'connect' }, t: 0 },
        { ev: { type: 'connected' }, t: 10 },
        { ev: { type: 'transcript_final', accepted: false, discardReason: reason }, t: 100 },
      ]);
      expect(phase).toBe('listening');
      const discards = tel.all().filter((r) => r.event === 'transcript.discarded');
      expect(discards).toHaveLength(1);
      expect(discards[0].data?.reason).toBe(reason);
    }
  });

  it('A6: request_refused in PROCESSING recovers to LISTENING (not a silent drop)', () => {
    const { phase, tel, effectsLog } = runSession([
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
      { ev: { type: 'transcript_final', accepted: true }, t: 100 },
      { ev: { type: 'request_refused' }, t: 150 },
    ]);
    expect(phase).toBe('listening');
    expect(effectsLog.some((e) => e.kind === 'open_gate')).toBe(true);
    expect(tel.all().some((r) => r.event === 'recover' && r.data?.type === 'request_refused')).toBe(true);
  });
});

describe('voiceTelemetry — 20-turn proof scorecard', () => {
  it('PASSES on 20 clean consecutive turns (no refresh, no duplicates, no self-hearing, no stuck)', () => {
    const events: Array<{ ev: VoiceEvent; t: number }> = [
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
    ];
    for (let i = 0; i < 20; i++) events.push(...cleanTurn(1000 + i * 5000));
    const { tel } = runSession(events);
    const sc = tel.scorecard(20);
    expect(sc.pass).toBe(true);
    expect(sc.completedTurns).toBe(20);
    expect(sc.duplicateResponses).toBe(0);
    expect(sc.selfHearingEvents).toBe(0);
    expect(sc.stuckTurns).toBe(0);
    expect(sc.reconnects).toBe(0);
    expect(sc.medianLatencyMs).toBe(900);
  });

  it('FAILS the scorecard if Aegis hears its own TTS (gate_closed discard)', () => {
    const events: Array<{ ev: VoiceEvent; t: number }> = [
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
      ...cleanTurn(1000),
      // echo captured during/after playback:
      { ev: { type: 'transcript_final', accepted: false, discardReason: 'gate_closed' }, t: 6000 },
    ];
    const { tel } = runSession(events);
    const sc = tel.scorecard(1);
    expect(sc.selfHearingEvents).toBe(1);
    expect(sc.pass).toBe(false);
    expect(sc.failures.join(' ')).toMatch(/self-hearing/);
  });

  it('FAILS the scorecard on a stuck turn (never returned to LISTENING)', () => {
    const { tel } = runSession([
      { ev: { type: 'connect' }, t: 0 },
      { ev: { type: 'connected' }, t: 10 },
      { ev: { type: 'transcript_final', accepted: true }, t: 100 },
      { ev: { type: 'response_created' }, t: 300 },
      // no audio, no response_done, no recovery — session ends stuck in processing
    ]);
    const sc = tel.scorecard(1);
    expect(sc.stuckTurns).toBe(1);
    expect(sc.pass).toBe(false);
  });
});
