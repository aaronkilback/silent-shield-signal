/**
 * Fortress Chaos Monkey
 * Deliberately sends bad data and edge cases to verify platform resilience.
 * Runs weekly on Sundays at 3am UTC via pg_cron.
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createServiceClient();

    // Get Petronas Canada client_id
    const { data: petronasData } = await supabase
      .from('clients')
      .select('id')
      .ilike('name', '%petronas%')
      .single();

    const PETRONAS_CLIENT_ID = petronasData?.id;

    const chaosTests: {
      name: string;
      run: () => Promise<{ passed: boolean; expected: string; actual: string }>;
    }[] = [
      {
        name: 'feedback_nonexistent_signal',
        run: async () => {
          const resp = await supabase.from('signal_feedback').insert({
            signal_id: '00000000-0000-0000-0000-000000000000',
            feedback_type: 'relevant',
            feedback_source: 'chaos_monkey'
          });
          return {
            passed: !!resp.error,
            expected: 'Foreign key violation — invalid signal_id rejected',
            actual: resp.error ? 'Correctly rejected' : 'PROBLEM: accepted invalid signal_id'
          };
        }
      },
      {
        name: 'ingest_empty_text',
        run: async () => {
          const resp = await supabase.functions.invoke('ingest-signal', {
            body: { text: '', sourceType: 'qa_test', sourceData: { source_name: 'Chaos' }, clientId: PETRONAS_CLIENT_ID }
          });
          return {
            passed: !!resp.error,
            expected: 'Validation error for empty signal text',
            actual: resp.error ? 'Correctly rejected' : 'PROBLEM: accepted empty signal text'
          };
        }
      },
      {
        name: 'report_invalid_client',
        run: async () => {
          const resp = await supabase.functions.invoke('generate-executive-report', {
            body: { clientId: '00000000-0000-0000-0000-000000000000' }
          });
          return {
            passed: !!resp.error || !!resp.data?.error,
            expected: 'Graceful error for invalid client ID',
            actual: resp.error ? 'Correctly errored' : 'PROBLEM: accepted invalid client ID'
          };
        }
      },
      {
        name: 'rapid_aegis_messages',
        run: async () => {
          const { data: aegis } = await supabase.from('ai_agents').select('id').eq('call_sign', 'AEGIS-CMD').single();
          if (!aegis) return { passed: false, expected: 'AEGIS exists', actual: 'Not found' };
          const results = await Promise.allSettled(
            Array(5).fill(null).map((_, i) =>
              supabase.functions.invoke('agent-chat', {
                body: { agentId: aegis.id, messages: [{ role: 'user', content: `Rapid chaos test ${i}` }], clientId: PETRONAS_CLIENT_ID }
              })
            )
          );
          const passedCount = results.filter((r: any) => r.status === 'fulfilled' && !r.value.error).length;
          return {
            passed: passedCount >= 3,
            expected: 'At least 3 of 5 rapid concurrent messages succeed',
            actual: `${passedCount}/5 succeeded`
          };
        }
      },
      {
        name: 'very_long_signal_text',
        run: async () => {
          const resp = await supabase.functions.invoke('ingest-signal', {
            body: {
              text: 'Petronas Canada pipeline threat. '.repeat(500),
              sourceType: 'qa_test',
              sourceData: { source_name: 'Chaos', url: 'https://qa.test/long' },
              clientId: PETRONAS_CLIENT_ID
            }
          });
          return {
            passed: !resp.error,
            expected: 'Very long signal text handled gracefully',
            actual: resp.error ? `PROBLEM: crashed with ${resp.error.message}` : 'Handled gracefully'
          };
        }
      }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of chaosTests) {
      const start = Date.now();
      try {
        const result = await test.run();
        if (result.passed) passed++; else failed++;

        await supabase.from('qa_test_results').insert({
          test_suite: 'chaos_monkey',
          test_name: test.name,
          passed: result.passed,
          expected_outcome: result.expected,
          actual_outcome: result.actual,
          error_message: result.passed ? null : result.actual,
          response_time_ms: Date.now() - start,
          is_known_broken: false,
          severity: 'medium'
        });

        console.log(`[Chaos] ${result.passed ? '✓' : '✗'} ${test.name} — ${result.actual}`);
      } catch (err: any) {
        failed++;
        await supabase.from('qa_test_results').insert({
          test_suite: 'chaos_monkey',
          test_name: test.name,
          passed: false,
          expected_outcome: 'Test completes without throwing',
          actual_outcome: `Exception: ${err.message}`,
          error_message: err.message,
          response_time_ms: Date.now() - start,
          is_known_broken: false,
          severity: 'high'
        });
        console.error(`[Chaos] EXCEPTION ${test.name}: ${err.message}`);
      }
    }

    console.log(`[Chaos Monkey] Complete: ${passed} passed, ${failed} failed`);

    return successResponse({ success: true, total: chaosTests.length, passed, failed });
  } catch (error: any) {
    console.error('[Chaos Monkey] Fatal error:', error);
    return errorResponse(`Chaos Monkey failed: ${error.message}`, 500);
  }
});
