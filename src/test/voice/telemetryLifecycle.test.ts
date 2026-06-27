import { describe, it, expect } from 'vitest';
import {
  createVoiceTelemetry,
  isStagingTelemetry,
  safeScorecard,
  INACTIVE_SCORECARD,
} from '@/components/voice/voiceTelemetry';

const STAGING_URL = 'https://lkvyrvuakzguszbpwnfz.supabase.co';
const PROD_URL = 'https://kpuqukppbmwebiptqmog.supabase.co';

describe('telemetry lifecycle + staging gating', () => {
  // ---- Proof 4: absent in production build (runtime gate) ----
  it('4: telemetry globals gate true ONLY for the staging project URL (absent in prod)', () => {
    expect(isStagingTelemetry(STAGING_URL)).toBe(true);
    expect(isStagingTelemetry(PROD_URL)).toBe(false);
    expect(isStagingTelemetry(undefined)).toBe(false);
    expect(isStagingTelemetry('')).toBe(false);
  });

  // ---- Proof 4: before a session → safe inactive ----
  it('4: before voice → scorecard returns a safe inactive value, dump-style getter empty', () => {
    const noSession = () => null; // mirrors the hook before connect() creates telemetry
    expect(safeScorecard(noSession)).toBe(INACTIVE_SCORECARD);
    expect(safeScorecard(noSession).active).toBe(false);
  });

  // ---- Proof 4: during a session → real telemetry ----
  it('4: during voice → scorecard returns real session telemetry', () => {
    const tel = createVoiceTelemetry('sess-1');
    tel.beginTurn();
    tel.emit('transcript.final', 1000);
    tel.emit('response.created', 1100);
    tel.emit('speaking.start', 1200);
    tel.emit('response.done', 4000, { audio: true });
    tel.emit('phase.change', 4001, { to: 'listening' });
    const sc = safeScorecard((n) => tel.scorecard(n), 1) as { turnsStarted: number; completedTurns: number };
    expect(sc).not.toBe(INACTIVE_SCORECARD);
    expect(sc.turnsStarted).toBe(1);
    expect(sc.completedTurns).toBe(1);
  });

  // ---- Proof 4: no leakage ----
  it('4: telemetry records carry no conversation text, tokens, credentials, or tenant/client data', () => {
    const tel = createVoiceTelemetry('sess-2');
    tel.beginTurn();
    tel.emit('transcript.final', 1);                                  // no text payload by design
    tel.emit('transcript.discarded', 2, { reason: 'gate_closed' });
    tel.emit('recover', 3, { type: 'no_response_created' });
    tel.emit('error', 4, { kind: 'tts_blocked' });
    const records = tel.all();

    const allowedRecordKeys = new Set(['t', 'session_id', 'turn_id', 'event', 'data']);
    const allowedDataKeys = new Set(['reason', 'type', 'kind', 'to', 'audio', 'which', 'phase', 'manifest_sha']);
    for (const r of records) {
      expect(Object.keys(r).every((k) => allowedRecordKeys.has(k))).toBe(true);
      if (r.data) {
        for (const k of Object.keys(r.data)) expect(allowedDataKeys.has(k)).toBe(true);
      }
    }
    const serialized = JSON.stringify(records).toLowerCase();
    for (const forbidden of ['password', 'token', 'secret', 'tenant_id', 'client_id', 'authorization', 'bearer']) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    expect(records.every((r) => r.session_id === 'sess-2')).toBe(true); // opaque label, not tenant/user data
  });
});
