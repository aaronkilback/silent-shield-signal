// src/test/lib/cop-timeline-writer.test.ts
//
// Unit tests for the Decision Layer C.2 canonical writer.
// Mocks the supabase client; no prod or staging calls.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase client BEFORE importing the module under test.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

import { writeCopTimelineEvent, type CopTimelineEventInput } from '@/lib/cop-timeline-writer';
import { supabase } from '@/integrations/supabase/client';

const baseInput: CopTimelineEventInput = {
  workspace_id: 'workspace-abc',
  title: 'test event',
  event_time: '2026-05-30T12:00:00.000Z',
  event_type: 'general',
  severity: 'info',
};

describe('writeCopTimelineEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns TENANT_LOOKUP_FAILED when the RPC returns an error', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { message: 'connection refused' },
    });

    const result = await writeCopTimelineEvent(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TENANT_LOOKUP_FAILED');
      expect(result.error).toContain('connection refused');
    }
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns TENANT_NOT_RESOLVED when the RPC returns null tenant_id', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await writeCopTimelineEvent(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TENANT_NOT_RESOLVED');
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns INSERT_FAILED when the insert errors', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: 'tenant-xyz',
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'CHECK constraint violated' },
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    const result = await writeCopTimelineEvent(baseInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INSERT_FAILED');
      expect(result.error).toContain('CHECK constraint violated');
    }
  });

  it('returns ok=true and passes the RPC-resolved tenant_id into the insert', async () => {
    const canonicalTenant = 'tenant-from-rpc';
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: canonicalTenant,
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: { id: 'event-id-12345' },
      error: null,
    });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    const result = await writeCopTimelineEvent(baseInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event_id).toBe('event-id-12345');
      expect(result.tenant_id).toBe(canonicalTenant);
    }
    // The insert MUST be called with the RPC's tenant_id, not anything supplied by the caller.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: canonicalTenant }),
    );
    expect(supabase.from).toHaveBeenCalledWith('cop_timeline_events');
  });

  it('the RPC is invoked with p_workspace_id matching the input workspace', async () => {
    (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: 'tenant-xyz',
      error: null,
    });
    const single = vi.fn().mockResolvedValue({ data: { id: 'event' }, error: null });
    const select = vi.fn().mockReturnValue({ single });
    const insert = vi.fn().mockReturnValue({ select });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });

    await writeCopTimelineEvent({ ...baseInput, workspace_id: 'workspace-explicit-id' });

    expect(supabase.rpc).toHaveBeenCalledWith('get_workspace_tenant_id', {
      p_workspace_id: 'workspace-explicit-id',
    });
  });
});
