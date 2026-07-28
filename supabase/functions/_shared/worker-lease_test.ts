// Unit tests for the job-worker single-flight lease
// (INC-JOBWORKER-SATURATION-2026-07-27). Run: deno test worker-lease_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { acquireWorkerLease, releaseWorkerLease } from "./worker-lease.ts";

// Minimal supabase-client stand-in: records .rpc() calls and returns a fixed result.
function mockClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ fn: string; params: unknown }> = [];
  const client: any = {
    rpc(fn: string, params: unknown) {
      calls.push({ fn, params });
      return Promise.resolve(result);
    },
    _calls: calls,
  };
  return client;
}

Deno.test("acquire → true when RPC returns true (lease free/stale)", async () => {
  const c = mockClient({ data: true, error: null });
  assertEquals(await acquireWorkerLease(c, "run-A"), true);
});

Deno.test("acquire → false when RPC returns false (fresh lease held elsewhere)", async () => {
  const c = mockClient({ data: false, error: null });
  assertEquals(await acquireWorkerLease(c, "run-B"), false);
});

Deno.test("acquire → false (fail-CLOSED) on RPC error", async () => {
  const c = mockClient({ data: null, error: { message: "pool exhausted" } });
  assertEquals(await acquireWorkerLease(c, "run-C"), false);
});

Deno.test("acquire calls try_acquire_job_worker_lease with run_id + stale_secs", async () => {
  const c = mockClient({ data: true, error: null });
  await acquireWorkerLease(c, "run-D", 150);
  const call = (c._calls as Array<{ fn: string; params: any }>)[0];
  assertEquals(call.fn, "try_acquire_job_worker_lease");
  assertEquals(call.params.p_run_id, "run-D");
  assertEquals(call.params.p_stale_secs, 150);
});

Deno.test("release calls release_job_worker_lease guarded by run_id", async () => {
  const c = mockClient({ data: null, error: null });
  await releaseWorkerLease(c, "run-E");
  const call = (c._calls as Array<{ fn: string; params: any }>)[0];
  assertEquals(call.fn, "release_job_worker_lease");
  assertEquals(call.params.p_run_id, "run-E");
});
