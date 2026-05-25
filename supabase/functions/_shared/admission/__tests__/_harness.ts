// Shared offline parity-harness helpers (Phase B). No network, no real Supabase, no real AI.
// Used by the classify (slice 2) parity test and reused by dedup/relevance slices later.

// Fluent, thenable Supabase stub. Every builder method returns the builder; awaiting the builder
// at any chain point resolves to the table's fixture. `throw:true` makes the await reject (to
// exercise try/catch branches). Records the table + method sequence for assertions.
export interface TableFixture { data?: any; error?: any; throw?: boolean }
export function stubSupabase(fixtures: Record<string, TableFixture>) {
  const calls: { table: string; ops: string[] }[] = [];
  const sb = {
    from(table: string) {
      const rec = { table, ops: [] as string[] };
      calls.push(rec);
      const fx = fixtures[table] ?? { data: null, error: null };
      const settle = () =>
        fx.throw
          ? Promise.reject(fx.error ?? new Error("stub db error"))
          : Promise.resolve({ data: fx.data ?? null, error: fx.error ?? null });
      const builder: any = new Proxy({}, {
        get(_t, prop: string | symbol) {
          if (prop === "then") return (res: any, rej: any) => settle().then(res, rej);
          if (prop === "catch") return (f: any) => settle().catch(f);
          if (prop === "finally") return (f: any) => settle().finally(f);
          return (..._args: any[]) => { rec.ops.push(String(prop)); return builder; };
        },
      });
      return builder;
    },
  };
  return { sb, calls };
}

// callAiGatewayJson replay: returns recorded {data}|{error} per call; records the args (so the
// harness asserts model/functionName/dlqOnFailure/messages without hitting a provider). The real
// gateway's telemetry + DLQ-on-failure are its own behaviors; capturing the call args captures
// ingest-signal's REQUEST of those (dlqOnFailure/dlqPayload), which is the in-scope effect.
export function aiReplay(responses: Array<{ data?: any; error?: any }>) {
  const calls: any[] = [];
  let i = 0;
  const callAiGatewayJson = (args: any) => {
    calls.push(args);
    const r = responses[Math.min(i, responses.length - 1)] ?? {};
    i++;
    return Promise.resolve(r);
  };
  return { callAiGatewayJson, calls };
}

export function captureConsole() {
  const logs: { level: string; msg: string }[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (m: unknown) => logs.push({ level: "log", msg: String(m) });
  console.warn = (m: unknown) => logs.push({ level: "warn", msg: String(m) });
  console.error = (m: unknown) => logs.push({ level: "error", msg: String(m) });
  return { logs, restore: () => { console.log = orig.log; console.warn = orig.warn; console.error = orig.error; } };
}
