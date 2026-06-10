import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useClientSelection } from "@/hooks/useClientSelection";
import { useTenant } from "@/hooks/useTenant";
import { resolveTenantScope, realtimeTenantFilter } from "@/lib/realtime-tenant-filter";
import { getClientNoun } from "@/lib/ui-profile";

interface Client {
  id: string;
  name: string;
  organization: string;
  status: string;
}

interface ClientSelectorProps {
  /** 
   * Mode determines the behavior:
   * - 'navigate': Navigates to client detail page on selection (for Clients page)
   * - 'filter': Updates global client filter context (for dashboards)
   */
  mode?: 'navigate' | 'filter';
  /** Custom title override */
  title?: string;
  /** Custom description override */
  description?: string;
  /** Compact mode hides card wrapper */
  compact?: boolean;
}

/**
 * Unified client selector component that can be used for:
 * - Navigation to client details (mode='navigate')
 * - Filtering dashboard data by client (mode='filter')
 */
export const ClientSelector = ({
  mode = 'filter',
  title,
  description,
  compact = false
}: ClientSelectorProps) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  // Both setters exposed: setSelectedClientId is the system-intent
  // setter used only for the initial-mount auto-pick below;
  // selectByUser carries explicit user intent and is the channel
  // the validation effects in useClientSelection respect (fix A).
  const { selectedClientId, setSelectedClientId, selectByUser } = useClientSelection();
  const { currentTenant, isAllTenantsView, getFilterTenantIds } = useTenant();
  // PROD-CC fix A: gate auto-select-first-client to the first
  // fetchClients per mount. Subsequent refetches (realtime channel,
  // tenant switch) update the dropdown list but MUST NOT auto-mutate
  // selectedClientId — that was the cascading-bounce trigger.
  const hasAutoSelectedRef = useRef(false);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    // PROD-CC fix D: track the user-id this effect was initialized
    // with so we can ignore auth events (TOKEN_REFRESHED, etc.) that
    // arrive for the same user. Mirrors PROD-U's user→user?.id fix
    // for DashboardAIAssistant. Without this, every ~50min token
    // refresh tore down + recreated the realtime channel + refetched
    // clients, which fed the auto-select cascade fixed in A.
    let lastUserId: string | null = null;

    const init = async (session: any) => {
      if (!session?.user) {
        setLoading(false);
        return;
      }

      await fetchClients();

      // Tenant boundary on the realtime channel (super_admin bypasses RLS).
      // fetchClients() is already tenant-scoped; this stops other tenants'
      // client rows from crossing the wire and triggering refetches. `clients`
      // carries tenant_id, so the server-side filter is exact.
      const scope = resolveTenantScope(getFilterTenantIds());
      if (scope.kind !== "deny") {
        channel = supabase
          .channel(`client-selector-changes-${scope.kind === "tenant" ? scope.tenantId : "all"}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'clients',
              ...realtimeTenantFilter(scope),
            },
            () => {
              fetchClients();
            }
          )
          .subscribe();
      }
    };

    // Check current session first, then listen for auth changes
    supabase.auth.getSession().then(({ data: { session } }) => {
      lastUserId = session?.user?.id ?? null;
      init(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUserId = session?.user?.id ?? null;
      if (currentUserId === lastUserId) {
        // PROD-CC fix D: same user, no re-init. PROD-U pattern.
        return;
      }
      lastUserId = currentUserId;
      init(session);
    });

    return () => {
      subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
    // currentTenant?.id + isAllTenantsView added so the dropdown
    // refetches against the new tenant scope every time the operator
    // switches tenants. Without these deps the list is captured once
    // on mount and never narrows.
  }, [currentTenant?.id, isAllTenantsView]);

  const fetchClients = async () => {
    try {
      // 2026-05-10: filter to active clients only. The dropdown was
      // surfacing internal sandboxes (_benchmark_*, _qa_test_client)
      // alongside real clients, which an operator could accidentally
      // select and see test fixtures instead of live signals. Inactive
      // clients still exist for the benchmark + QA pipelines, they
      // just shouldn't appear in the operator-facing filter.
      let query = supabase
        .from("clients")
        .select("id, name, organization, status")
        .eq("status", "active")
        .order("name", { ascending: true });

      // 2026-05-19: tenant scope cascade. Super_admin RLS bypass would
      // otherwise surface every client across every tenant in this
      // dropdown, which is exactly the cross-tenant Petronas leak we
      // saw after the tenant-switch landed. Skipped in All-Tenants
      // view so super_admin's global mode still sees everything.
      //
      // 2026-06-10 fail-closed fix: the original guard
      // `currentTenant?.id && !isAllTenantsView` only SCOPED when a
      // tenant was already selected — when currentTenant was null AND
      // not in All-Tenants view (super_admin who hasn't picked a tenant,
      // or TenantProvider still hydrating; debug shows tenant: null,
      // isAllTenantsView: false) BOTH branches were skipped and the
      // query fell through to "all active clients across all tenants".
      // That leaked BC Place + Trent Reznor (Critical Risk Team) into
      // the Silent Shield Operations operator's dropdown. Global
      // enumeration must be gated STRICTLY behind the explicit
      // All-Tenants view; any other no-tenant state fails closed (empty)
      // rather than enumerating every tenant's clients. Aligns with the
      // TenantProvider fail-closed doctrine ("never enumerate accessible
      // tenants") and the ambiguous-scope-fails-closed rule below.
      if (!isAllTenantsView) {
        if (currentTenant?.id) {
          query = query.eq("tenant_id", currentTenant.id);
        } else {
          setClients([]);
          setLoading(false);
          return;
        }
      }

      const { data, error } = await query;

      if (error) throw error;
      // PROD-J fix A (2026-05-23): exclude underscore-prefixed fixture /
      // QA / invariant-test clients (e.g. _invariant_client_a,
      // _benchmark_petronas, _qa_cipher_test_env). The status='active'
      // filter alone doesn't catch these — invariant tests need
      // status='active' to exercise real RLS paths in CI. Aligns this
      // dropdown with the fixture doctrine in
      // RiskSnapshotExport.tsx:48 and the new _shared/archetypes.ts
      // isFixtureClient() helper. Operator-facing surface only —
      // fixtures still exist in the table and still drive their tests.
      const filtered = (data || []).filter(
        (c) => typeof c.name === 'string' && !c.name.startsWith('_')
      );
      setClients(filtered);

      // PROD-CC fix A (2026-05-24): auto-select-first-client now fires
      // ONLY on the first fetchClients per component mount. Subsequent
      // refetches — from the realtime channel, from a tenant switch,
      // from any other trigger — update the dropdown list but MUST
      // NOT auto-mutate selectedClientId.
      //
      // PROD-CC fix A2 (2026-05-24, post-real-user-failure): also
      // skip auto-select entirely when isAllTenantsView === true.
      //
      // PROD-CC test surfaced that even with the one-shot gate, the
      // alphabetical fallback (filtered[0]) lands the super_admin on
      // BC Place (0bbbbbbb-...) which belongs to a DIFFERENT tenant
      // (0aaaaaaa-... CRT) than the operator's working context
      // (Petronas / feff5c44-... Silent Shield Operations). PROD-CC
      // fix A then makes that wrong pick sticky.
      //
      // Doctrine: ambiguous scope fails closed, not "guesses
      // alphabetical first". In all-tenants mode no per-tenant
      // boundary exists to constrain the candidate list — so any
      // automatic pick is a tenant-contamination risk. Operator must
      // pick explicitly. Dropdown renders the placeholder until they
      // do. Aligns with Fortress quarantine doctrine ("indistinguishable
      // from row-not-found") and FORTRESS_DATA doctrine ("explicit
      // ownership or skip").
      //
      // The previous auto-CLEAR branches (stale selection / zero
      // clients in scope) were removed: their job is now owned by the
      // user-intent-gated validation effects in useClientSelection
      // (cross-tenant + all-tenants self-heal). Keeping a duplicate
      // here re-introduced the bouncing cascade.
      //
      // PROD-J fix A (fixture filtering) is preserved because filtered
      // is what feeds the dropdown — fixtures still can't be picked.
      if (mode === 'filter' && !hasAutoSelectedRef.current && !isAllTenantsView) {
        hasAutoSelectedRef.current = true;
        if (filtered.length > 0 && !selectedClientId) {
          // No prior selection at all (fresh session, cleared localStorage):
          // auto-pick the first listed client so the dashboard has scope.
          // SAFE in non-all-tenants mode because filtered is already
          // tenant-scoped by the query above — filtered[0] is guaranteed
          // to belong to the operator's current tenant.
          // This is the only auto-mutation; intentionally NOT routed
          // through selectByUser — it is system intent, so any later
          // validation failure won't auto-clear it (per Fix A doctrine).
          setSelectedClientId(filtered[0].id);
        }
      }
    } catch (error) {
      console.error("Error fetching clients:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleValueChange = (value: string) => {
    if (mode === 'navigate') {
      navigate(`/client/${value}`);
    } else {
      // PROD-CC fix A: route picker changes through selectByUser so
      // the validation effects in useClientSelection are allowed to
      // self-heal this selection if it later becomes invalid (cross-
      // tenant, deleted, fixture, etc.). System-set selections stay
      // sticky and are only warning-logged.
      selectByUser(value);
    }
  };

  // currentTenant already destructured at the top of the component
  // (line 54) for the fetchClients tenant filter. Re-using it for the
  // noun lookup so we don't double-declare the binding.
  const noun = getClientNoun(currentTenant?.settings);
  const displayTitle = title || (mode === 'navigate' ? `Select ${noun.singular}` : `${noun.singular} Filter`);
  const displayDescription = description || (
    mode === 'navigate'
      ? `Choose ${/^[aeiou]/i.test(noun.singularLower) ? 'an' : 'a'} ${noun.singularLower} to view their details and reports`
      : `View signals and data for selected ${noun.singularLower}`
  );

  // PROD-CC fix C (2026-05-24): keep the Select always-controlled in
  // filter mode. Previously this oscillated between `string` and
  // `undefined` whenever selectedClientId flipped between a uuid and
  // null, which is the canonical React controlled/uncontrolled
  // warning trigger Aaron observed in the prod console. A constant
  // sentinel keeps the value prop always a string in filter mode.
  // Radix Select treats a value that doesn't match any SelectItem as
  // "no selection" — the placeholder renders. Navigate mode is
  // intentionally left always-uncontrolled (value={undefined}) since
  // navigation triggers immediately on pick; no state lives here.
  const NO_CLIENT_SENTINEL = '__no_client_selected__';
  const selectElement = (
    <Select
      value={mode === 'filter' ? (selectedClientId ?? NO_CLIENT_SENTINEL) : undefined}
      onValueChange={handleValueChange}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder={`Select ${/^[aeiou]/i.test(noun.singularLower) ? 'an' : 'a'} ${noun.singularLower}...`} />
      </SelectTrigger>
      <SelectContent>
        {clients.map((client) => (
          <SelectItem key={client.id} value={client.id}>
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              <span>{client.name}</span>
              {client.organization && (
                <span className="text-muted-foreground">({client.organization})</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (compact) {
    if (loading) {
      return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
    }
    return selectElement;
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (clients.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            {displayTitle}
          </CardTitle>
          <CardDescription>
            No clients found. Please onboard a client first.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          {displayTitle}
        </CardTitle>
        <CardDescription>
          {displayDescription}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {selectElement}
      </CardContent>
    </Card>
  );
};

// Legacy export for backwards compatibility
export const DashboardClientSelector = () => <ClientSelector mode="filter" />;