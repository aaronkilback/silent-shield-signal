import { describe, expect, it } from "vitest";
import {
  buildAuthorizedIncidentDecisionBrief,
  filterIncidentBoundarySignals,
  type IncidentBriefIncident,
  type IncidentBriefSignal,
} from "../../../supabase/functions/_shared/incident-decision-brief";

const now = new Date("2026-06-30T12:00:00Z");

function incident(overrides: Partial<IncidentBriefIncident> = {}): IncidentBriefIncident {
  return {
    id: "incident-1",
    title: "Fixture incident",
    priority: "p2",
    status: "open",
    opened_at: "2026-06-30T10:00:00Z",
    client_id: "client-a",
    tenant_id: "tenant-a",
    timeline_json: [{ event: "Opened", timestamp: "2026-06-30T10:00:00Z" }],
    ...overrides,
  };
}

function signal(overrides: Partial<IncidentBriefSignal> = {}): IncidentBriefSignal {
  return {
    id: "signal-1",
    signal_number: "SIG-1",
    severity: "medium",
    status: "new",
    quality_status: "ok",
    relevance_score: 0.9,
    source_url: "https://example.test/source",
    created_at: "2026-06-30T11:00:00Z",
    client_id: "client-a",
    tenant_id: "tenant-a",
    ...overrides,
  };
}

describe("Incident Decision Brief authorization and decision rules", () => {
  it("does not produce a brief for an incident outside server-derived accessible clients", () => {
    const result = buildAuthorizedIncidentDecisionBrief({
      incident: incident({ client_id: "client-b" }),
      accessibleClientIds: ["client-a"],
      signals: [signal({ client_id: "client-b" })],
      now,
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ status: 404, error: "Incident not found" });
  });

  it("filters linked signals outside the incident client and tenant boundary", () => {
    const scopedIncident = incident();
    const { allowedSignals, omittedCount } = filterIncidentBoundarySignals(scopedIncident, [
      signal({ id: "allowed" }),
      signal({ id: "wrong-client", client_id: "client-b" }),
      signal({ id: "wrong-tenant", tenant_id: "tenant-b" }),
    ]);

    expect(allowedSignals.map((item) => item.id)).toEqual(["allowed"]);
    expect(omittedCount).toBe(2);
  });

  it("returns the exact hold text when evidence is absent or not decision-grade", () => {
    const result = buildAuthorizedIncidentDecisionBrief({
      incident: incident(),
      accessibleClientIds: ["client-a"],
      signals: [signal({ source_url: null, relevance_score: 0.1 })],
      now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brief.recommendation).toBe("hold");
      expect(result.brief.recommendation_text).toBe("HOLD — insufficient evidence to recommend action");
      expect(result.brief.not_decision_grade[0].text).toContain("not decision-grade evidence");
      expect(result.brief.not_decision_grade[0].text).not.toContain("noise");
    }
  });

  it("escalates only when source-backed current evidence is severe enough", () => {
    const result = buildAuthorizedIncidentDecisionBrief({
      incident: incident({ priority: "p1" }),
      accessibleClientIds: ["client-a"],
      signals: [signal({ severity: "high" })],
      now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brief.recommendation).toBe("escalate");
      expect(result.brief.evidence_threshold).toContain("current and source-backed");
      expect(result.brief.supporting_records.some((record) => record.url === "https://example.test/source")).toBe(true);
    }
  });

  it("investigates when source-backed evidence has existing assessment context", () => {
    const result = buildAuthorizedIncidentDecisionBrief({
      incident: incident(),
      accessibleClientIds: ["client-a"],
      signals: [signal()],
      analyses: [{
        id: "analysis-1",
        signal_id: "signal-1",
        agent_call_sign: "Aegis",
        analysis: "Client-safe fixture summary",
        confidence_score: 0.7,
        created_at: "2026-06-30T11:10:00Z",
      }],
      now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.brief.recommendation).toBe("investigate");
      expect(result.brief.supporting_records.map((record) => record.id)).toContain("analysis:analysis-1");
    }
  });
});
