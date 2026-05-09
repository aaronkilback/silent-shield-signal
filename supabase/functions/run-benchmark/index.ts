/**
 * Fortress Benchmark Runner
 *
 * Iterates over labeled benchmark_examples, ingests each one against a
 * sandbox client (status='inactive', config-cloned from a real client),
 * scores actuals vs labels, writes a benchmark_runs + benchmark_results
 * record set.
 *
 * Designed to run on every deploy via GitHub Actions, plus on demand
 * via direct invoke. Sandbox isolation prevents benchmark traffic from
 * polluting client feeds — the active-client boundary in ingest-signal
 * blocks is_test=true on active clients, so even if the runner is
 * misconfigured the worst case is failing benchmarks, not contaminated
 * production.
 *
 * Body:
 *   {
 *     label_version?: string;   // default 'v1'
 *     triggered_by?: string;    // 'manual' | 'ci_deploy' | 'scheduled'
 *     pipeline_version?: string; // git sha or similar
 *     cleanup?: boolean;        // delete benchmark signals after scoring (default true)
 *   }
 *
 * Response:
 *   {
 *     run_id, total, signal_creation_accuracy, category_accuracy,
 *     severity_calibration, noise_suppression_rate, by_class
 *   }
 */

import { createServiceClient, handleCors, successResponse, errorResponse } from "../_shared/supabase-client.ts";

interface BenchmarkExample {
  id: string;
  label_version: string;
  example_class: string;
  input_text: string;
  input_source_url: string | null;
  input_source_key: string | null;
  input_client_name: string;
  should_create_signal: boolean;
  expected_category: string | null;
  expected_severity_min: string | null;
  expected_severity_max: string | null;
  rationale: string;
}

const SEVERITY_IDX: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const supabase = createServiceClient();
  const body = await req.json().catch(() => ({}));
  const labelVersion = body.label_version || "v1";
  const triggeredBy = body.triggered_by || "manual";
  const pipelineVersion = body.pipeline_version || null;
  const cleanup = body.cleanup !== false;

  console.log(`[Benchmark] Starting v${labelVersion} run (triggered_by=${triggeredBy})`);

  try {
    // 1. Pull examples
    const { data: examples, error: exErr } = await supabase
      .from("benchmark_examples")
      .select("*")
      .eq("label_version", labelVersion);
    if (exErr) throw exErr;
    if (!examples || examples.length === 0) {
      return errorResponse(`No benchmark_examples found for label_version=${labelVersion}`, 404);
    }

    // 2. Build client_id lookup for sandbox clients
    const sandboxNames = Array.from(new Set(examples.map((e: any) => e.input_client_name)));
    const { data: sandboxes, error: sbxErr } = await supabase
      .from("clients")
      .select("id, name, status")
      .in("name", sandboxNames);
    if (sbxErr) throw sbxErr;
    const clientMap = new Map<string, { id: string; status: string }>(
      (sandboxes || []).map((c: any) => [c.name, { id: c.id, status: c.status }]),
    );

    // 3. Create the run record
    const { data: run, error: runErr } = await supabase
      .from("benchmark_runs")
      .insert({
        label_version: labelVersion,
        triggered_by: triggeredBy,
        pipeline_version: pipelineVersion,
        examples_run: examples.length,
      })
      .select()
      .single();
    if (runErr) throw runErr;

    console.log(`[Benchmark] Run ${run.id} created. Iterating ${examples.length} examples.`);

    let totalCorrect = 0;
    let totalCategoryMatched = 0;
    let totalCategoryEvaluated = 0;
    let totalSeverityInBounds = 0;
    let totalSeverityEvaluated = 0;
    let suppressionCorrect = 0;
    let suppressionTotal = 0;

    const benchmarkSignalIds: string[] = [];
    const byClass: Record<string, { run: number; passed: number }> = {};

    // 4. Run examples fully in parallel.
    // ingest-signal averages ~5-8s per call (AI classification + embedding
    // + dedup) so even batches of 8 push us past the 150s edge timeout.
    // 39 fully-concurrent invocations finish in ~10-15s — Supabase Edge
    // Functions have plenty of concurrency headroom.
    const BATCH_SIZE = examples.length;
    const runExample = async (ex: BenchmarkExample) => {
      const startMs = Date.now();
      const sandbox = clientMap.get(ex.input_client_name);

      byClass[ex.example_class] = byClass[ex.example_class] || { run: 0, passed: 0 };
      byClass[ex.example_class].run++;

      if (!sandbox) {
        await supabase.from("benchmark_results").insert({
          run_id: run.id,
          example_id: ex.id,
          notes: `Sandbox client "${ex.input_client_name}" not found — skipping.`,
        });
        return;
      }

      const uniqueSourceUrl = ex.input_source_url
        ? `${ex.input_source_url}${ex.input_source_url.includes("?") ? "&" : "?"}_bench=${run.id}`
        : `bench://example-${ex.id}-run-${run.id}`;

      let ingestData: any = null;
      let ingestStatus = "unknown";
      let ingestError: string | null = null;
      try {
        const { data, error: invokeErr } = await supabase.functions.invoke("ingest-signal", {
          body: {
            text: ex.input_text,
            source_url: uniqueSourceUrl,
            source_key: ex.input_source_key || undefined,
            client_id: sandbox.id,
            is_test: true,
            skip_relevance_gate: ex.input_source_key === "cisa-kev",
            raw_json: {
              source: ex.input_source_key || "benchmark",
              benchmark_run_id: run.id,
              benchmark_example_id: ex.id,
              benchmark_label_version: ex.label_version,
              benchmark_should_create: ex.should_create_signal,
              benchmark_example_class: ex.example_class,
            },
          },
        });
        ingestData = data;
        if (invokeErr) ingestError = invokeErr.message || String(invokeErr);
        ingestStatus = ingestData?.status || (ingestData?.signal_id ? "created" : "unknown");
      } catch (e: any) {
        ingestError = e?.message || String(e);
      }

      // Use ingest-signal's response directly. signal_id present →
      // signal was created. Otherwise check for rejection statuses.
      const signalIdFromResponse = ingestData?.signal_id || null;
      let actualCreated = !!signalIdFromResponse;
      let actualSignal: { id: string; category: string | null; severity: string | null } | null = null;

      if (signalIdFromResponse) {
        // ingest-signal returns severity but not always category — fetch
        // the row to get both fields cleanly.
        const { data: row } = await supabase
          .from("signals")
          .select("id, category, severity")
          .eq("id", signalIdFromResponse)
          .maybeSingle();
        actualSignal = row || { id: signalIdFromResponse, category: null, severity: ingestData?.severity || null };
        benchmarkSignalIds.push(signalIdFromResponse);
      }

      // Score
      const decisionCorrect = ex.should_create_signal === actualCreated;
      let categoryMatch: boolean | null = null;
      let severityInBounds: boolean | null = null;

      if (ex.should_create_signal && actualCreated && actualSignal) {
        if (ex.expected_category) {
          categoryMatch = (actualSignal.category || "").toLowerCase() === ex.expected_category.toLowerCase();
          totalCategoryEvaluated++;
          if (categoryMatch) totalCategoryMatched++;
        }
        if (ex.expected_severity_min || ex.expected_severity_max) {
          const minIdx = SEVERITY_IDX[ex.expected_severity_min || "low"] ?? 0;
          const maxIdx = SEVERITY_IDX[ex.expected_severity_max || "critical"] ?? 3;
          const actualIdx = SEVERITY_IDX[(actualSignal.severity || "low").toLowerCase()] ?? -1;
          severityInBounds = actualIdx >= minIdx && actualIdx <= maxIdx;
          totalSeverityEvaluated++;
          if (severityInBounds) totalSeverityInBounds++;
        }
      }

      if (!ex.should_create_signal) {
        suppressionTotal++;
        if (!actualCreated) suppressionCorrect++;
      }

      if (decisionCorrect) {
        totalCorrect++;
        byClass[ex.example_class].passed++;
      }

      await supabase.from("benchmark_results").insert({
        run_id: run.id,
        example_id: ex.id,
        actual_signal_created: actualCreated,
        actual_signal_id: actualSignal?.id || null,
        actual_category: actualSignal?.category || null,
        actual_severity: actualSignal?.severity || null,
        signal_creation_correct: decisionCorrect,
        category_correct: categoryMatch,
        severity_within_bounds: severityInBounds,
        latency_ms: Date.now() - startMs,
        notes: ingestError ? `ingest_error: ${ingestError}` : (ingestStatus !== "ok" && ingestStatus !== "created" && ingestStatus !== "unknown" ? `status=${ingestStatus}` : null),
      });
    };

    for (let i = 0; i < examples.length; i += BATCH_SIZE) {
      const batch = (examples as BenchmarkExample[]).slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(runExample));
    }

    // 5. Compute aggregates and finalize
    const total = examples.length;
    const signalCreationAccuracy = total > 0 ? totalCorrect / total : null;
    const categoryAccuracy = totalCategoryEvaluated > 0 ? totalCategoryMatched / totalCategoryEvaluated : null;
    const severityCalibration = totalSeverityEvaluated > 0 ? totalSeverityInBounds / totalSeverityEvaluated : null;
    const noiseSuppressionRate = suppressionTotal > 0 ? suppressionCorrect / suppressionTotal : null;

    await supabase
      .from("benchmark_runs")
      .update({
        examples_passed: totalCorrect,
        examples_failed: total - totalCorrect,
        signal_creation_accuracy: signalCreationAccuracy,
        category_accuracy: categoryAccuracy,
        severity_calibration: severityCalibration,
        noise_suppression_rate: noiseSuppressionRate,
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    // 6. Cleanup: delete the benchmark signals so they don't accumulate.
    // The is_test=true flag already keeps them out of dashboards, but
    // cumulative signal-table growth from CI runs would still bloat the
    // table over time. Skip if cleanup=false (operator wants to inspect).
    if (cleanup && benchmarkSignalIds.length > 0) {
      // FK cascade: delete child rows first.
      await supabase.from("signal_agent_analyses").delete().in("signal_id", benchmarkSignalIds);
      await supabase.from("incidents").delete().in("signal_id", benchmarkSignalIds);
      await supabase.from("signals").delete().in("id", benchmarkSignalIds);
      console.log(`[Benchmark] Cleaned up ${benchmarkSignalIds.length} test signals.`);
    }

    console.log(
      `[Benchmark] Run ${run.id} complete. ` +
      `Decision accuracy: ${signalCreationAccuracy?.toFixed(2)} (${totalCorrect}/${total}). ` +
      `Category: ${categoryAccuracy?.toFixed(2)}. Severity: ${severityCalibration?.toFixed(2)}. ` +
      `Noise suppression: ${noiseSuppressionRate?.toFixed(2)}.`,
    );

    return successResponse({
      run_id: run.id,
      label_version: labelVersion,
      total,
      examples_passed: totalCorrect,
      signal_creation_accuracy: signalCreationAccuracy,
      category_accuracy: categoryAccuracy,
      severity_calibration: severityCalibration,
      noise_suppression_rate: noiseSuppressionRate,
      by_class: byClass,
      cleanup_applied: cleanup,
      signals_cleaned: cleanup ? benchmarkSignalIds.length : 0,
    });
  } catch (err: any) {
    console.error("[Benchmark] Fatal error:", err);
    return errorResponse(err?.message || String(err), 500);
  }
});
