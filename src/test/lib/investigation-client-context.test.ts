import { describe, expect, it } from "vitest";
import { resolveInvestigationClientContext } from "@/lib/investigation-client-context";
import { buildCreateInvestigationV2Args } from "@/lib/investigation-create-authority";

describe("investigation client context", () => {
  it("uses an existing valid current client context in all-tenants view", () => {
    const result = resolveInvestigationClientContext({
      selectedClientId: "client-current",
      tenantClientIds: null,
    });

    expect(result).toEqual({ ok: true, clientId: "client-current" });
    if (result.ok) {
      expect(buildCreateInvestigationV2Args({ clientId: result.clientId })).toEqual({
        p_client_id: "client-current",
        p_incident_id: null,
        p_template_id: null,
      });
    }
  });

  it("blocks tenant-only context with no selected client before insert", () => {
    const result = resolveInvestigationClientContext({
      selectedClientId: null,
      tenantClientIds: ["client-a", "client-b"],
    });

    expect(result).toEqual({
      ok: false,
      message: "Select a client before creating an investigation.",
    });
  });

  it("uses a selected client within the current tenant", () => {
    const result = resolveInvestigationClientContext({
      selectedClientId: "client-b",
      tenantClientIds: ["client-a", "client-b"],
    });

    expect(result).toEqual({ ok: true, clientId: "client-b" });
    if (result.ok) {
      expect(buildCreateInvestigationV2Args({ clientId: result.clientId })).toEqual({
        p_client_id: "client-b",
        p_incident_id: null,
        p_template_id: null,
      });
    }
  });

  it("blocks a foreign or invalid selected client in tenant scope", () => {
    const result = resolveInvestigationClientContext({
      selectedClientId: "client-foreign",
      tenantClientIds: ["client-a", "client-b"],
    });

    expect(result).toEqual({
      ok: false,
      message: "Select a client within the current tenant before creating an investigation.",
    });
  });

  it("blocks creation when a tenant has no eligible clients", () => {
    const result = resolveInvestigationClientContext({
      selectedClientId: null,
      tenantClientIds: [],
    });

    expect(result).toEqual({
      ok: false,
      message: "No eligible clients are available for this tenant.",
    });
  });
});
