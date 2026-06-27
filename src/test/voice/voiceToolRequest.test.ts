import { describe, it, expect } from 'vitest';
import { buildVoiceToolRequest } from '@/components/voice/buildVoiceToolRequest';

describe('buildVoiceToolRequest — selected tenant_id routed to voice-tool-executor-v2', () => {
  // ---- Proof 2: the expected tenant_id is sent to the voice tool executor ----
  it('2: sends the selected tenant_id (+ client_id) in the request body', () => {
    const body = buildVoiceToolRequest(
      'get_current_threats',
      { q: 'x' },
      { tenantId: 'petronas-id', clientId: 'petronas-canada' },
    );
    expect(body).toEqual({
      tool_name: 'get_current_threats',
      arguments: { q: 'x' },
      tenant_id: 'petronas-id',
      client_id: 'petronas-canada',
    });
  });

  // ---- Proof 3 (client side): routing only — null scope still routes, server fails closed ----
  it('3: null scope routes null tenant_id (no inferred scope); server remains the authority', () => {
    const body = buildVoiceToolRequest('get_current_threats', {}, { tenantId: null, clientId: null });
    expect(body.tenant_id).toBeNull();
    expect(body.client_id).toBeNull();
  });
});
