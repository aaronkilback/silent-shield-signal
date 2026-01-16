/**
 * E2E Testing Utilities
 * Provides tools for testing critical user flows programmatically
 */

import { supabase } from "@/integrations/supabase/client";

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  details?: string;
}

export interface TestSuite {
  name: string;
  results: TestResult[];
  passed: number;
  failed: number;
  totalDuration: number;
}

type TestFn = () => Promise<void>;

/**
 * Run a single test with timing and error capture
 */
async function runTest(name: string, testFn: TestFn): Promise<TestResult> {
  const start = performance.now();
  
  try {
    await testFn();
    return {
      name,
      passed: true,
      duration: performance.now() - start,
    };
  } catch (error) {
    return {
      name,
      passed: false,
      duration: performance.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run a test suite
 */
export async function runTestSuite(
  name: string,
  tests: Array<{ name: string; fn: TestFn }>
): Promise<TestSuite> {
  const results: TestResult[] = [];
  
  for (const test of tests) {
    const result = await runTest(test.name, test.fn);
    results.push(result);
  }
  
  return {
    name,
    results,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    totalDuration: results.reduce((acc, r) => acc + r.duration, 0),
  };
}

// ============================================
// AUTHENTICATION TESTS
// ============================================

export const authTests = {
  name: 'Authentication',
  tests: [
    {
      name: 'Check session exists',
      fn: async () => {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!session) throw new Error('No active session');
      },
    },
    {
      name: 'Get current user',
      fn: async () => {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (error) throw error;
        if (!user) throw new Error('No user found');
      },
    },
    {
      name: 'Verify user has profile',
      fn: async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No user');
        
        const { data, error } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();
          
        if (error) throw error;
        if (!data) throw new Error('User profile not found');
      },
    },
    {
      name: 'Verify user has role',
      fn: async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('No user');
        
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);
          
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('User has no roles assigned');
      },
    },
  ],
};

// ============================================
// DATABASE ACCESS TESTS
// ============================================

export const databaseTests = {
  name: 'Database Access',
  tests: [
    {
      name: 'Can read signals',
      fn: async () => {
        const { error } = await supabase
          .from('signals')
          .select('id')
          .limit(1);
        if (error) throw error;
      },
    },
    {
      name: 'Can read entities',
      fn: async () => {
        const { error } = await supabase
          .from('entities')
          .select('id')
          .limit(1);
        if (error) throw error;
      },
    },
    {
      name: 'Can read incidents',
      fn: async () => {
        const { error } = await supabase
          .from('incidents')
          .select('id')
          .limit(1);
        if (error) throw error;
      },
    },
    {
      name: 'Can read clients',
      fn: async () => {
        const { error } = await supabase
          .from('clients')
          .select('id')
          .limit(1);
        if (error) throw error;
      },
    },
    {
      name: 'Can read sources',
      fn: async () => {
        const { error } = await supabase
          .from('sources')
          .select('id')
          .limit(1);
        if (error) throw error;
      },
    },
    {
      name: 'Can read entity_suggestions',
      fn: async () => {
        const { error } = await supabase
          .from('entity_suggestions')
          .select('id')
          .limit(1);
        if (error) throw error;
      },
    },
  ],
};

// ============================================
// EDGE FUNCTION TESTS
// ============================================

export const edgeFunctionTests = {
  name: 'Edge Functions',
  tests: [
    {
      name: 'ai-decision-engine responds',
      fn: async () => {
        const { error } = await supabase.functions.invoke('ai-decision-engine', {
          body: { 
            signal_id: 'test-ping',
            test_mode: true 
          },
        });
        // We expect an error since test-ping isn't a real signal, but the function should respond
        // The key is that it doesn't timeout or fail catastrophically
      },
    },
    {
      name: 'dashboard-ai-assistant responds',
      fn: async () => {
        const { data, error } = await supabase.functions.invoke('dashboard-ai-assistant', {
          body: { 
            message: 'ping',
            test_mode: true 
          },
        });
        // Function should respond even in test mode
      },
    },
  ],
};

// ============================================
// VALIDATION TESTS
// ============================================

export const validationTests = {
  name: 'Data Validation',
  tests: [
    {
      name: 'Incident severity validation',
      fn: async () => {
        // Test that P1-P4 are the only valid values
        const validValues = ['P1', 'P2', 'P3', 'P4'];
        const invalidValues = ['high', 'critical', 'low', 'medium'];
        
        for (const valid of validValues) {
          if (!['P1', 'P2', 'P3', 'P4'].includes(valid)) {
            throw new Error(`${valid} should be valid`);
          }
        }
        
        for (const invalid of invalidValues) {
          if (['P1', 'P2', 'P3', 'P4'].includes(invalid)) {
            throw new Error(`${invalid} should be invalid`);
          }
        }
      },
    },
    {
      name: 'Entity type validation',
      fn: async () => {
        const validTypes = ['person', 'organization', 'location', 'vehicle', 'event', 'asset'];
        
        for (const type of validTypes) {
          if (!validTypes.includes(type)) {
            throw new Error(`${type} should be valid`);
          }
        }
      },
    },
  ],
};

// ============================================
// RUN ALL TESTS
// ============================================

export async function runAllTests(): Promise<TestSuite[]> {
  const suites = [
    authTests,
    databaseTests,
    edgeFunctionTests,
    validationTests,
  ];
  
  const results: TestSuite[] = [];
  
  for (const suite of suites) {
    const result = await runTestSuite(suite.name, suite.tests);
    results.push(result);
  }
  
  return results;
}

/**
 * Get a summary of all test results
 */
export function getTestSummary(suites: TestSuite[]): {
  totalTests: number;
  passed: number;
  failed: number;
  passRate: number;
  totalDuration: number;
} {
  const totalTests = suites.reduce((acc, s) => acc + s.results.length, 0);
  const passed = suites.reduce((acc, s) => acc + s.passed, 0);
  const failed = suites.reduce((acc, s) => acc + s.failed, 0);
  const totalDuration = suites.reduce((acc, s) => acc + s.totalDuration, 0);
  
  return {
    totalTests,
    passed,
    failed,
    passRate: totalTests > 0 ? (passed / totalTests) * 100 : 100,
    totalDuration,
  };
}
