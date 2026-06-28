import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Investigations from "@/pages/Investigations";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const mockNavigate = vi.fn();
const mockUseClientSelection = vi.fn();
const mockUseTenantScopedClientIds = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "operator-1", email: "operator@example.test" },
    loading: false,
  }),
}));

vi.mock("@/hooks/useClientSelection", () => ({
  useClientSelection: () => mockUseClientSelection(),
}));

vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({ isAllTenantsView: false }),
}));

vi.mock("@/hooks/useTenantScopedClientIds", () => ({
  useTenantScopedClientIds: () => mockUseTenantScopedClientIds(),
}));

const investigationInsert = vi.fn();

const renderInvestigations = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/investigations"]}>
        <Investigations />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();

  mockUseClientSelection.mockReturnValue({
    selectedClientId: null,
    isContextReady: true,
  });
  mockUseTenantScopedClientIds.mockReturnValue({
    clientIds: ["client-a"],
  });

  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: { templates: [] },
    error: null,
  });
  vi.mocked(supabase.rpc).mockResolvedValue({
    data: { id: "investigation-1", file_number: "INV-2026-0065" },
    error: null,
  } as any);

  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "profiles") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { name: "Operator One" },
              error: null,
            }),
          })),
        })),
      } as any;
    }

    if (table === "investigations") {
      return {
        select: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        insert: investigationInsert,
      } as any;
    }

    return {
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    } as any;
  });

  investigationInsert.mockReset();
});

describe("Investigations create flow client context", () => {
  it.each([
    {
      name: "missing client context",
      selectedClientId: null,
      tenantClientIds: undefined,
      message: "Client context is still loading. Try again in a moment.",
    },
    {
      name: "tenant-only context",
      selectedClientId: null,
      tenantClientIds: ["client-a"],
      message: "Select a client before creating an investigation.",
    },
    {
      name: "stale selected client",
      selectedClientId: "client-stale",
      tenantClientIds: ["client-a"],
      message: "Select a client within the current tenant before creating an investigation.",
    },
    {
      name: "foreign selected client",
      selectedClientId: "client-foreign",
      tenantClientIds: ["client-a"],
      message: "Select a client within the current tenant before creating an investigation.",
    },
  ])(
    "blocks $name before template assist or investigation persistence",
    async ({ selectedClientId, tenantClientIds, message }) => {
      mockUseClientSelection.mockReturnValue({
        selectedClientId,
        isContextReady: true,
      });
      mockUseTenantScopedClientIds.mockReturnValue({
        clientIds: tenantClientIds,
      });

      renderInvestigations();

      fireEvent.click(await screen.findByRole("button", { name: /new investigation/i }));

      expect(toast.error).toHaveBeenCalledWith(message);
      expect(supabase.functions.invoke).not.toHaveBeenCalled();
      expect(investigationInsert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    }
  );

  it("uses the sanitized create error instead of exposing the raw database constraint", async () => {
    mockUseClientSelection.mockReturnValue({
      selectedClientId: "client-a",
      isContextReady: true,
    });
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: {
        message:
          'new row for relation "investigations" violates check constraint "chk_investigations_provenance"',
      },
    } as any);

    renderInvestigations();

    await screen.findByText("No investigations yet");
    fireEvent.click(screen.getByRole("button", { name: /new investigation/i }));

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith("investigation-ai-assist", {
        body: { action: "suggest_template", client_id: "client-a" },
      });
    });
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("create_investigation_v2", {
        p_client_id: "client-a",
        p_incident_id: null,
        p_template_id: null,
      });
    });
    expect(investigationInsert).not.toHaveBeenCalled();

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to create investigation. Check the selected client and try again."
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringContaining("chk_investigations_provenance")
    );
  });

  it("creates through the server authority without submitting a file number override", async () => {
    mockUseClientSelection.mockReturnValue({
      selectedClientId: "client-a",
      isContextReady: true,
    });

    renderInvestigations();

    await screen.findByText("No investigations yet");
    fireEvent.click(screen.getByRole("button", { name: /new investigation/i }));

    await waitFor(() => {
      expect(supabase.functions.invoke).toHaveBeenCalledWith("investigation-ai-assist", {
        body: { action: "suggest_template", client_id: "client-a" },
      });
    });
    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith("create_investigation_v2", {
        p_client_id: "client-a",
        p_incident_id: null,
        p_template_id: null,
      });
    });
    expect(JSON.stringify(vi.mocked(supabase.rpc).mock.calls)).not.toContain("file_number");
    expect(investigationInsert).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Investigation file INV-2026-0065 created");
  });
});
