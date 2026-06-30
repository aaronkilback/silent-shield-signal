import { describe, expect, it } from "vitest";
import { handleIncidentDecisionBriefRequest } from "../../../supabase/functions/_shared/incident-decision-brief-handler";

type Filter = { op: string; column: string; value: unknown };
type QueryLog = { table: string; select?: string; filters: Filter[]; maybeSingle: boolean };

const baseIncident = {
  id: "incident-a",
  title: "Authorized fixture incident",
  priority: "p2",
  status: "open",
  opened_at: "2026-06-30T10:00:00Z",
  client_id: "client-a",
  tenant_id: "tenant-a",
  signal_id: "signal-a",
  timeline_json: [{ event: "Opened", timestamp: "2026-06-30T10:00:00Z" }],
  deleted_at: null,
  is_test: false,
};

const fixtures = {
  incidents: [
    baseIncident,
    { ...baseIncident, id: "incident-b", client_id: "client-b", tenant_id: "tenant-b", signal_id: "signal-b" },
  ],
  incident_signals: [
    { incident_id: "incident-a", signal_id: "signal-a" },
    { incident_id: "incident-a", signal_id: "signal-cross-client" },
    { incident_id: "incident-a", signal_id: "signal-cross-tenant" },
    { incident_id: "incident-b", signal_id: "signal-b" },
  ],
  signals: [
    sourceBackedSignal("signal-a", "client-a", "tenant-a", "https://example.test/source-a"),
    sourceBackedSignal("signal-b", "client-b", "tenant-b", "https://example.test/source-b"),
    sourceBackedSignal("signal-cross-client", "client-b", "tenant-a", "https://example.test/cross-client"),
    sourceBackedSignal("signal-cross-tenant", "client-a", "tenant-b", "https://example.test/cross-tenant"),
    sourceBackedSignal("signal-unsafe", "client-a", "tenant-a", "javascript:alert(1)"),
  ],
  signal_agent_analyses: [
    { id: "analysis-a", signal_id: "signal-a", agent_call_sign: "Aegis", analysis: "safe summary", reasoning_log: "hidden chain", hidden_prompt: "internal", created_at: "2026-06-30T11:20:00Z" },
    { id: "analysis-b", signal_id: "signal-b", agent_call_sign: "Aegis", analysis: "cross-client", created_at: "2026-06-30T11:20:00Z" },
  ],
  agent_debate_records: [
    { id: "debate-a", incident_id: "incident-a", final_assessment: "internal assessment", created_at: "2026-06-30T11:30:00Z" },
    { id: "debate-b", incident_id: "incident-b", final_assessment: "cross-client debate", created_at: "2026-06-30T11:30:00Z" },
    { id: "debate-incomplete", incident_id: null, final_assessment: "orphan debate", created_at: "2026-06-30T11:30:00Z" },
  ],
};

describe("incident-decision-brief endpoint boundary", () => {
  it("rejects no JWT before any privileged data query", async () => {
    const { deps, queryLog } = makeDeps({ caller: { kind: "unauthorized", error: "authentication required", status: 401 } });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-a" }), deps);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "authentication required" });
    expect(queryLog).toEqual([]);
  });

  it("rejects malformed JWT before any privileged data query", async () => {
    const { deps, queryLog } = makeDeps({ caller: { kind: "unauthorized", error: "invalid or expired token", status: 401 } });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-a" }), deps);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid or expired token" });
    expect(queryLog).toEqual([]);
  });

  it("allows Client A to retrieve a Client A incident through server-derived client scope", async () => {
    const { deps, queryLog } = makeDeps({ accessibleClientIds: ["client-a"] });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-a" }), deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recommendation_label).toBe("Investigate");
    expect(queryLog.find((entry) => entry.table === "incidents")?.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "id", value: "incident-a" },
        { op: "in", column: "client_id", value: ["client-a"] },
      ]),
    );
  });

  it("returns a non-existence-revealing response for Client A requesting Client B incident", async () => {
    const { deps } = makeDeps({ accessibleClientIds: ["client-a"] });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-b" }), deps);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Incident not found" });
  });

  it("returns the same status and response shape for cross-client and nonexistent incident IDs", async () => {
    const { deps } = makeDeps({ accessibleClientIds: ["client-a"] });
    const crossClient = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-b" }), deps);
    const nonexistent = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-does-not-exist" }), deps);

    expect(crossClient.status).toBe(nonexistent.status);
    expect(await crossClient.json()).toEqual(await nonexistent.json());
  });

  it("rejects injected client_id or tenant_id before data retrieval", async () => {
    const { deps, queryLog } = makeDeps({ accessibleClientIds: ["client-a"] });
    const response = await handleIncidentDecisionBriefRequest(request({
      incident_id: "incident-a",
      client_id: "client-b",
      tenant_id: "tenant-b",
    }), deps);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "client_id and tenant_id are server-derived and are not accepted" });
    expect(queryLog).toEqual([]);
  });

  it("excludes linked signals and analyses outside the authorized incident client and tenant", async () => {
    const { deps, queryLog } = makeDeps({ accessibleClientIds: ["client-a"] });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-a" }), deps);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(serialized).toContain("signal:signal-a");
    expect(serialized).not.toContain("signal-cross-client");
    expect(serialized).not.toContain("signal-cross-tenant");
    expect(serialized).not.toContain("analysis-b");

    const signalQuery = queryLog.find((entry) => entry.table === "signals");
    expect(signalQuery?.filters).toEqual(expect.arrayContaining([
      { op: "eq", column: "client_id", value: "client-a" },
      { op: "eq", column: "tenant_id", value: "tenant-a" },
    ]));

    const analysisQuery = queryLog.find((entry) => entry.table === "signal_agent_analyses");
    expect(analysisQuery?.filters).toEqual(expect.arrayContaining([
      { op: "in", column: "signal_id", value: ["signal-a"] },
    ]));
  });

  it("excludes debate records not tied to the authorized incident", async () => {
    const { deps } = makeDeps({ accessibleClientIds: ["client-a"] });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-a" }), deps);
    const serialized = JSON.stringify(await response.json());

    expect(serialized).toContain("debate:debate-a");
    expect(serialized).not.toContain("debate-b");
    expect(serialized).not.toContain("debate-incomplete");
  });

  it("returns exact HOLD text when source evidence is unavailable or unsafe", async () => {
    const { deps } = makeDeps({
      accessibleClientIds: ["client-a"],
      fixtureOverrides: {
        incidents: [{ ...baseIncident, id: "incident-unsafe", signal_id: "signal-unsafe" }],
        incident_signals: [{ incident_id: "incident-unsafe", signal_id: "signal-unsafe" }],
      },
    });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-unsafe" }), deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recommendation_text).toBe("HOLD — insufficient evidence to recommend action");
    expect(JSON.stringify(body)).not.toContain("javascript:");
  });

  it("does not return raw reasoning logs, hidden prompts, raw_json, or secret-like internal fields", async () => {
    const { deps } = makeDeps({ accessibleClientIds: ["client-a"] });
    const response = await handleIncidentDecisionBriefRequest(request({ incident_id: "incident-a" }), deps);
    const serialized = JSON.stringify(await response.json());

    expect(serialized).not.toContain("reasoning_log");
    expect(serialized).not.toContain("hidden_prompt");
    expect(serialized).not.toContain("raw_json");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("internal assessment");
  });
});

function request(body: Record<string, unknown>): Request {
  return new Request("https://edge.example.test/incident-decision-brief", {
    method: "POST",
    headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sourceBackedSignal(id: string, clientId: string, tenantId: string, sourceUrl: string) {
  return {
    id,
    signal_number: id.toUpperCase(),
    severity: "medium",
    status: "new",
    quality_status: "ok",
    relevance_score: 0.9,
    source_url: sourceUrl,
    raw_json: { source_url: "https://example.test/raw-json-url", api_key: "must-not-return" },
    created_at: "2026-06-30T11:00:00Z",
    client_id: clientId,
    tenant_id: tenantId,
  };
}

function makeDeps({
  caller = { kind: "user" as const, userId: "user-a", user: {} },
  accessibleClientIds = ["client-a"],
  fixtureOverrides = {},
}: {
  caller?: { kind: "unauthorized"; error: string; status: number } | { kind: "user"; userId: string; user: unknown };
  accessibleClientIds?: string[];
  fixtureOverrides?: Partial<typeof fixtures>;
}) {
  const queryLog: QueryLog[] = [];
  const dataset = {
    ...fixtures,
    ...fixtureOverrides,
  };
  return {
    queryLog,
    deps: {
      createServiceClient: () => ({
        from: (table: string) => new MockQuery(table, dataset, queryLog),
      }),
      getCallerIdentity: async () => caller,
      getAccessibleClientIds: async () => accessibleClientIds,
      errorResponse: (message: string, status = 400) => Response.json({ error: message }, { status }),
      successResponse: (data: unknown, status = 200) => Response.json(data, { status }),
    },
  };
}

class MockQuery {
  private selected?: string;
  private filters: Filter[] = [];
  private maybe = false;

  constructor(
    private readonly table: string,
    private readonly dataset: typeof fixtures,
    private readonly queryLog: QueryLog[],
  ) {}

  select(columns: string) {
    this.selected = columns;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ op: "in", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ op: "is", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ op: "neq", column, value });
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  async maybeSingle() {
    this.maybe = true;
    const result = await this.execute();
    return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    this.queryLog.push({
      table: this.table,
      select: this.selected,
      filters: [...this.filters],
      maybeSingle: this.maybe,
    });

    let rows = [...((this.dataset as any)[this.table] ?? [])];
    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const value = row[filter.column];
        if (filter.op === "eq") return value === filter.value;
        if (filter.op === "in") return Array.isArray(filter.value) && filter.value.includes(value);
        if (filter.op === "is") return value === filter.value;
        if (filter.op === "neq") return value !== filter.value;
        return true;
      });
    }
    return { data: rows, error: null };
  }
}
