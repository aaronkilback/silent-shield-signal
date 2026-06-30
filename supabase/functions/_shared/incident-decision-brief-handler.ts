import {
  buildAuthorizedIncidentDecisionBrief,
  type IncidentBriefAnalysis,
  type IncidentBriefDebate,
  type IncidentBriefIncident,
  type IncidentBriefSignal,
} from "./incident-decision-brief.ts";

type CallerIdentity =
  | { kind: "service_role" }
  | { kind: "user"; userId: string; user: unknown }
  | { kind: "unauthorized"; error: string; status: number };

type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, value: unknown[]) => QueryBuilder;
  is: (column: string, value: unknown) => QueryBuilder;
  neq: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: Record<string, unknown>) => QueryBuilder;
  limit: (count: number) => QueryBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: <TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
};

type SupabaseLike = {
  from: (table: string) => QueryBuilder;
};

export interface IncidentDecisionBriefDeps {
  createServiceClient: () => SupabaseLike;
  getCallerIdentity: (req: Request) => Promise<CallerIdentity>;
  getAccessibleClientIds: (supabase: SupabaseLike, userId: string) => Promise<string[]>;
  errorResponse: (message: string, status?: number) => Response;
  successResponse: (data: unknown, status?: number) => Response;
}

export async function handleIncidentDecisionBriefRequest(req: Request, deps: IncidentDecisionBriefDeps): Promise<Response> {
  if (req.method !== "POST") {
    return deps.errorResponse("Method not allowed", 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const incidentId = typeof body.incident_id === "string" ? body.incident_id.trim() : "";
    if (!incidentId) {
      return deps.errorResponse("incident_id is required", 400);
    }
    if ("client_id" in body || "tenant_id" in body) {
      return deps.errorResponse("client_id and tenant_id are server-derived and are not accepted", 400);
    }

    const caller = await deps.getCallerIdentity(req);
    if (caller.kind === "unauthorized") {
      return deps.errorResponse(caller.error, caller.status);
    }
    if (caller.kind === "service_role") {
      return deps.errorResponse("User authentication is required for incident decision briefs", 403);
    }

    const supabase = deps.createServiceClient();
    const accessibleClientIds = await deps.getAccessibleClientIds(supabase, caller.userId);
    if (accessibleClientIds.length === 0) {
      return deps.errorResponse("Incident not found", 404);
    }

    const incident = await fetchAuthorizedIncident(supabase, incidentId, accessibleClientIds);
    if (!incident) {
      return deps.errorResponse("Incident not found", 404);
    }

    const linkSignalIds = await fetchIncidentSignalIds(supabase, incidentId);
    const scopedSignals = await fetchScopedSignals(
      supabase,
      uniqueStrings([...(incident.signal_id ? [incident.signal_id] : []), ...linkSignalIds]),
      incident,
    );
    const signalIds = scopedSignals.map((signal) => signal.id);
    const analyses = signalIds.length > 0 ? await fetchSignalAnalyses(supabase, signalIds) : [];
    const debate = await fetchLatestDebate(supabase, incidentId);

    const result = buildAuthorizedIncidentDecisionBrief({
      incident,
      accessibleClientIds,
      signals: scopedSignals,
      analyses,
      debate,
    });

    if (!result.ok) {
      return deps.errorResponse(result.error, result.status);
    }

    return deps.successResponse(result.brief);
  } catch (error) {
    console.error("[incident-decision-brief] unexpected error:", error);
    return deps.errorResponse("Unable to load incident decision brief", 500);
  }
}

async function fetchAuthorizedIncident(
  supabase: SupabaseLike,
  incidentId: string,
  accessibleClientIds: string[],
): Promise<(IncidentBriefIncident & { signal_id?: string | null }) | null> {
  const { data, error } = await supabase
    .from("incidents")
    .select("id,title,summary,priority,status,opened_at,acknowledged_at,contained_at,resolved_at,timeline_json,client_id,tenant_id,signal_id,provenance_summary")
    .eq("id", incidentId)
    .in("client_id", accessibleClientIds)
    .is("deleted_at", null)
    .neq("is_test", true)
    .maybeSingle();

  if (error) {
    console.error("[incident-decision-brief] incident lookup failed:", error);
    throw new Error("incident lookup failed");
  }

  return data as (IncidentBriefIncident & { signal_id?: string | null }) | null;
}

async function fetchIncidentSignalIds(supabase: SupabaseLike, incidentId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("incident_signals")
    .select("signal_id")
    .eq("incident_id", incidentId);

  if (error) {
    console.error("[incident-decision-brief] incident signal id lookup failed:", error);
    return [];
  }

  return (Array.isArray(data) ? data : [])
    .map((row: any) => row?.signal_id)
    .filter((id: unknown): id is string => typeof id === "string");
}

async function fetchScopedSignals(
  supabase: SupabaseLike,
  signalIds: string[],
  incident: IncidentBriefIncident,
): Promise<IncidentBriefSignal[]> {
  if (signalIds.length === 0 || !incident.client_id) return [];

  let query = supabase
    .from("signals")
    .select("id,signal_number,title,normalized_text,description,severity,category,status,quality_status,relevance_score,source_url,raw_json,created_at,client_id,tenant_id")
    .in("id", signalIds)
    .eq("client_id", incident.client_id);

  if (incident.tenant_id) {
    query = query.eq("tenant_id", incident.tenant_id);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[incident-decision-brief] scoped signals lookup failed:", error);
    return [];
  }

  return (Array.isArray(data) ? data : []) as IncidentBriefSignal[];
}

async function fetchSignalAnalyses(supabase: SupabaseLike, signalIds: string[]): Promise<IncidentBriefAnalysis[]> {
  const { data, error } = await supabase
    .from("signal_agent_analyses")
    .select("id,signal_id,agent_call_sign,analysis,confidence_score,trigger_reason,created_at")
    .in("signal_id", signalIds)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("[incident-decision-brief] analysis lookup failed:", error);
    return [];
  }

  return (Array.isArray(data) ? data : []) as IncidentBriefAnalysis[];
}

async function fetchLatestDebate(supabase: SupabaseLike, incidentId: string): Promise<IncidentBriefDebate | null> {
  const { data, error } = await supabase
    .from("agent_debate_records")
    .select("id,incident_id,final_assessment,consensus_score,judge_agent,debate_type,created_at")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[incident-decision-brief] debate lookup failed:", error);
    return null;
  }

  return data as IncidentBriefDebate | null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}
