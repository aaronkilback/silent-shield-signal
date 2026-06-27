import { describe, it, expect, vi } from 'vitest';
import { resolveVoiceStart, startVoiceIfAllowed, SELECT_TENANT_MESSAGE } from '@/components/voice/voiceStartGate';

describe('voiceStartGate — tenant-scoped voice gate', () => {
  // ---- Proof 1: no selected tenant ----
  it('1: no selected tenant → decision blocked with the select-tenant message', () => {
    expect(resolveVoiceStart(null)).toEqual({ allowed: false, reason: 'no_tenant', message: SELECT_TENANT_MESSAGE });
    expect(resolveVoiceStart({ id: null, name: 'x' }).allowed).toBe(false);
    expect(resolveVoiceStart({ id: undefined }).allowed).toBe(false);
  });

  it('1: no tenant → connect() (openai-realtime-token + WebRTC + tool request) is NEVER called; user told to select a tenant', () => {
    const connect = vi.fn();
    const onBlocked = vi.fn();
    const d = startVoiceIfAllowed(null, { connect, onBlocked });
    expect(d.allowed).toBe(false);
    expect(connect).not.toHaveBeenCalled(); // the ONLY path to the token mint / WebRTC / tool request
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onBlocked).toHaveBeenCalledWith(SELECT_TENANT_MESSAGE);
  });

  // ---- Proof 2: explicit selected tenant ----
  it('2: explicit tenant → decision allowed with tenantId + visible name', () => {
    expect(resolveVoiceStart({ id: 'petronas-id', name: 'Petronas Tenant' }))
      .toEqual({ allowed: true, tenantId: 'petronas-id', tenantName: 'Petronas Tenant' });
  });

  it('2: explicit tenant → connect() is invoked exactly once, nothing blocked', () => {
    const connect = vi.fn();
    const onBlocked = vi.fn();
    const d = startVoiceIfAllowed({ id: 'petronas-id', name: 'Petronas Tenant' }, { connect, onBlocked });
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.tenantId).toBe('petronas-id');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
