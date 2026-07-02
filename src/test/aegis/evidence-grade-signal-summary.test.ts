import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildSignalEvidenceGrade,
  buildSignalTemporalContext,
} from "../../../supabase/functions/_shared/handlers-signals-incidents.ts";

const NOW = new Date("2026-07-02T12:00:00.000Z");

function baseSignal(overrides: Record<string, unknown> = {}) {
  return {
    id: "sig-123",
    title: "Observed access attempt near client facility",
    severity: "medium",
    status: "new",
    source_url: "https://source.example/security/story",
    event_date: "2026-07-01T10:00:00.000Z",
    received_at: "2026-07-02T10:00:00.000Z",
    created_at: "2026-07-02T10:01:00.000Z",
    confidence: 0.82,
    relevance_score: 0.78,
    quality_score: 0.9,
    ...overrides,
  };
}

function grade(signal: Record<string, unknown>) {
  const temporal = buildSignalTemporalContext(signal, NOW);
  return {
    temporal,
    evidence: buildSignalEvidenceGrade(signal, temporal),
  };
}

describe("Aegis evidence-grade recent signal summary contract", () => {
  it("labels missing source URL as not decision-grade", () => {
    const { evidence } = grade(baseSignal({ source_url: null }));

    expect(evidence.source_url).toBeNull();
    expect(evidence.source_label).toBe("source_unavailable");
    expect(evidence.support_label).toBe("not_decision_grade");
    expect(evidence.recommended_framing).toBe("hold_or_uncertain");
    expect(evidence.not_decision_grade_reasons).toContain("missing_source_url");
  });

  it("does not represent missing event date as current", () => {
    const { temporal, evidence } = grade(baseSignal({ event_date: null }));

    expect(temporal.age_category).toBe("undated");
    expect(temporal.warning).toContain("Do NOT present as current");
    expect(evidence.temporal_label).toBe("undated");
    expect(evidence.not_decision_grade_reasons).toContain("missing_event_date_cannot_be_current");
  });

  it("frames dated and historical signals with explicit temporal uncertainty", () => {
    const dated = grade(baseSignal({ event_date: "2026-05-01T00:00:00.000Z" }));
    const historical = grade(baseSignal({ event_date: "2024-01-01T00:00:00.000Z" }));

    expect(dated.temporal.age_category).toBe("dated");
    expect(dated.temporal.warning).toContain("DATED");
    expect(dated.evidence.support_label).toBe("not_decision_grade");
    expect(dated.evidence.not_decision_grade_reasons).toContain("dated_event_requires_temporal_context");

    expect(historical.temporal.age_category).toBe("historical");
    expect(historical.temporal.warning).toContain("HISTORICAL");
    expect(historical.evidence.not_decision_grade_reasons).toContain("historical_event_requires_temporal_context");
  });

  it("frames future-dated signals as scheduled/planned rather than current or completed", () => {
    const { temporal, evidence } = grade(baseSignal({ event_date: "2026-07-05T00:00:00.000Z" }));

    expect(temporal.age_category).toBe("future");
    expect(temporal.age_description).toBe("3 days in the future");
    expect(temporal.age_description).not.toContain("ago");
    expect(temporal.age_description).not.toMatch(/-\d/);
    expect(temporal.warning).toContain("FUTURE-DATED");
    expect(temporal.warning).toContain("Do NOT present as current or as proof that the event already occurred");
    expect(evidence.support_label).toBe("not_decision_grade");
    expect(evidence.recommended_framing).toBe("hold_or_uncertain");
    expect(evidence.not_decision_grade_reasons).toContain("future_event_date_requires_context");
  });

  it("frames low-confidence or weakly supported items as HOLD/uncertain using existing UI thresholds", () => {
    const lowConfidence = grade(baseSignal({ confidence: 0.29 }));
    const lowRelevance = grade(baseSignal({ relevance_score: 0.39 }));
    const lowQuality = grade(baseSignal({ quality_score: 0.39 }));

    expect(lowConfidence.evidence.recommended_framing).toBe("hold_or_uncertain");
    expect(lowConfidence.evidence.not_decision_grade_reasons).toContain("low_confidence_existing_signal_history_threshold");
    expect(lowRelevance.evidence.not_decision_grade_reasons).toContain("low_relevance_existing_signal_history_threshold");
    expect(lowQuality.evidence.not_decision_grade_reasons).toContain("low_quality_existing_signal_history_threshold");
  });

  it("keeps a well-sourced current signal citeable with ID and safe source URL", () => {
    const { temporal, evidence } = grade(baseSignal());

    expect(temporal.age_category).toBe("current");
    expect(evidence.signal_id).toBe("sig-123");
    expect(evidence.source_url).toBe("https://source.example/security/story");
    expect(evidence.source_label).toBe("source_available");
    expect(evidence.support_label).toBe("evidence_supported");
    expect(evidence.not_decision_grade_reasons).toEqual([]);
  });

  it("omits unsafe source URLs from evidence", () => {
    const { evidence } = grade(baseSignal({ source_url: "javascript:alert(1)" }));

    expect(evidence.source_url).toBeNull();
    expect(evidence.source_label).toBe("unsafe_source_omitted");
    expect(evidence.not_decision_grade_reasons).toContain("unsafe_source_url_omitted");
  });

  it("tool payload excludes raw_json and reasoning logs from get_recent_signals", () => {
    const handler = readFileSync(join(process.cwd(), "supabase/functions/_shared/handlers-signals-incidents.ts"), "utf8");
    const getRecentSignalsBlock = handler.slice(
      handler.indexOf("get_recent_signals:"),
      handler.indexOf("  // R2 (Task #107)", handler.indexOf("get_recent_signals:")),
    );

    expect(getRecentSignalsBlock).not.toContain("raw_json");
    expect(getRecentSignalsBlock).not.toContain("reasoning_log");
    expect(getRecentSignalsBlock).toContain("evidence_grade");
    expect(getRecentSignalsBlock).toContain("temporal_context");
    expect(getRecentSignalsBlock).toContain(".eq(\"tenant_id\", tenantId)");
    expect(getRecentSignalsBlock).toContain(".eq(\"clients.tenant_id\", tenantId)");
  });

  it("Aegis prompt requires the evidence-grade signal summary sections", () => {
    const dashboard = readFileSync(join(process.cwd(), "supabase/functions/dashboard-ai-assistant/index.ts"), "utf8");

    expect(dashboard).toContain("RECENT SIGNAL SUMMARY CONTRACT");
    expect(dashboard).toContain("1. What changed");
    expect(dashboard).toContain("2. Why it matters");
    expect(dashboard).toContain("3. What remains uncertain or is not decision-grade");
    expect(dashboard).toContain("4. Evidence");
    expect(dashboard).toContain("Never expose raw raw_json, reasoning_log");
    expect(dashboard).toContain("Do NOT present an undated, unparseable-date, dated, or historical signal as current");
    expect(dashboard).toContain("Do NOT present a future-dated signal as current or as proof that an event already occurred");
  });
});
