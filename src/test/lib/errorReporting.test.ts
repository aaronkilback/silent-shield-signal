import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/integrations/supabase/client';
import { reportError } from '@/lib/errorReporting';

// reportError inserts: user_id, title, description, severity, page_url, browser_info
// It does NOT insert a status field — the DB default handles that

describe('reportError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a bug report with title prefixed [Auto]', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({ insert: insertMock });

    await reportError({
      title: 'Signal processor crashed',
      description: 'Unexpected null reference',
      severity: 'high',
    });

    expect(supabase.from).toHaveBeenCalledWith('bug_reports');
    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.title).toBe('[Auto] Signal processor crashed');
    expect(insertArg.severity).toBe('high');
  });

  it('inserts description, page_url, and browser_info fields', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({ insert: insertMock });

    await reportError({
      title: 'Test',
      description: 'Base description',
      severity: 'low',
    });

    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.description).toBe('Base description');
    expect(insertArg).toHaveProperty('page_url');
    expect(insertArg).toHaveProperty('browser_info');
  });

  it('appends error stack to description when Error object provided', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({ insert: insertMock });

    const err = new Error('Cannot read properties of undefined');
    err.stack = 'Error: Cannot read properties\n    at SignalProcessor.tsx:99';

    await reportError({
      title: 'Runtime error',
      description: 'Base description',
      severity: 'critical',
      error: err,
    });

    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.description).toContain('Cannot read properties of undefined');
    expect(insertArg.description).toContain('Stack');
    expect(insertArg.description).toContain('SignalProcessor.tsx:99');
  });

  it('appends context string to description when provided', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({ insert: insertMock });

    await reportError({
      title: 'Map load failed',
      description: 'Mapbox failed to initialize',
      severity: 'medium',
      context: 'TravelersMap component on /travel route',
    });

    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.description).toContain('TravelersMap component on /travel route');
  });

  it('includes user_id from auth when available', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({ insert: insertMock });

    await reportError({
      title: 'Auth error',
      description: 'Session expired mid-operation',
      severity: 'low',
    });

    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg.user_id).toBe('test-user-id');
  });

  it('does not throw when Supabase insert fails', async () => {
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: new Error('DB unavailable') });
    (supabase.from as any).mockReturnValue({ insert: insertMock });

    await expect(reportError({
      title: 'Background error',
      description: 'Something failed quietly',
      severity: 'low',
    })).resolves.not.toThrow();
  });

  it('does not throw when auth.getUser fails', async () => {
    (supabase.auth.getUser as any).mockRejectedValueOnce(new Error('Auth service down'));
    const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({ insert: insertMock });

    await expect(reportError({
      title: 'Error during auth outage',
      description: 'Should still attempt to log',
      severity: 'medium',
    })).resolves.not.toThrow();
  });
});
