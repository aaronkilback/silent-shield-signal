export type DecisionBriefAction =
  | "escalate"
  | "watch"
  | "investigate"
  | "close_reclassify"
  | "hold";

export type DecisionConfidence = "high" | "medium" | "low";

export type DecisionEvidenceGrade = "decision_grade" | "not_decision_grade";

export interface IncidentBriefIncident {
  id: string;
  title?: string | null;
  summary?: string | null;
  priority?: string | null;
  status?: string | null;
  opened_at?: string | null;
  acknowledged_at?: string | null;
  contained_at?: string | null;
  resolved_at?: string | null;
  client_id?: string | null;
  tenant_id?: string | null;
  timeline_json?: unknown[] | null;
  provenance_summary?: string | null;
}

export interface IncidentBriefSignal {
  id: string;
  signal_number?: string | null;
  title?: string | null;
  normalized_text?: string | null;
  description?: string | null;
  severity?: string | null;
  category?: string | null;
  status?: string | null;
  quality_status?: string | null;
  relevance_score?: number | null;
  source_url?: string | null;
  raw_json?: Record<string, unknown> | null;
  created_at?: string | null;
  client_id?: string | null;
  tenant_id?: string | null;
}

export interface IncidentBriefAnalysis {
  id: string;
  signal_id?: string | null;
  agent_call_sign?: string | null;
  analysis?: string | null;
  confidence_score?: number | null;
  trigger_reason?: string | null;
  created_at?: string | null;
}

export interface IncidentBriefDebate {
  id: string;
  incident_id?: string | null;
  final_assessment?: string | null;
  consensus_score?: number | null;
  judge_agent?: string | null;
  debate_type?: string | null;
  created_at?: string | null;
}

export interface BriefSourceRecord {
  id: string;
  type: "incident" | "timeline" | "signal" | "analysis" | "debate";
  label: string;
  url?: string;
  timestamp?: string | null;
}

export interface BriefClaim {
  text: string;
  source_ids: string[];
}

export interface BriefEvidenceItem {
  record: BriefSourceRecord;
  grade: DecisionEvidenceGrade;
  reason: string;
}

export interface IncidentDecisionBrief {
  recommendation: DecisionBriefAction;
  recommendation_label: string;
  recommendation_text: string;
  confidence: DecisionConfidence;
  evidence_threshold: string;
  what_changed: BriefClaim[];
  what_matters: BriefClaim[];
  not_decision_grade: BriefClaim[];
  next_steps: BriefClaim[];
  supporting_records: BriefSourceRecord[];
  evidence_items: BriefEvidenceItem[];
  omitted_cross_boundary_signal_count: number;
}

export interface AuthorizedBriefInput {
  incident: IncidentBriefIncident;
  accessibleClientIds: string[];
  signals: IncidentBriefSignal[];
  analyses?: IncidentBriefAnalysis[];
  debate?: IncidentBriefDebate | null;
  now?: Date;
}

export type AuthorizedBriefResult =
  | { ok: true; brief: IncidentDecisionBrief }
  | { ok: false; status: 403 | 404 | 409; error: string };

const HOLD_TEXT = "HOLD — insufficient evidence to recommend action";
const CURRENT_EVIDENCE_WINDOW_HOURS = 96;

export function buildAuthorizedIncidentDecisionBrief(input: AuthorizedBriefInput): AuthorizedBriefResult {
  const incidentClientId = input.incident.client_id;
  if (!incidentClientId || !input.accessibleClientIds.includes(incidentClientId)) {
    return { ok: false, status: 404, error: "Incident not found" };
  }

  const status = input.incident.status?.toLowerCase();
  if (status === "resolved" || status === "closed") {
    return {
      ok: false,
      status: 409,
      error: "Decision brief is only available for open incidents",
    };
  }

  return {
    ok: true,
    brief: buildIncidentDecisionBrief(input),
  };
}

export function buildIncidentDecisionBrief(input: AuthorizedBriefInput): IncidentDecisionBrief {
  const now = input.now ?? new Date();
  const incidentSource = incidentRecord(input.incident);
  const timelineSources = timelineRecords(input.incident);
  const signalItems = input.signals.map((signal) => gradeSignal(signal, now));
  const decisionGradeSignals = signalItems.filter((item) => item.grade === "decision_grade");
  const notDecisionGradeSignals = signalItems.filter((item) => item.grade === "not_decision_grade");
  const analyses = (input.analyses ?? []).filter((analysis) => {
    const signalId = analysis.signal_id;
    return Boolean(signalId && input.signals.some((signal) => signal.id === signalId));
  });

  const analysisSources = analyses.slice(0, 5).map((analysis) => ({
    id: `analysis:${analysis.id}`,
    type: "analysis" as const,
    label: `${analysis.agent_call_sign || "Agent"} analysis`,
    timestamp: analysis.created_at ?? null,
  }));

  const debateSource = input.debate?.id
    ? [{
        id: `debate:${input.debate.id}`,
        type: "debate" as const,
        label: "Aegis debate assessment",
        timestamp: input.debate.created_at ?? null,
      }]
    : [];

  const supportingRecords = [
    incidentSource,
    ...timelineSources,
    ...signalItems.map((item) => item.record),
    ...analysisSources,
    ...debateSource,
  ];

  const whatChanged: BriefClaim[] = [
    {
      text: `Incident opened with status ${input.incident.status || "unknown"} and priority ${input.incident.priority || "unknown"}.`,
      source_ids: [incidentSource.id],
    },
    ...timelineSources.slice(0, 3).map((record) => ({
      text: `Timeline update recorded: ${record.label}.`,
      source_ids: [record.id],
    })),
    ...decisionGradeSignals.slice(0, 3).map((item) => ({
      text: `${item.record.label} added decision-grade evidence for this incident.`,
      source_ids: [item.record.id],
    })),
  ];

  const whatMatters: BriefClaim[] = [
    ...decisionGradeSignals.slice(0, 3).map((item) => ({
      text: `${item.record.label} is current, relevant, and source-backed.`,
      source_ids: [item.record.id],
    })),
    ...analysisSources.slice(0, 2).map((record) => ({
      text: `${record.label} is available as supporting assessment, without exposing internal reasoning logs.`,
      source_ids: [record.id],
    })),
    ...debateSource.map((record) => ({
      text: "Aegis debate assessment is available as supporting context.",
      source_ids: [record.id],
    })),
  ];

  const notDecisionGrade: BriefClaim[] = notDecisionGradeSignals.map((item) => ({
    text: `${item.record.label} is not decision-grade evidence: ${item.reason}.`,
    source_ids: [item.record.id],
  }));

  const action = selectDecisionAction(input.incident, decisionGradeSignals, notDecisionGradeSignals, analyses, input.debate);
  const confidence = selectConfidence(action, decisionGradeSignals.length, analyses.length, input.debate);
  const threshold = thresholdForAction(action);
  const recommendationText = action === "hold"
    ? HOLD_TEXT
    : `${labelForAction(action)} — ${threshold}`;

  return {
    recommendation: action,
    recommendation_label: labelForAction(action),
    recommendation_text: recommendationText,
    confidence,
    evidence_threshold: threshold,
    what_changed: whatChanged.length > 0 ? whatChanged : [{
      text: "No source-backed incident change is available.",
      source_ids: [incidentSource.id],
    }],
    what_matters: whatMatters,
    not_decision_grade: notDecisionGrade,
    next_steps: nextStepsForAction(action, decisionGradeSignals, incidentSource),
    supporting_records: supportingRecords,
    evidence_items: signalItems,
    omitted_cross_boundary_signal_count: 0,
  };
}

export function filterIncidentBoundarySignals(
  incident: IncidentBriefIncident,
  signals: IncidentBriefSignal[],
): { allowedSignals: IncidentBriefSignal[]; omittedCount: number } {
  const allowedSignals = signals.filter((signal) => {
    if (signal.client_id && incident.client_id && signal.client_id !== incident.client_id) return false;
    if (signal.tenant_id && incident.tenant_id && signal.tenant_id !== incident.tenant_id) return false;
    return true;
  });
  return { allowedSignals, omittedCount: signals.length - allowedSignals.length };
}

function selectDecisionAction(
  incident: IncidentBriefIncident,
  decisionGradeSignals: BriefEvidenceItem[],
  notDecisionGradeSignals: BriefEvidenceItem[],
  analyses: IncidentBriefAnalysis[],
  debate?: IncidentBriefDebate | null,
): DecisionBriefAction {
  if (hasResolutionEvidence(incident)) return "close_reclassify";
  if (decisionGradeSignals.length === 0) return "hold";

  const priority = incident.priority?.toLowerCase();
  const severeSignal = decisionGradeSignals.some((item) => {
    const label = item.record.label.toLowerCase();
    return label.includes("critical") || label.includes("high");
  });
  if (priority === "p1" || priority === "critical" || severeSignal) return "escalate";

  if (debate?.final_assessment || analyses.length > 0) return "investigate";
  if (notDecisionGradeSignals.length > 0 || decisionGradeSignals.length < 2) return "watch";
  return "investigate";
}

function selectConfidence(
  action: DecisionBriefAction,
  decisionGradeCount: number,
  analysisCount: number,
  debate?: IncidentBriefDebate | null,
): DecisionConfidence {
  if (action === "hold") return "low";
  if (debate?.final_assessment || decisionGradeCount >= 2 || analysisCount >= 2) return "high";
  if (decisionGradeCount === 1 || analysisCount === 1) return "medium";
  return "low";
}

function thresholdForAction(action: DecisionBriefAction): string {
  switch (action) {
    case "escalate":
      return "evidence is current and source-backed, with high severity or priority requiring immediate attention";
    case "watch":
      return "incident is plausible, but evidence is incomplete or still developing";
    case "investigate":
      return "source-backed evidence supports a defined unresolved question requiring structured follow-up";
    case "close_reclassify":
      return "available records support false positive, duplication, or clear resolution";
    case "hold":
      return "available records are absent, unsupported, conflicting, or not decision-grade";
  }
}

function nextStepsForAction(action: DecisionBriefAction, decisionGradeSignals: BriefEvidenceItem[], incidentSource: BriefSourceRecord): BriefClaim[] {
  if (action === "hold") {
    return [{
      text: HOLD_TEXT,
      source_ids: [incidentSource.id],
    }];
  }
  if (action === "escalate") {
    return [{
      text: "Escalate to the incident owner and preserve the cited source records before taking containment action.",
      source_ids: decisionGradeSignals.slice(0, 2).map((item) => item.record.id),
    }];
  }
  if (action === "watch") {
    return [{
      text: "Continue monitoring and wait for corroborating source-backed evidence before escalation.",
      source_ids: decisionGradeSignals.slice(0, 1).map((item) => item.record.id),
    }];
  }
  if (action === "investigate") {
    return [{
      text: "Open a structured follow-up question tied to the cited records and verify the unresolved impact.",
      source_ids: decisionGradeSignals.slice(0, 2).map((item) => item.record.id),
    }];
  }
  return [{
    text: "Confirm false-positive, duplicate, or resolved status against the cited record before reclassification.",
    source_ids: [incidentSource.id],
  }];
}

function gradeSignal(signal: IncidentBriefSignal, now: Date): BriefEvidenceItem {
  const record = signalRecord(signal);
  const issues: string[] = [];
  const sourceUrl = extractSourceUrl(signal);
  if (!sourceUrl) issues.push("missing visible source URL");
  if (!isCurrent(signal.created_at, now)) issues.push("not current enough for this decision");
  if (isLowRelevance(signal.relevance_score)) issues.push("low relevance to this incident");
  if (isLowQuality(signal.quality_status)) issues.push("low quality or quarantined signal status");
  if (isUnsupportedStatus(signal.status)) issues.push("signal status is not decision-supporting");

  return {
    record: sourceUrl ? { ...record, url: sourceUrl } : record,
    grade: issues.length === 0 ? "decision_grade" : "not_decision_grade",
    reason: issues.length === 0 ? "current, relevant, and source-backed" : issues.join("; "),
  };
}

function incidentRecord(incident: IncidentBriefIncident): BriefSourceRecord {
  return {
    id: `incident:${incident.id}`,
    type: "incident",
    label: incident.title || `Incident ${incident.id.slice(0, 8)}`,
    timestamp: incident.opened_at ?? null,
  };
}

function timelineRecords(incident: IncidentBriefIncident): BriefSourceRecord[] {
  const entries = Array.isArray(incident.timeline_json) ? incident.timeline_json : [];
  return entries.slice(0, 5).map((entry, index) => {
    const item = typeof entry === "object" && entry !== null ? entry as Record<string, unknown> : {};
    const label = String(item.event || item.action || `Timeline event ${index + 1}`);
    const timestamp = typeof item.timestamp === "string" ? item.timestamp : null;
    return {
      id: `timeline:${incident.id}:${index}`,
      type: "timeline" as const,
      label,
      timestamp,
    };
  });
}

function signalRecord(signal: IncidentBriefSignal): BriefSourceRecord {
  const severity = signal.severity ? ` (${signal.severity})` : "";
  return {
    id: `signal:${signal.id}`,
    type: "signal",
    label: `${signal.signal_number || signal.title || `Signal ${signal.id.slice(0, 8)}`}${severity}`,
    timestamp: signal.created_at ?? null,
  };
}

function extractSourceUrl(signal: IncidentBriefSignal): string | undefined {
  if (isUrl(signal.source_url)) return signal.source_url ?? undefined;
  return undefined;
}

function isUrl(value?: string | null): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isCurrent(timestamp: string | null | undefined, now: Date): boolean {
  if (!timestamp) return false;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return false;
  const hours = (now.getTime() - parsed.getTime()) / (1000 * 60 * 60);
  return hours >= 0 && hours <= CURRENT_EVIDENCE_WINDOW_HOURS;
}

function isLowRelevance(score: number | null | undefined): boolean {
  return typeof score === "number" && score < 0.5;
}

function isLowQuality(status: string | null | undefined): boolean {
  if (!status) return false;
  return ["low", "poor", "quarantined", "rejected", "spam"].includes(status.toLowerCase());
}

function isUnsupportedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return ["false_positive", "duplicate", "archived", "rejected"].includes(status.toLowerCase());
}

function hasResolutionEvidence(incident: IncidentBriefIncident): boolean {
  const status = incident.status?.toLowerCase();
  const summary = `${incident.summary || ""} ${incident.provenance_summary || ""}`.toLowerCase();
  return status === "false_positive"
    || status === "duplicate"
    || summary.includes("false positive")
    || summary.includes("duplicate")
    || summary.includes("resolved");
}

function labelForAction(action: DecisionBriefAction): string {
  switch (action) {
    case "escalate":
      return "Escalate";
    case "watch":
      return "Watch";
    case "investigate":
      return "Investigate";
    case "close_reclassify":
      return "Close/Reclassify";
    case "hold":
      return "Hold";
  }
}
