import { describe, it, expect } from 'vitest';
import { categorizeError } from '@/lib/errorTracking';

describe('categorizeError', () => {
  it('detects database constraint violations', () => {
    expect(categorizeError(new Error('violates foreign key constraint'))).toBe('database_constraint');
    expect(categorizeError(new Error('duplicate key value violates unique constraint'))).toBe('database_constraint');
    expect(categorizeError('null value in column violates not-null constraint')).toBe('database_constraint');
  });

  it('detects RLS policy violations', () => {
    expect(categorizeError(new Error('new row violates row-level security policy'))).toBe('rls_policy');
    expect(categorizeError('rls policy blocked this request')).toBe('rls_policy');
  });

  it('detects authentication errors', () => {
    expect(categorizeError(new Error('jwt expired'))).toBe('authentication');
    expect(categorizeError(new Error('invalid token'))).toBe('authentication');
    expect(categorizeError('unauthorized access attempt')).toBe('authentication');
    expect(categorizeError(new Error('auth session missing'))).toBe('authentication');
  });

  it('detects network errors', () => {
    expect(categorizeError(new Error('network request failed'))).toBe('network');
    expect(categorizeError(new Error('fetch failed'))).toBe('network');
    expect(categorizeError('connection refused')).toBe('network');
  });

  it('detects validation errors', () => {
    expect(categorizeError(new Error('validation failed: email is required'))).toBe('validation');
    expect(categorizeError('invalid input: value out of range')).toBe('validation');
  });

  it('detects edge function errors', () => {
    expect(categorizeError(new Error('edge function returned status 500'))).toBe('edge_function');
    expect(categorizeError('supabase function invocation failed')).toBe('edge_function');
  });

  it('categorizes unknown errors as unknown', () => {
    expect(categorizeError(new Error('something completely unexpected happened'))).toBe('unknown');
    expect(categorizeError('random error with no pattern')).toBe('unknown');
  });

  it('handles empty string', () => {
    const result = categorizeError('');
    expect(['unknown', 'validation', 'network', 'authentication', 'database_constraint', 'rls_policy', 'edge_function', 'api_error', 'component_crash']).toContain(result);
  });

  it('handles Error objects with stack traces', () => {
    const err = new Error('network error in component');
    err.stack = 'Error: network error\n    at Component.tsx:42';
    expect(categorizeError(err)).toBe('network');
  });
});
