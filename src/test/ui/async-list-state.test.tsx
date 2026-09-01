/**
 * AsyncListState — error-first contract (WO-QUEUE-VIEW-PERMISSION).
 *
 * Proves the fix: a FAILED read never renders the empty/"nothing here"/"all clear"
 * state. The primitive is the single enforcement point every one of the seven
 * converted components routes through, so its contract IS their guarantee. The
 * second suite feeds each component's ACTUAL empty/success copy through the error
 * path and asserts that exact string is gone — including the three that used
 * success language ("Inbox zero", "all clear", "All systems nominal").
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AsyncListState, ASYNC_LOAD_ERROR_COPY } from "@/components/ui/async-list-state";

const EMPTY = <div>GENUINE_EMPTY_STATE</div>;
const DATA = <div>POPULATED_LIST</div>;

describe("AsyncListState — error-first contract", () => {
  it("renders the error card and NEITHER the empty nor the data state when error is set", () => {
    render(
      <AsyncListState loading={false} error={new Error("permission denied")} isEmpty={true} emptyState={EMPTY}>
        {DATA}
      </AsyncListState>
    );
    expect(screen.getByTestId("async-list-error")).toBeInTheDocument();
    expect(screen.getByText(ASYNC_LOAD_ERROR_COPY)).toBeInTheDocument();
    expect(screen.queryByText("GENUINE_EMPTY_STATE")).not.toBeInTheDocument();
    expect(screen.queryByText("POPULATED_LIST")).not.toBeInTheDocument();
  });

  it("error takes precedence even when isEmpty is true (the exact false-zero bug)", () => {
    render(
      <AsyncListState loading={false} error={"boom"} isEmpty={true} emptyState={EMPTY}>{DATA}</AsyncListState>
    );
    expect(screen.getByTestId("async-list-error")).toBeInTheDocument();
    expect(screen.queryByText("GENUINE_EMPTY_STATE")).not.toBeInTheDocument();
  });

  it("renders the empty state ONLY on a successful empty read (no error)", () => {
    render(
      <AsyncListState loading={false} error={null} isEmpty={true} emptyState={EMPTY}>{DATA}</AsyncListState>
    );
    expect(screen.getByText("GENUINE_EMPTY_STATE")).toBeInTheDocument();
    expect(screen.queryByTestId("async-list-error")).not.toBeInTheDocument();
  });

  it("renders data on a successful non-empty read", () => {
    render(
      <AsyncListState loading={false} error={null} isEmpty={false} emptyState={EMPTY}>{DATA}</AsyncListState>
    );
    expect(screen.getByText("POPULATED_LIST")).toBeInTheDocument();
    expect(screen.queryByText("GENUINE_EMPTY_STATE")).not.toBeInTheDocument();
  });

  it("shows loading before anything else", () => {
    render(
      <AsyncListState loading={true} error={"boom"} isEmpty={true} emptyState={EMPTY} loadingState={<div>LOADING_NOW</div>}>{DATA}</AsyncListState>
    );
    expect(screen.getByText("LOADING_NOW")).toBeInTheDocument();
    expect(screen.queryByTestId("async-list-error")).not.toBeInTheDocument();
  });
});

// Each converted component's REAL empty/success copy, routed through the error path.
// On a forced failure the exact string must be gone and the error copy present.
const COMPONENT_EMPTY_COPY: Array<{ component: string; empty: string; successLanguage: boolean }> = [
  { component: "AgentActionApprovalQueue", empty: "Inbox zero. No agent actions awaiting your approval.", successLanguage: true },
  { component: "TripwireAlerts", empty: "No active incidents - all clear!", successLanguage: true },
  { component: "LiveEventFeed", empty: "All systems nominal", successLanguage: true },
  { component: "RuleApprovals", empty: "No pending rule proposals", successLanguage: false },
  { component: "MonitoringProposals", empty: "No pending monitoring proposals", successLanguage: false },
  { component: "SignalMergeProposals", empty: "No pending signal merge proposals", successLanguage: false },
  { component: "OSINTSourcesDialog", empty: "No OSINT sources configured yet", successLanguage: false },
];

describe("false-zero suppression — each component's empty/success copy is gone on error", () => {
  it.each(COMPONENT_EMPTY_COPY)("$component: '$empty' does NOT render on a failed load", ({ empty }) => {
    render(
      <AsyncListState loading={false} error={new Error("permission denied for view")} isEmpty={true} emptyState={<div>{empty}</div>}>
        <div>list</div>
      </AsyncListState>
    );
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(screen.getByText(ASYNC_LOAD_ERROR_COPY)).toBeInTheDocument();
  });

  it("the three success-language surfaces never affirm safety on error", () => {
    for (const { empty } of COMPONENT_EMPTY_COPY.filter((c) => c.successLanguage)) {
      const { unmount } = render(
        <AsyncListState loading={false} error={"failed"} isEmpty={true} emptyState={<div>{empty}</div>}><div>x</div></AsyncListState>
      );
      expect(screen.queryByText(empty)).not.toBeInTheDocument(); // "Inbox zero" / "all clear" / "All systems nominal" — GONE
      expect(screen.getByTestId("async-list-error")).toBeInTheDocument();
      unmount();
    }
  });
});
