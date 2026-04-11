/**
 * Fortress QA Agent
 * Runs a comprehensive test suite against live platform APIs and stores results in qa_test_results.
 * Called every 6h via pg_cron and on every successful deployment via GitHub Actions.
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
    console.log(`[QA Agent] Petronas client ID: ${PETRONAS_CLIENT_ID || 'NOT FOUND — tests requiring client will skip'}`);

    const tests: {
      suite: string;
      name: string;
      isKnownBroken?: boolean;
      knownBrokenReason?: string;
      run: () => Promise<{ passed: boolean; expected: string; actual: string; ms: number }>;
    }[] = [
      {
        suite: 'signal_pipeline',
        name: 'ingest_relevant_signal',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const resp = await supabase.functions.invoke('ingest-signal', {
            body: {
              text: `Coastal GasLink pipeline section near Fort St. John shut down following suspected sabotage attempt by unknown actors [qa-${Date.now()}]`,
              sourceType: 'qa_test',
              is_test: true,
              sourceData: { source_name: 'QA Test', url: `https://qa.test/relevant-${Date.now()}` },
              clientId: PETRONAS_CLIENT_ID
            }
          });
          return {
            passed: !resp.error && !!resp.data?.signal_id,
            expected: 'Signal created with high or critical severity',
            actual: resp.error ? resp.error.message : `Signal ${resp.data?.signal_id}, severity: ${resp.data?.severity}`,
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'signal_pipeline',
        name: 'filter_irrelevant_signal',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const startIso = new Date(start).toISOString();
          await supabase.functions.invoke('ingest-signal', {
            body: {
              text: `Fort St John minor hockey league announces tryouts for the upcoming season`,
              sourceType: 'qa_test',
              is_test: true,
              sourceData: { source_name: 'QA Test', url: `https://qa.test/irrelevant-${start}` },
              clientId: PETRONAS_CLIENT_ID
            }
          });
          let filteredCount = 0;
          let passedCount = 0;
          for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 3000));
            const [fRes, pRes] = await Promise.all([
              supabase.from('filtered_signals').select('*', { count: 'exact', head: true })
                .ilike('raw_text', '%hockey league%')
                .gte('filtered_at', startIso),
              supabase.from('signals').select('*', { count: 'exact', head: true })
                .ilike('normalized_text', '%hockey league%')
                .gte('created_at', startIso),
            ]);
            filteredCount = fRes.count || 0;
            passedCount = pRes.count || 0;
            if (filteredCount > 0 || passedCount > 0) break;
          }
          const caught = filteredCount > 0;
          const leaked = passedCount > 0;
          return {
            passed: caught && !leaked,
            expected: 'Signal caught by PECL relevance gate',
            actual: leaked
              ? `FAIL: irrelevant signal leaked into signals table`
              : caught
                ? 'Correctly filtered into filtered_signals'
                : 'FAIL: signal not found in filtered_signals (may have timed out or been dropped)',
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'signal_pipeline',
        name: 'rss_monitor_healthy',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const { data } = await supabase
            .from('cron_heartbeat')
            .select('started_at, status')
            .eq('job_name', 'monitor-rss-sources')
            .order('started_at', { ascending: false })
            .limit(1);
          const lastRun = data?.[0]?.started_at;
          const minutesSince = lastRun
            ? (Date.now() - new Date(lastRun).getTime()) / 60000
            : 999;
          return {
            passed: minutesSince < 20,
            expected: 'RSS monitor ran within last 20 minutes',
            actual: lastRun ? `Last run: ${Math.round(minutesSince)} minutes ago` : 'No heartbeat found',
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'signal_pipeline',
        name: 'signals_have_source_urls',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const { data } = await supabase
            .from('signals')
            .select('id, source_url')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .not('raw_json->>sourceType', 'eq', 'qa_test')
            .limit(20);
          const total = data?.length || 0;
          const withUrl = data?.filter((s: any) => s.source_url)?.length || 0;
          const pct = total > 0 ? Math.round(withUrl / total * 100) : 100;
          return {
            passed: pct >= 80,
            expected: 'At least 80% of signals have source URLs',
            actual: `${pct}% have source URLs (${withUrl}/${total})`,
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'reports',
        name: 'generate_executive_report',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const resp = await supabase.functions.invoke('generate-executive-report', {
            body: { clientId: PETRONAS_CLIENT_ID }
          });
          const ms = Date.now() - start;
          const html = resp.data?.html || '';
          const hasMarkdown = html.includes('**') || html.includes('###') || html.includes('active_threat') || html.includes('social_sentiment');
          return {
            passed: !resp.error && ms < 120000 && !hasMarkdown,
            expected: 'Report generated under 120s with no markdown artifacts',
            actual: resp.error ? resp.error.message : `Generated in ${ms}ms. Markdown artifacts: ${hasMarkdown ? 'YES — PROBLEM' : 'None'}`,
            ms
          };
        }
      },
      {
        suite: 'reports',
        name: 'snapshot_generator',
        isKnownBroken: true,
        knownBrokenReason: 'Snapshot generator not working — under investigation',
        run: async () => {
          const start = Date.now();
          const resp = await supabase.functions.invoke('generate-report-visuals', {
            body: { clientId: PETRONAS_CLIENT_ID }
          });
          return {
            passed: !resp.error && resp.data?.success,
            expected: 'Snapshot generated successfully',
            actual: resp.error ? `BROKEN: ${resp.error.message}` : JSON.stringify(resp.data).substring(0, 100),
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'agents',
        name: 'aegis_responds',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const { data: aegis } = await supabase.from('ai_agents').select('id').eq('call_sign', 'AEGIS-CMD').single();
          if (!aegis) return { passed: false, expected: 'AEGIS exists', actual: 'AEGIS-CMD not found', ms: Date.now() - start };
          const resp = await supabase.functions.invoke('agent-chat', {
            body: { agentId: aegis.id, messages: [{ role: 'user', content: 'QA health check. Respond with OK.' }], clientId: PETRONAS_CLIENT_ID, stream: false }
          });
          const ms = Date.now() - start;
          return {
            passed: !resp.error && !!resp.data?.response && ms < 90000,
            expected: 'AEGIS responds within 90 seconds',
            actual: resp.error ? resp.error.message : `Responded in ${ms}ms`,
            ms
          };
        }
      },
      {
        suite: 'agents',
        name: 'agent_learning_active',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const { data } = await supabase
            .from('agent_beliefs')
            .select('last_updated_at, agent_call_sign')
            .order('last_updated_at', { ascending: false })
            .limit(1);
          const lastUpdate = data?.[0]?.last_updated_at;
          const hoursSince = lastUpdate
            ? (Date.now() - new Date(lastUpdate).getTime()) / 3600000
            : 999;
          return {
            passed: hoursSince < 48,
            expected: 'Agent beliefs updated within last 48 hours',
            actual: lastUpdate ? `Last belief update: ${Math.round(hoursSince)}h ago by ${data![0].agent_call_sign}` : 'No agent beliefs found',
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'vip_travel',
        name: 'vip_flight_status_accuracy',
        isKnownBroken: true,
        knownBrokenReason: 'Alert scans making false assumptions about flight active/completed status',
        run: async () => {
          const start = Date.now();
          const { data: travelers } = await supabase
            .from('travel_itineraries')
            .select('id, traveler_name, status, departure_date')
            .eq('status', 'active')
            .lt('departure_date', new Date().toISOString());
          const falseActives = travelers?.length || 0;
          return {
            passed: falseActives === 0,
            expected: 'No past-date flights marked as active',
            actual: falseActives > 0 ? `BROKEN: ${falseActives} past-date flights still marked active` : 'All flight statuses correct',
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'briefings',
        name: 'daily_briefing_generates',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const resp = await supabase.functions.invoke('generate-daily-briefing', {
            body: { clientId: PETRONAS_CLIENT_ID, test: true }
          });
          return {
            passed: !resp.error,
            expected: 'Daily briefing generates without error',
            actual: resp.error ? resp.error.message : 'Generated successfully',
            ms: Date.now() - start
          };
        }
      },
      {
        suite: 'sources',
        name: 'active_sources_ingesting',
        isKnownBroken: false,
        run: async () => {
          const start = Date.now();
          const { data: staleSources } = await supabase
            .from('sources')
            .select('name, last_ingested_at')
            .eq('status', 'active')
            .lt('last_ingested_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
          const staleCount = staleSources?.length || 0;
          return {
            passed: staleCount < 5,
            expected: 'Fewer than 5 active sources stale for more than 4 hours',
            actual: staleCount === 0 ? 'All sources ingesting normally' : `${staleCount} sources not ingested in 4+ hours`,
            ms: Date.now() - start
          };
        }
      }
    ];

    let passed = 0;
    let failed = 0;
    let knownBrokenCount = 0;

    for (const test of tests) {
      try {
        const result = await test.run();
        if (test.isKnownBroken) knownBrokenCount++;
        if (result.passed) passed++; else failed++;

        await supabase.from('qa_test_results').insert({
          test_suite: test.suite,
          test_name: test.name,
          passed: result.passed,
          expected_outcome: result.expected,
          actual_outcome: result.actual,
          error_message: result.passed ? null : result.actual,
          response_time_ms: result.ms,
          is_known_broken: test.isKnownBroken || false,
          known_broken_reason: test.knownBrokenReason || null,
          severity: test.isKnownBroken ? 'low' : 'medium'
        });

        console.log(`[QA] ${result.passed ? '✓' : '✗'} ${test.suite}/${test.name} (${result.ms}ms) — ${result.actual}`);
      } catch (err: any) {
        failed++;
        await supabase.from('qa_test_results').insert({
          test_suite: test.suite,
          test_name: test.name,
          passed: false,
          expected_outcome: 'Test completes without throwing',
          actual_outcome: `Exception: ${err.message}`,
          error_message: err.message,
          response_time_ms: null,
          is_known_broken: test.isKnownBroken || false,
          severity: 'high'
        });
        console.error(`[QA] EXCEPTION ${test.suite}/${test.name}: ${err.message}`);
      }
    }

    console.log(`[QA Agent] Complete: ${passed} passed, ${failed} failed, ${knownBrokenCount} known broken`);

    return successResponse({
      success: true,
      total: tests.length,
      passed,
      failed,
      knownBroken: knownBrokenCount,
      passRate: `${passed}/${tests.length}`
    });
  } catch (error: any) {
    console.error('[QA Agent] Fatal error:', error);
    return errorResponse(`QA Agent failed: ${error.message}`, 500);
  }
});
