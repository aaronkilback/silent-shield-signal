// Reader for Module #1 output (subject-retrieval → subject_exposure_items). Reads via the authorized
// `subject-exposure` edge function (RLS deny-by-default on the tables; the function does service-role read
// + caller authorization). Renders the five delivery requirements:
//   1. Third-party exposure first, self-published second, visually separated.
//   2. One item, N locations — a case is ONE finding with its sources listed beneath, not N findings.
//   3. Every location shows URL + provenance (found_by_query) + capture date — the auditability claim.
//   4. Obscurity rank visible; ordering is buried-first (rank 40 > rank 1).
//   5. subject_awareness (known|unknown|disputed) settable per item at delivery — the product metric.
// Reading is NOT a scan. A fresh scan is an explicit action (the "Run fresh scan" button) — never on view.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RefreshCw, ChevronDown, ExternalLink, Eye, EyeOff, Loader2, ShieldAlert, UserCircle } from "lucide-react";
import { format } from "date-fns";

interface Location {
  url: string; domain?: string; platform?: string; title?: string;
  found_by_query?: string; found_at_rank?: number; date_captured?: string; phase?: number;
}
interface ExposureItem {
  id: string; category: string; title: string; summary?: string; severity?: string;
  source_class?: string; subject_awareness?: string | null; updated_at?: string;
  locations: Location[]; location_count: number; obscurity_rank: number;
}
interface ReadResult {
  thirdParty: ExposureItem[]; selfPublished: ExposureItem[];
  lastScan?: { id: string; status: string; started_at: string; finished_at?: string; counts?: Record<string, unknown> } | null;
  counts: { third_party_items: number; self_published_items: number };
}

const SEV_COLOR: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};
const AWARENESS_COLOR: Record<string, string> = {
  unknown: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",        // the valuable ones — they did NOT know
  disputed: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  known: "bg-muted text-muted-foreground",
};

export function ReputationalExposurePanel({ entityId }: { entityId: string | null }) {
  const { toast } = useToast();
  const [rescanning, setRescanning] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["subject-exposure", entityId],
    enabled: !!entityId,
    queryFn: async (): Promise<ReadResult> => {
      const { data, error } = await supabase.functions.invoke("subject-exposure", { body: { action: "read", entityId } });
      if (error) throw new Error(error.message);
      return (data?.data ?? data) as ReadResult;
    },
  });

  const runFreshScan = async () => {
    if (!entityId) return;
    setRescanning(true);
    try {
      const { data: res, error } = await supabase.functions.invoke("subject-exposure", { body: { action: "rescan", entityId } });
      if (error || (res?.data ?? res)?.error) throw new Error(error?.message ?? (res?.data ?? res)?.error ?? "rescan failed");
      const scanId = (res?.data ?? res)?.scanId;
      toast({ title: "Fresh scan started", description: `Deep scan ${String(scanId).slice(0, 8)} running (~1 min). Refresh to see new findings when it completes.` });
    } catch (e) {
      toast({ title: "Scan failed to start", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setRescanning(false);
    }
  };

  const setAwareness = async (itemId: string, awareness: string) => {
    try {
      const { error } = await supabase.functions.invoke("subject-exposure", { body: { action: "set_awareness", itemId, awareness } });
      if (error) throw new Error(error.message);
      refetch();
    } catch (e) {
      toast({ title: "Could not save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  if (!entityId) return null;
  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading exposure…</div>;

  const tp = data?.thirdParty ?? [];
  const sp = data?.selfPublished ?? [];
  const last = data?.lastScan;

  return (
    <div className="space-y-4">
      {/* Header: last scan status + explicit fresh-scan action (reading is never a scan) */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-muted-foreground">
          {last ? (
            <span>
              Last scan <Badge variant="outline" className="ml-1">{last.status}</Badge>{" "}
              {last.finished_at ? `· ${format(new Date(last.finished_at), "MMM d, HH:mm")}` : last.status === "started" ? "· running…" : ""}
            </span>
          ) : <span>No scan has been run for this subject yet.</span>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRefetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={runFreshScan} disabled={rescanning}>
            {rescanning ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <ShieldAlert className="h-3.5 w-3.5 mr-1" />} Run fresh scan
          </Button>
        </div>
      </div>

      {/* Requirement 1: third-party FIRST — "what is out there about you" */}
      <Section
        icon={<ShieldAlert className="h-4 w-4 text-orange-500" />}
        title="Third-party exposure"
        subtitle="What is out there about the subject — written by others."
        items={tp} onAwareness={setAwareness}
        empty="No third-party exposure found. Run a scan to collect it."
      />
      {/* Requirement 1: self-published SECOND — "what you are publishing about yourself", visually separated */}
      <Section
        icon={<UserCircle className="h-4 w-4 text-muted-foreground" />}
        title="Self-published footprint"
        subtitle="What the subject publishes about themselves — reported, ranked separately."
        items={sp} onAwareness={setAwareness}
        empty="No self-published accounts surfaced."
        muted
      />
    </div>
  );
}

function Section({ icon, title, subtitle, items, onAwareness, empty, muted }: {
  icon: React.ReactNode; title: string; subtitle: string; items: ExposureItem[];
  onAwareness: (id: string, a: string) => void; empty: string; muted?: boolean;
}) {
  return (
    <div className={`rounded-lg border ${muted ? "border-dashed" : ""} p-3 space-y-3`}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">{subtitle}</p>
      {items.length === 0
        ? <p className="text-sm text-muted-foreground italic py-2">{empty}</p>
        : items.map((it) => <ItemCard key={it.id} item={it} onAwareness={onAwareness} />)}
    </div>
  );
}

// Requirement 2: ONE item, N locations — a single finding with its sources beneath it.
function ItemCard({ item, onAwareness }: { item: ExposureItem; onAwareness: (id: string, a: string) => void }) {
  const [open, setOpen] = useState(false);
  const buried = item.obscurity_rank >= 999 ? "—" : `#${item.obscurity_rank}`;
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {item.severity && <Badge className={SEV_COLOR[item.severity] ?? ""}>{item.severity}</Badge>}
            <Badge variant="outline" className="capitalize">{item.category}</Badge>
            {/* Requirement 4: obscurity rank visible */}
            <span className="text-xs text-muted-foreground" title="Shallowest search rank this appears at — more buried = higher value">
              buried at {buried}
            </span>
          </div>
          <p className="font-medium text-sm mt-1 truncate">{item.title}</p>
          {item.summary && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.summary}</p>}
        </div>
        {/* Requirement 5: subject_awareness per item, set at delivery */}
        <div className="shrink-0">
          <Select value={item.subject_awareness ?? undefined} onValueChange={(v) => onAwareness(item.id, v)}>
            <SelectTrigger className={`h-7 w-[130px] text-xs ${item.subject_awareness ? AWARENESS_COLOR[item.subject_awareness] : ""}`}>
              <SelectValue placeholder="awareness…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unknown">Unknown (did not know)</SelectItem>
              <SelectItem value="disputed">Disputed</SelectItem>
              <SelectItem value="known">Known already</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Requirement 2 + 3: the N locations beneath the one finding, each with URL + provenance + capture date */}
      <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
        <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          {item.location_count} source{item.location_count === 1 ? "" : "s"}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {item.locations.map((l, i) => (
            <div key={i} className="rounded border bg-muted/30 p-2 text-xs space-y-1">
              <a href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline break-all">
                <ExternalLink className="h-3 w-3 shrink-0" /> {l.domain ?? l.url}
                {typeof l.found_at_rank === "number" && <span className="text-muted-foreground ml-1">(rank {l.found_at_rank})</span>}
              </a>
              {l.title && <p className="text-muted-foreground line-clamp-1">{l.title}</p>}
              {/* Requirement 3: provenance + capture date — the auditability claim, made visible */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                {l.found_by_query && <span title="The query that surfaced this — provenance"><Eye className="h-3 w-3 inline mr-0.5" />{l.found_by_query}</span>}
                {l.date_captured && <span title="Capture date"><EyeOff className="h-3 w-3 inline mr-0.5" />{format(new Date(l.date_captured), "MMM d, yyyy")}</span>}
              </div>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
