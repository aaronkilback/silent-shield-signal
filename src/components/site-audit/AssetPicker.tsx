/**
 * AssetPicker — pre-wizard step where the operator selects which
 * client_asset to audit. If the asset doesn't exist yet (first time
 * walking a new site), they create it inline. The created asset is
 * marked source='audit' and confidence=0.5 — the audit itself will
 * raise confidence to 1.0 on completion via the DB trigger.
 *
 * Mobile-first because operators reach this screen from a vehicle
 * pulled up to the gate, not a desk.
 */

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, MapPin } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useClientAssets,
  useCreateClientAsset,
  useStartAudit,
  type AssetClass,
  type ClientAsset,
} from "@/hooks/useSiteAudit";

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  oil_gas_plant: "Oil & gas plant",
  well_pad: "Well pad",
  pipeline_section: "Pipeline section",
  office: "Office",
  event_venue: "Event venue",
  residence: "Residence",
  field_office: "Field office",
  infrastructure_node: "Infrastructure node",
  other: "Other",
};

interface AssetPickerProps {
  onAuditStarted: (auditId: string) => void;
}

export function AssetPicker({ onAuditStarted }: AssetPickerProps) {
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newClass, setNewClass] = useState<AssetClass>("oil_gas_plant");
  const [newExternalRef, setNewExternalRef] = useState("");

  const { data: clients } = useQuery({
    queryKey: ["site-audit-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, status")
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return (data ?? []).filter((c: any) => typeof c.name === "string" && !c.name.startsWith("_"));
    },
  });

  const { data: assets, isLoading: assetsLoading } = useClientAssets(selectedClientId || null);

  const createAsset = useCreateClientAsset();
  const startAudit = useStartAudit();

  const handleStart = async () => {
    if (!selectedAssetId || !selectedClientId) return;
    try {
      const audit = await startAudit.mutateAsync({
        asset_id: selectedAssetId,
        client_id: selectedClientId,
      });
      onAuditStarted(audit.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start audit");
    }
  };

  const handleCreate = async () => {
    if (!selectedClientId || !newName.trim()) {
      toast.error("Client and asset name required");
      return;
    }
    try {
      const asset = await createAsset.mutateAsync({
        client_id: selectedClientId,
        name: newName.trim(),
        asset_class: newClass,
        external_ref: newExternalRef.trim() || undefined,
      });
      setSelectedAssetId(asset.id);
      setCreating(false);
      setNewName("");
      setNewExternalRef("");
      toast.success(`Asset created: ${asset.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create asset");
    }
  };

  const sortedAssets = useMemo(() => {
    if (!assets) return [];
    return [...assets].sort((a, b) => a.name.localeCompare(b.name));
  }, [assets]);

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Start Site Audit
          </CardTitle>
          <CardDescription>
            Pick the client and the site you're walking. If the site isn't on file yet, create it before starting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Client</Label>
            <Select value={selectedClientId} onValueChange={(v) => { setSelectedClientId(v); setSelectedAssetId(""); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select a client…" />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedClientId && (
            <div className="space-y-2">
              <Label>Site / Asset</Label>
              {assetsLoading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : sortedAssets.length === 0 ? (
                <div className="text-sm text-muted-foreground p-3 border border-dashed rounded">
                  No sites on file for this client yet. Create the first one below.
                </div>
              ) : (
                <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a site…" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedAssets.map((a: ClientAsset) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} <span className="text-muted-foreground text-xs">· {ASSET_CLASS_LABELS[a.asset_class]}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {!creating && (
                <Button variant="ghost" size="sm" onClick={() => setCreating(true)} className="text-xs">
                  <Plus className="w-3 h-3 mr-1" /> Site not listed — create new
                </Button>
              )}
            </div>
          )}

          {creating && selectedClientId && (
            <div className="rounded border p-3 space-y-3 bg-muted/30">
              <div className="text-sm font-medium">Create new site</div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. D-035-D water facility" />
              </div>
              <div className="space-y-2">
                <Label>Class</Label>
                <Select value={newClass} onValueChange={(v) => setNewClass(v as AssetClass)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSET_CLASS_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Operator's reference (optional)</Label>
                <Input value={newExternalRef} onChange={(e) => setNewExternalRef(e.target.value)} placeholder="e.g. INC153479" />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={createAsset.isPending} size="sm">
                  {createAsset.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                  Create
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setNewName(""); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <Button
            onClick={handleStart}
            disabled={!selectedAssetId || startAudit.isPending}
            className="w-full"
            size="lg"
          >
            {startAudit.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Start Audit
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
