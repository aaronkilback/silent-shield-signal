import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AegisStatusLine } from "@/components/DashboardAIAssistant";

describe("AegisStatusLine", () => {
  it("renders the truthful history loading label as an accessible status", () => {
    render(<AegisStatusLine state="history" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading conversation history…");
  });

  it("renders the truthful attachment upload label as an accessible status", () => {
    render(<AegisStatusLine state="uploading" />);

    expect(screen.getByRole("status")).toHaveTextContent("Uploading attachment…");
  });

  it("renders the truthful response waiting label as an accessible status", () => {
    render(<AegisStatusLine state="responding" />);

    expect(screen.getByRole("status")).toHaveTextContent("Aegis is responding…");
  });
});
