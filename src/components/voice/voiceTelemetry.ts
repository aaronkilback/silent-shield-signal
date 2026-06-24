// Aegis Home Voice — Slice 1 telemetry (client-only ring buffer + scorecard).
//
// Records typed events with a monotonic turn_id so the 20-consecutive-turns proof
// is measurable. NO transcript text and NO tenant/client IDs are stored — only
// event names, reasons, lengths, and timestamps. Timestamps are passed in by the
// caller (the hook supplies Date.now) so this module stays deterministic/testable.

export interface VoiceTelemetryRecord {
  t: number;
  session_id: string;
  turn_id: number;
  event: string;
  data?: Record<string, unknown>;
}

export interface VoiceScorecard {
  targetTurns: number;
  turnsStarted: number;
  completedTurns: number;       // reached response.done(audio) AND returned to listening
  duplicateResponses: number;   // turn_ids with >1 response.created
  selfHearingEvents: number;    // transcript.discarded{reason:gate_closed} (echo captured)
  stuckTurns: number;           // started but never returned to listening
  reconnects: number;           // session.start beyond the first
  recoveries: number;           // watchdog/refusal recoveries (informational)
  latenciesMs: number[];        // transcript.final → speaking.start per completed turn
  medianLatencyMs: number | null;
  pass: boolean;
  failures: string[];
}

export interface VoiceTelemetry {
  beginTurn(): number;
  emit(event: string, t: number, data?: Record<string, unknown>): void;
  all(): VoiceTelemetryRecord[];
  reset(): void;
  scorecard(targetTurns?: number): VoiceScorecard;
}

export function createVoiceTelemetry(sessionId: string, cap = 2000): VoiceTelemetry {
  const buf: VoiceTelemetryRecord[] = [];
  let turnId = 0;

  return {
    beginTurn() {
      turnId += 1;
      return turnId;
    },
    emit(event, t, data) {
      buf.push({ t, session_id: sessionId, turn_id: turnId, event, data });
      if (buf.length > cap) buf.shift();
    },
    all() {
      return buf.slice();
    },
    reset() {
      buf.length = 0;
      turnId = 0;
    },
    scorecard(targetTurns = 20): VoiceScorecard {
      const byTurn = new Map<number, VoiceTelemetryRecord[]>();
      for (const r of buf) {
        if (r.turn_id <= 0) continue;
        const arr = byTurn.get(r.turn_id) ?? [];
        arr.push(r);
        byTurn.set(r.turn_id, arr);
      }
      const turnsStarted = byTurn.size;
      let completedTurns = 0;
      let duplicateResponses = 0;
      let stuckTurns = 0;
      const latenciesMs: number[] = [];

      for (const [, recs] of byTurn) {
        const created = recs.filter((r) => r.event === 'response.created');
        if (created.length > 1) duplicateResponses += 1;
        const finalRec = recs.find((r) => r.event === 'transcript.final');
        const speakStart = recs.find((r) => r.event === 'speaking.start');
        const returned = recs.some(
          (r) => r.event === 'phase.change' && (r.data?.to === 'listening'),
        );
        const doneAudio = recs.some((r) => r.event === 'response.done' && r.data?.audio === true);
        if (doneAudio && returned) completedTurns += 1;
        if (finalRec && !returned) stuckTurns += 1;
        if (finalRec && speakStart) latenciesMs.push(speakStart.t - finalRec.t);
      }

      const selfHearingEvents = buf.filter(
        (r) => r.event === 'transcript.discarded' && r.data?.reason === 'gate_closed',
      ).length;
      const reconnects = Math.max(0, buf.filter((r) => r.event === 'session.start').length - 1);
      const recoveries = buf.filter((r) => r.event === 'recover').length;

      const sorted = [...latenciesMs].sort((a, b) => a - b);
      const medianLatencyMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

      const failures: string[] = [];
      if (completedTurns < targetTurns) failures.push(`only ${completedTurns}/${targetTurns} turns completed`);
      if (duplicateResponses > 0) failures.push(`${duplicateResponses} turn(s) with duplicate responses`);
      if (selfHearingEvents > 0) failures.push(`${selfHearingEvents} self-hearing (gate_closed) event(s)`);
      if (stuckTurns > 0) failures.push(`${stuckTurns} stuck turn(s) (never returned to listening)`);
      if (reconnects > 0) failures.push(`${reconnects} reconnect(s) / manual restart(s)`);

      return {
        targetTurns,
        turnsStarted,
        completedTurns,
        duplicateResponses,
        selfHearingEvents,
        stuckTurns,
        reconnects,
        recoveries,
        latenciesMs,
        medianLatencyMs,
        pass: failures.length === 0,
        failures,
      };
    },
  };
}
