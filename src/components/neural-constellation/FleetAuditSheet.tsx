import { useState, useMemo } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useFleetPersonaAudit, type FleetAuditRow } from "@/hooks/useConstellationData";
import { Search, ArrowUpDown } from "lucide-react";

/**
 * Fleet Persona Audit — one-screen view of every active agent's
 * fidelity proxies. Operator scans the matrix to spot drift outliers
 * (zero debates, low consensus, never-as-judge for command-tier
 * agents, claim text that doesn't match the stated lane).
 *
 * Columns: agent | stated lane | debates 7d | avg consensus | as judge
 * | tied to incidents | sample claim. Sortable by any numeric column.
 *
 * Read-only. Click an agent name to open the full per-agent Persona
 * Audit panel (TODO: wire up — for now it's display-only). A drift
 * outlier shows up as a row that visually breaks pattern: the row
 * with debates_7d=0 looks empty, the row whose consensus is amber
 * stands out, the row whose sample-claim doesn't match the stated
 * lane reads weird side-by-side.
 */

type SortKey = "callSign" | "debates7d" | "avgConsensus" | "timesAsJudge" | "tiedToIncidents";

interface FleetAuditSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAgent?: (callSign: string) => void;
}

export function FleetAuditSheet({ open, onOpenChange, onSelectAgent }: FleetAuditSheetProps) {
  const { data: rows = [], isLoading } = useFleetPersonaAudit(open);
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("debates7d");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let result = q
      ? rows.filter((r) =>
          r.callSign.toLowerCase().includes(q) ||
          r.statedLane.toLowerCase().includes(q) ||
          (r.sampleClaim?.toLowerCase().includes(q) ?? false)
        )
      : rows;
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "callSign") cmp = a.callSign.localeCompare(b.callSign);
      else if (sortKey === "avgConsensus") {
        const av = a.avgConsensus ?? -1;
        const bv = b.avgConsensus ?? -1;
        cmp = av - bv;
      } else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [rows, filter, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[1100px] max-w-[95vw] sm:max-w-[95vw] overflow-hidden flex flex-col">
        <SheetHeader>
          <SheetTitle className="text-foreground tracking-wider">Fleet Persona Audit</SheetTitle>
          <p className="text-xs text-muted-foreground">
            Every active agent's stated lane vs. actual behavior over the last 7 days.
            Compare the persona excerpt to the sample claim to spot drift; sort by debates / consensus / judge-count to spot quiet specialists.
          </p>
        </SheetHeader>

        <div className="flex items-center gap-2 my-3">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by call sign, persona, or claim text…"
              className="pl-8 h-8 text-xs"
            />
          </div>
          <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
            {filtered.length}/{rows.length} agents
          </span>
        </div>

        <div className="flex-1 overflow-auto border border-border rounded">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card border-b border-border">
              <tr className="text-left">
                <SortHeader label="Agent" k="callSign" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
                <th className="px-2 py-2 font-semibold text-muted-foreground/80">Stated Lane (excerpt)</th>
                <SortHeader label="Debates 7d" k="debates7d" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} numeric />
                <SortHeader label="Avg Consensus" k="avgConsensus" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} numeric />
                <SortHeader label="As Judge" k="timesAsJudge" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} numeric />
                <SortHeader label="→ Incidents" k="tiedToIncidents" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} numeric />
                <th className="px-2 py-2 font-semibold text-muted-foreground/80">Most Recent Claim</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">No agents match.</td></tr>
              )}
              {filtered.map((r) => (
                <FleetRow key={r.callSign} row={r} onSelect={onSelectAgent} />
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[9px] text-muted-foreground mt-2 px-1">
          Reading the matrix: rows with <strong>Debates 7d = 0</strong> are silent on the debate path
          (may still be active via direct invocation). <strong>As Judge ≥ 1</strong> means another agent or
          AEGIS picked them to adjudicate — strong signal of trusted positioning. <strong>→ Incidents</strong>
          counts debates that became real escalations. Compare the <strong>Stated Lane</strong> column to the
          <strong> Most Recent Claim</strong> — if the voice doesn't match, that's drift to investigate.
        </p>
      </SheetContent>
    </Sheet>
  );
}

function SortHeader({ label, k, sortKey, sortDir, onClick, numeric }: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onClick: (k: SortKey) => void;
  numeric?: boolean;
}) {
  const active = sortKey === k;
  return (
    <th className={`px-2 py-2 font-semibold text-muted-foreground/80 cursor-pointer hover:text-foreground select-none ${numeric ? "text-right" : ""}`}
        onClick={() => onClick(k)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "opacity-100 text-cyan-400" : "opacity-30"}`} />
        {active && <span className="text-[8px] text-cyan-400">{sortDir}</span>}
      </span>
    </th>
  );
}

function FleetRow({ row, onSelect }: { row: FleetAuditRow; onSelect?: (cs: string) => void }) {
  const consensusColor =
    row.avgConsensus == null ? "text-muted-foreground" :
    row.avgConsensus >= 0.7 ? "text-emerald-400" :
    row.avgConsensus >= 0.4 ? "text-amber-400" : "text-red-400";
  const debateRowTone =
    row.debates7d === 0 ? "opacity-50 bg-card/20" :
    row.debates7d >= 5 ? "bg-emerald-950/15" : "";
  return (
    <tr
      className={`border-b border-border/40 align-top hover:bg-accent/5 cursor-pointer ${debateRowTone}`}
      onClick={() => onSelect?.(row.callSign)}
    >
      <td className="px-2 py-2 font-mono font-bold text-cyan-400 whitespace-nowrap">{row.callSign}</td>
      <td className="px-2 py-2 text-foreground/85 italic max-w-[280px]">
        <div className="line-clamp-3">{row.statedLane}</div>
      </td>
      <td className="px-2 py-2 text-right font-mono">{row.debates7d}</td>
      <td className={`px-2 py-2 text-right font-mono ${consensusColor}`}>
        {row.avgConsensus != null ? `${Math.round(row.avgConsensus * 100)}%` : "—"}
      </td>
      <td className="px-2 py-2 text-right font-mono text-cyan-400">{row.timesAsJudge || ""}</td>
      <td className="px-2 py-2 text-right font-mono text-amber-400">{row.tiedToIncidents || ""}</td>
      <td className="px-2 py-2 text-foreground/80 italic max-w-[300px]">
        {row.sampleClaim ? (
          <div className="line-clamp-3">"{row.sampleClaim}"</div>
        ) : (
          <span className="text-muted-foreground/60 not-italic">—</span>
        )}
      </td>
    </tr>
  );
}
