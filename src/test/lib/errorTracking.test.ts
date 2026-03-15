import { describe, it, expect } from 'vitest';
import { categorizeError, determineSeverity } from '@/lib/errorTracking';

// Real categorizeError priority order (from source):
// 1. rls_policy:        'row-level security' | 'rls'
// 2. database_constraint: 'constraint' | 'violates' | 'duplicate key'
// 3. validation:        'validation' | 'invalid' | 'required'
// 4. network:           'network' | 'fetch' | 'timeout'
// 5. authentication:    'auth' | 'unauthorized' | 'jwt'
// 6. edge_function:     'edge function' | 'function invocation'
// 7. api_error:         'api' | '500' | '404'
// 8. unknown:           everything else

describe('categorizeError', () => {
  describe('rls_policy (highest priority)', () => {
    it('detects row-level security violations', () => {
      expect(categorizeError(new Error('new row violates row-level security policy'))).toBe('rls_policy');
    });
    it('detects rls keyword', () => {
      expect(categorizeError('rls policy blocked this request')).toBe('rls_policy');
    });
  });

  describe('database_constraint', () => {
    it('detects constraint keyword', () => {
      expect(categorizeError(new Error('violates foreign key constraint'))).toBe('database_constraint');
    });
    it('detects violates keyword', () => {
      expect(categorizeError('null value violates not-null constraint')).toBe('database_constraint');
    });
    it('detects duplicate key', () => {
      expect(categorizeError(new Error('duplicate key value in column'))).toBe('database_constraint');
    });
  });

  describe('validation (priority 3 — before network and auth)', () => {
    it('detects validation keyword', () => {
      expect(categorizeError(new Error('validation failed: email missing'))).toBe('validation');
    });
    it('detects invalid keyword', () => {
      // "invalid token" matches 'invalid' before 'auth' — returns validation
      expect(categorizeError(new Error('invalid token'))).toBe('validation');
    });
    it('detects required keyword', () => {
      expect(categorizeError('email is required')).toBe('validation');
    });
  });

  describe('network (priority 4)', () => {
    it('detects network keyword', () => {
      expect(categorizeError(new Error('network request failed'))).toBe('network');
    });
    it('detects fetch keyword', () => {
      expect(categorizeError(new Error('fetch error occurred'))).toBe('network');
    });
    it('detects timeout keyword', () => {
      expect(categorizeError('request timed out after 30s')).toBe('network');
    });
  });

  describe('authentication (priority 5 — only if no earlier match)', () => {
    it('detects auth keyword', () => {
      expect(categorizeError(new Error('auth session missing or expired'))).toBe('authentication');
    });
    it('detects unauthorized keyword', () => {
      expect(categorizeError('unauthorized access attempt')).toBe('authentication');
    });
    it('detects jwt keyword', () => {
      expect(categorizeError(new Error('jwt expired'))).toBe('authentication');
    });
  });

  describe('edge_function', () => {
    it('detects edge function keyword', () => {
      expect(categorizeError(new Error('edge function returned status 500'))).toBe('edge_function');
    });
    it('detects function invocation keyword', () => {
      expect(categorizeError('function invocation failed')).toBe('edge_function');
    });
  });

  describe('api_error', () => {
    it('detects api keyword', () => {
      expect(categorizeError(new Error('api call returned error'))).toBe('api_error');
    });
    it('detects 500 status', () => {
      expect(categorizeError('server responded with 500')).toBe('api_error');
    });
    it('detects 404 status', () => {
      expect(categorizeError('resource not found 404')).toBe('api_error');
    });
  });

  describe('unknown (fallback)', () => {
    it('returns unknown for unrecognised messages', () => {
      expect(categorizeError(new Error('something completely unexpected happened'))).toBe('unknown');
    });
    it('returns unknown for empty string', () => {
      expect(categorizeError('')).toBe('unknown');
    });
  });
});

describe('determineSeverity', () => {
  it('returns critical for rls_policy', () => {
    expect(determineSeverity('rls_policy', 'rls error')).toBe('critical');
  });
  it('returns critical for authentication', () => {
    expect(determineSeverity('authentication', 'auth error')).toBe('critical');
  });
  it('returns high for database_constraint', () => {
    expect(determineSeverity('database_constraint', 'constraint error')).toBe('high');
  });
  it('returns medium for validation', () => {
    expect(determineSeverity('validation', 'validation error')).toBe('medium');
  });
  it('returns medium for edge_function', () => {
    expect(determineSeverity('edge_function', 'edge fn error')).toBe('medium');
  });
  it('returns medium for api_error', () => {
    expect(determineSeverity('api_error', 'api error')).toBe('medium');
  });
  it('returns critical for unknown category with critical keyword', () => {
    expect(determineSeverity('unknown', 'fatal crash occurred')).toBe('critical');
  });
  it('returns low for unknown category with no severe keywords', () => {
    expect(determineSeverity('unknown', 'something minor happened')).toBe('low');
  });
});
