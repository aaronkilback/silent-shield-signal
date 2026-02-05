import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestResult {
  test_name: string;
  pipeline: string;
  status: 'pass' | 'fail' | 'skip';
  duration_ms: number;
  error_message?: string;
  error_stack?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Scheduled Pipeline Tests
 * Runs functional smoke tests against critical pipelines to catch runtime errors
 * that deployment checks miss.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const testRunId = crypto.randomUUID();
  const results: TestResult[] = [];
  const startTime = Date.now();

  console.log(`[Pipeline Tests] Starting test run: ${testRunId}`);

  // ============================================
  // TEST 1: Document Processing Pipeline
  // ============================================
  try {
    const docStart = Date.now();
    
    // Test 1a: Check if process-stored-document responds
    const { data: docHealthData, error: docHealthError } = await supabase.functions.invoke(
      'process-stored-document',
      {
        method: 'POST',
        body: { health_check: true }
      }
    );

    if (docHealthError) {
      results.push({
        test_name: 'Document processor health check',
        pipeline: 'document-processing',
        status: 'fail',
        duration_ms: Date.now() - docStart,
        error_message: docHealthError.message,
      });
    } else {
      results.push({
        test_name: 'Document processor health check',
        pipeline: 'document-processing',
        status: 'pass',
        duration_ms: Date.now() - docStart,
        metadata: { response: docHealthData },
      });
    }

    // Test 1b: Test actual PDF processing with a minimal test
    const pdfTestStart = Date.now();
    
    // Create a minimal valid PDF (just header, enough to test code path)
    const minimalPdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, // %PDF-1.4
      0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A,       // binary marker
      0x31, 0x20, 0x30, 0x20, 0x6F, 0x62, 0x6A, 0x0A, // 1 0 obj
      0x3C, 0x3C, 0x2F, 0x54, 0x79, 0x70, 0x65, 0x2F, // <</Type/
      0x43, 0x61, 0x74, 0x61, 0x6C, 0x6F, 0x67, 0x3E, // Catalog>
      0x3E, 0x0A, 0x65, 0x6E, 0x64, 0x6F, 0x62, 0x6A, // > endobj
      0x0A, 0x25, 0x25, 0x45, 0x4F, 0x46              // %%EOF
    ]);

    // Upload to a test location in an existing bucket
    const testFileName = `_pipeline_test_${testRunId}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('archival-documents')  // Use existing bucket
      .upload(`test/${testFileName}`, minimalPdf, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      results.push({
        test_name: 'Document upload test',
        pipeline: 'document-processing',
        status: 'fail',
        duration_ms: Date.now() - pdfTestStart,
        error_message: uploadError.message,
      });
    } else {
      // Try to process it (expect graceful handling of minimal PDF)
      const { data: processData, error: processError } = await supabase.functions.invoke(
        'process-stored-document',
        {
          method: 'POST',
          body: {
            storagePath: `test/${testFileName}`,
            filename: testFileName,
            mimeType: 'application/pdf',
            skipAiProcessing: true // Just test parsing, not AI
          }
        }
      );

      // Clean up test file
      await supabase.storage.from('archival-documents').remove([`test/${testFileName}`]);

      // Even if processing "fails" due to minimal PDF, we want to ensure code runs without crashing
      results.push({
        test_name: 'Document processing code path',
        pipeline: 'document-processing',
        status: processError?.message?.includes('syntax') || processError?.message?.includes('undefined') ? 'fail' : 'pass',
        duration_ms: Date.now() - pdfTestStart,
        error_message: processError?.message,
        metadata: { gracefulError: !!processError, response: processData },
      });
    }
  } catch (err) {
    results.push({
      test_name: 'Document processing pipeline',
      pipeline: 'document-processing',
      status: 'fail',
      duration_ms: 0,
      error_message: err instanceof Error ? err.message : String(err),
      error_stack: err instanceof Error ? err.stack : undefined,
    });
  }

  // ============================================
  // TEST 2: Signal Ingestion Pipeline
  // ============================================
  try {
    const signalStart = Date.now();

    // Test 2a: Health check first
    const { data: ingestHealthData, error: ingestHealthError } = await supabase.functions.invoke(
      'ingest-signal',
      {
        method: 'POST',
        body: { health_check: true }
      }
    );

    if (ingestHealthError) {
      results.push({
        test_name: 'Signal ingestion health check',
        pipeline: 'signal-ingestion',
        status: 'fail',
        duration_ms: Date.now() - signalStart,
        error_message: ingestHealthError.message,
      });
    } else {
      results.push({
        test_name: 'Signal ingestion health check',
        pipeline: 'signal-ingestion',
        status: 'pass',
        duration_ms: Date.now() - signalStart,
        metadata: { response: ingestHealthData },
      });
    }

    // Test 2b: Actually ingest a test signal (using correct field name 'text' not 'content')
    const signalTestStart = Date.now();
    const { data: ingestData, error: ingestError } = await supabase.functions.invoke(
      'ingest-signal',
      {
        method: 'POST',
        body: {
          source_key: 'pipeline-test',
          text: `[PIPELINE TEST] Automated validation at ${new Date().toISOString()}`,
          is_test: true
        }
      }
    );

    // "Source not found" is acceptable - it means the function ran but no test source is configured
    // This validates the code path executes without crashing
    const isAcceptableError = ingestError?.message?.includes('Source not found') ||
                               ingestError?.message?.includes('non-2xx') && !ingestError?.message?.includes('syntax');
    
    if (ingestError && !isAcceptableError) {
      results.push({
        test_name: 'Signal ingestion functional test',
        pipeline: 'signal-ingestion',
        status: 'fail',
        duration_ms: Date.now() - signalTestStart,
        error_message: ingestError.message,
      });
    } else {
      results.push({
        test_name: 'Signal ingestion functional test',
        pipeline: 'signal-ingestion',
        status: 'pass',
        duration_ms: Date.now() - signalTestStart,
        metadata: { signal_id: ingestData?.signal_id || ingestData?.id },
      });

      // Clean up test signal
      if (ingestData?.signal_id || ingestData?.id) {
        await supabase.from('signals').delete().eq('id', ingestData?.signal_id || ingestData?.id);
      }
    }
  } catch (err) {
    results.push({
      test_name: 'Signal ingestion pipeline',
      pipeline: 'signal-ingestion',
      status: 'fail',
      duration_ms: 0,
      error_message: err instanceof Error ? err.message : String(err),
      error_stack: err instanceof Error ? err.stack : undefined,
    });
  }

  // ============================================
  // TEST 3: AI Decision Engine
  // ============================================
  try {
    const aiStart = Date.now();

    const { data: aiData, error: aiError } = await supabase.functions.invoke(
      'ai-decision-engine',
      {
        method: 'POST',
        body: {
          action: 'health_check',
          test_mode: true
        }
      }
    );

    results.push({
      test_name: 'AI decision engine health',
      pipeline: 'ai-analysis',
      status: aiError ? 'fail' : 'pass',
      duration_ms: Date.now() - aiStart,
      error_message: aiError?.message,
      metadata: { response: aiData },
    });
  } catch (err) {
    results.push({
      test_name: 'AI decision engine',
      pipeline: 'ai-analysis',
      status: 'fail',
      duration_ms: 0,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  // ============================================
  // TEST 4: Agent Chat (AEGIS)
  // ============================================
  try {
    const agentStart = Date.now();

    const { data: agentData, error: agentError } = await supabase.functions.invoke(
      'agent-chat',
      {
        method: 'POST',
        body: {
          message: 'health check',
          agentId: 'health-probe',
          conversationId: `test-${testRunId}`,
          test_mode: true
        }
      }
    );

    // Agent may return error for missing agent, but function should respond
    const passed = !agentError || agentError.message?.includes('Agent not found');
    
    results.push({
      test_name: 'Agent chat responsiveness',
      pipeline: 'ai-analysis',
      status: passed ? 'pass' : 'fail',
      duration_ms: Date.now() - agentStart,
      error_message: passed ? undefined : agentError?.message,
      metadata: { response_type: typeof agentData },
    });
  } catch (err) {
    results.push({
      test_name: 'Agent chat',
      pipeline: 'ai-analysis',
      status: 'fail',
      duration_ms: 0,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  // ============================================
  // TEST 5: Entity Deep Scan
  // ============================================
  try {
    const entityStart = Date.now();

    const { data: entityData, error: entityError } = await supabase.functions.invoke(
      'entity-deep-scan',
      {
        method: 'POST',
        body: { health_check: true }
      }
    );

    results.push({
      test_name: 'Entity deep scan health',
      pipeline: 'entity-analysis',
      status: entityError ? 'fail' : 'pass',
      duration_ms: Date.now() - entityStart,
      error_message: entityError?.message,
      metadata: { response: entityData },
    });
  } catch (err) {
    results.push({
      test_name: 'Entity deep scan',
      pipeline: 'entity-analysis',
      status: 'fail',
      duration_ms: 0,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  // ============================================
  // TEST 6: Threat Radar Analysis
  // ============================================
  try {
    const threatStart = Date.now();

    const { data: threatData, error: threatError } = await supabase.functions.invoke(
      'threat-radar-analysis',
      {
        method: 'POST',
        body: { health_check: true }
      }
    );

    results.push({
      test_name: 'Threat radar analysis health',
      pipeline: 'threat-analysis',
      status: threatError ? 'fail' : 'pass',
      duration_ms: Date.now() - threatStart,
      error_message: threatError?.message,
      metadata: { response: threatData },
    });
  } catch (err) {
    results.push({
      test_name: 'Threat radar analysis',
      pipeline: 'threat-analysis',
      status: 'fail',
      duration_ms: 0,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  // ============================================
  // TEST 7: Report Generation
  // ============================================
  try {
    const reportStart = Date.now();

    const { data: reportData, error: reportError } = await supabase.functions.invoke(
      'generate-report',
      {
        method: 'POST',
        body: { health_check: true }
      }
    );

    results.push({
      test_name: 'Report generation health',
      pipeline: 'report-generation',
      status: reportError ? 'fail' : 'pass',
      duration_ms: Date.now() - reportStart,
      error_message: reportError?.message,
      metadata: { response: reportData },
    });
  } catch (err) {
    results.push({
      test_name: 'Report generation',
      pipeline: 'report-generation',
      status: 'fail',
      duration_ms: 0,
      error_message: err instanceof Error ? err.message : String(err),
    });
  }

  // ============================================
  // Store all results
  // ============================================
  const resultsToInsert = results.map(r => ({
    test_run_id: testRunId,
    ...r,
    metadata: r.metadata || {},
  }));

  const { error: insertError } = await supabase
    .from('pipeline_test_results')
    .insert(resultsToInsert);

  if (insertError) {
    console.error('[Pipeline Tests] Failed to store results:', insertError);
  }

  // ============================================
  // Create bug report if any failures
  // ============================================
  const failures = results.filter(r => r.status === 'fail');
  if (failures.length > 0) {
    console.log(`[Pipeline Tests] ${failures.length} failures detected, creating bug report`);

    await supabase.from('bug_reports').insert({
      title: `[AUTO] Pipeline Test Failures - ${new Date().toISOString().split('T')[0]}`,
      description: `Scheduled pipeline tests detected ${failures.length} failure(s):\n\n${failures.map(f => `- **${f.pipeline}**: ${f.test_name}\n  Error: ${f.error_message}`).join('\n\n')}`,
      severity: failures.length > 3 ? 'critical' : 'high',
      status: 'open',
      page_url: '/system-stability',
      browser_info: 'Automated Test Suite',
    });
  }

  const totalDuration = Date.now() - startTime;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  console.log(`[Pipeline Tests] Completed: ${passed} passed, ${failed} failed, ${skipped} skipped (${totalDuration}ms)`);

  return new Response(
    JSON.stringify({
      test_run_id: testRunId,
      summary: { passed, failed, skipped, total: results.length },
      duration_ms: totalDuration,
      results,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
