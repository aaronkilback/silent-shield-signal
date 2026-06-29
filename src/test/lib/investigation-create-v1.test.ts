import { describe, it, expect } from 'vitest';
import {
  buildCreateInvestigationV1Args,
  extractInvestigationRow,
  safeCreateInvestigationMessage,
  CreateInvestigationBlocked,
  CREATE_INVESTIGATION_RPC,
} from '@/lib/investigation-create-v1';

const USER = 'b1111111-1111-4111-8111-111111111111';
const CLIENT = '7f3cc94a-abda-49ef-9cb2-b57a8eb31dd7';

describe('CREATE_INVESTIGATION_RPC', () => {
  it('targets the existing production v1 RPC', () => {
    expect(CREATE_INVESTIGATION_RPC).toBe('create_investigation');
  });
});

describe('buildCreateInvestigationV1Args — argument construction', () => {
  it('maps client (request) + authenticated identity into v1 args', () => {
    const args = buildCreateInvestigationV1Args({
      userId: USER, userEmail: 'a@b.co', profileName: 'Aaron K', selectedClientId: CLIENT,
    });
    expect(args).toEqual({ p_client_id: CLIENT, p_prepared_by: USER, p_created_by_name: 'Aaron K' });
  });
  it('p_prepared_by comes ONLY from the authenticated user id', () => {
    const args = buildCreateInvestigationV1Args({ userId: USER, profileName: 'X', selectedClientId: CLIENT });
    expect(args.p_prepared_by).toBe(USER);
  });
  it('created_by_name falls back profileName -> email -> Unknown (never UI text)', () => {
    expect(buildCreateInvestigationV1Args({ userId: USER, userEmail: 'a@b.co', selectedClientId: CLIENT }).p_created_by_name).toBe('a@b.co');
    expect(buildCreateInvestigationV1Args({ userId: USER, selectedClientId: CLIENT }).p_created_by_name).toBe('Unknown');
  });
});

describe('buildCreateInvestigationV1Args — blocks BEFORE any RPC call', () => {
  it('no authenticated user -> throws no-auth (create cannot reach the RPC)', () => {
    expect(() => buildCreateInvestigationV1Args({ userId: null, selectedClientId: CLIENT }))
      .toThrowError(CreateInvestigationBlocked);
    try { buildCreateInvestigationV1Args({ userId: '', selectedClientId: CLIENT }); }
    catch (e) { expect((e as CreateInvestigationBlocked).reason).toBe('no-auth'); }
  });
  it('no selected client -> throws no-client (v1 requires a client)', () => {
    try { buildCreateInvestigationV1Args({ userId: USER, selectedClientId: null }); expect.unreachable(); }
    catch (e) { expect((e as CreateInvestigationBlocked).reason).toBe('no-client'); }
  });
});

describe('extractInvestigationRow — server row is canonical', () => {
  it('returns the object row (carrying the server-issued file_number)', () => {
    const row = extractInvestigationRow<{ id: string; file_number: string }>({ id: 'i1', file_number: 'INV-2026-0007' });
    expect(row?.file_number).toBe('INV-2026-0007');
  });
  it('normalises a 1-element array to the row', () => {
    expect(extractInvestigationRow<{ file_number: string }>([{ file_number: 'INV-2026-0008' }])?.file_number).toBe('INV-2026-0008');
  });
  it('returns null for empty/missing', () => {
    expect(extractInvestigationRow(null)).toBeNull();
    expect(extractInvestigationRow([])).toBeNull();
  });
});

describe('safeCreateInvestigationMessage — no raw DB text', () => {
  it('does NOT surface a raw Postgres unique-violation message', () => {
    const raw = 'duplicate key value violates unique constraint "investigations_file_number_key"';
    const msg = safeCreateInvestigationMessage(new Error(raw));
    expect(msg).toBe('Could not create the investigation. Please try again.'); // generic, no DB text
    expect(msg).not.toContain('investigations_file_number_key');
    expect(msg).not.toContain('duplicate key');
  });
  it('does NOT surface a raw RPC authorization message', () => {
    const raw = 'create_investigation: caller 123 not authorized to create investigations for client 456';
    const msg = safeCreateInvestigationMessage(new Error(raw));
    expect(msg).not.toContain('create_investigation:');
    expect(msg).not.toContain('not authorized');
  });
  it('passes through our own safe pre-flight messages', () => {
    expect(safeCreateInvestigationMessage(new CreateInvestigationBlocked('no-client', 'Select a client before creating an investigation.')))
      .toBe('Select a client before creating an investigation.');
  });
});
