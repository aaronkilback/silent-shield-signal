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

  investigationInsert.mockReturnValue({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: { id: "investigation-1" },
        error: null,
      }),
    })),
  });
});

describe("Investigations create flow client context", () => {
  it("blocks tenant-only creation before template assist or investigation insert", async () => {
    renderInvestigations();

    await screen.findByText("Create First Investigation");
    fireEvent.click(screen.getByRole("button", { name: /create first investigation/i }));

    expect(toast.error).toHaveBeenCalledWith("Select a client before creating an investigation.");
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(investigationInsert).not.toHaveBeenCalled();
  });

  it("blocks a stale foreign selected client before template assist or investigation insert", async () => {
    mockUseClientSelection.mockReturnValue({
      selectedClientId: "client-foreign",
      isContextReady: true,
    });
    mockUseTenantScopedClientIds.mockReturnValue({
      clientIds: ["client-a"],
    });

    renderInvestigations();

    await screen.findByText("No investigations yet");
    fireEvent.click(screen.getByRole("button", { name: /new investigation/i }));

    expect(toast.error).toHaveBeenCalledWith(
      "Select a client within the current tenant before creating an investigation."
    );
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(investigationInsert).not.toHaveBeenCalled();
  });

  it("uses the sanitized create error instead of exposing the raw database constraint", async () => {
    mockUseClientSelection.mockReturnValue({
      selectedClientId: "client-a",
      isContextReady: true,
    });
    investigationInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: {
            message:
              'new row for relation "investigations" violates check constraint "chk_investigations_provenance"',
          },
        }),
      })),
    });

    renderInvestigations();

    await screen.findByText("No investigations yet");
    fireEvent.click(screen.getByRole("button", { name: /new investigation/i }));

    await waitFor(() => {
      expect(investigationInsert).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: "client-a" })
      );
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Failed to create investigation. Check the selected client and try again."
    );
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringContaining("chk_investigations_provenance")
    );
  });
});
