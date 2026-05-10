/**
 * RiskMatrixGrid — 5x5 risk-rating UI matching the operator's SRA format.
 *
 * Phase 2F. One row per risk category. Operator picks Likelihood
 * (1-5) and Impact (A-E); the rating cell ("Medium 2C") + band are
 * derived. AI may pre-populate based on captured features (e.g. no
 * fence + remote location + high-value target → elevated theft).
 *
 * Designed for mobile — vertical stack of risk categories, each with
 * tappable likelihood + impact selectors and a derived rating chip.
 */

import { useState, useEffect, useMemo } from "react";
import { Loader2, Sparkles, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type RiskCategory,
  type ImpactLetter,
  type RatingBand,
  RISK_CATEGORY_LABEL,
  LIKELIHOOD_LABEL,
  IMPACT_LABEL,
  deriveRating,
  useRiskRatings,
  useUpsertRiskRating,
  type RiskRating,
} from "@/hooks/useAuditReport";

interface RiskMatrixGridProps {
  auditId: string;
  /** Categories the operator should rate. Default: all 9. */
  categories?: RiskCategory[];
}

const DEFAULT_CATEGORIES: RiskCategory[] = [
  "theft_vandalism",
  "sabotage",
  "physical_intrusion",
  "environmental_damage",
  "wildfire_exposure",
  "wildlife_force_majeure",
  "insider_threat",
  "tampering_supply_chain",
  "cyber_ot_compromise",
  "protest_disruption",
];

const BAND_CLASS: Record<RatingBand, string> = {
  low:           "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  medium:        "bg-amber-100  text-amber-900   dark:bg-amber-900/30   dark:text-amber-200",
  high:          "bg-orange-200 text-orange-900  dark:bg-orange-900/40  dark:text-orange-100",
  severe:        "bg-red-200    text-red-900     dark:bg-red-900/40     dark:text-red-100",
  catastrophic:  "bg-red-600    text-white       dark:bg-red-700",
};

export function RiskMatrixGrid({ auditId, categories = DEFAULT_CATEGORIES }: RiskMatrixGridProps) {
  const { data: ratings, isLoading } = useRiskRatings(auditId);

  const byCategory = useMemo(() => {
    const m = new Map<RiskCategory, RiskRating>();
    for (const r of ratings ?? []) m.set(r.risk_category, r);
    return m;
  }, [ratings]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading risk matrix…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {categories.map((cat) => (
        <RiskRow
          key={cat}
          auditId={auditId}
          category={cat}
          existing={byCategory.get(cat)}
        />
      ))}
    </div>
  );
}

interface RiskRowProps {
  auditId: string;
  category: RiskCategory;
  existing: RiskRating | undefined;
}

function RiskRow({ auditId, category, existing }: RiskRowProps) {
  const upsert = useUpsertRiskRating();
  const [likelihood, setLikelihood] = useState<number>(existing?.likelihood ?? 0);
  const [impact, setImpact] = useState<ImpactLetter | null>(existing?.impact ?? null);
  const [rationale, setRationale] = useState(existing?.rationale ?? "");
  const [showRationale, setShowRationale] = useState(false);

  // If the row was just hydrated, sync once.
  useEffect(() => {
    if (existing) {
      setLikelihood(existing.likelihood);
      setImpact(existing.impact);
      setRationale(existing.rationale ?? "");
    }
  }, [existing?.id]);

  const derived = likelihood >= 1 && impact ? deriveRating(likelihood, impact) : null;

  const persist = (l: number, i: ImpactLetter | null, r: string) => {
    if (l < 1 || !i) return;
    upsert.mutate({
      audit_id: auditId,
      risk_category: category,
      likelihood: l as 1 | 2 | 3 | 4 | 5,
      impact: i,
      rationale: r || undefined,
      derived_by: existing?.derived_by === "ai" && (l !== existing.likelihood || i !== existing.impact || r !== (existing.rationale ?? ""))
        ? "ai_then_human_edited"
        : "operator",
    });
  };

  return (
    <div className="rounded border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-medium truncate">{RISK_CATEGORY_LABEL[category]}</span>
          {existing?.derived_by === "ai" && (
            <span className="text-xs text-amber-600 flex items-center gap-0.5">
              <Sparkles className="w-3 h-3" /> AI-proposed
            </span>
          )}
          {existing?.derived_by === "ai_then_human_edited" && (
            <span className="text-xs text-blue-600 flex items-center gap-0.5">
              <Edit3 className="w-3 h-3" /> edited
            </span>
          )}
        </div>
        {derived && (
          <span className={`text-xs px-2 py-0.5 rounded font-medium whitespace-nowrap ${BAND_CLASS[derived.band]}`}>
            {derived.label}
          </span>
        )}
      </div>

      {/* Likelihood */}
      <div>
        <Label className="text-xs text-muted-foreground">Likelihood</Label>
        <div className="grid grid-cols-5 gap-1 mt-0.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setLikelihood(n);
                persist(n, impact, rationale);
              }}
              className={`text-xs py-1.5 rounded border transition-colors ${
                likelihood === n
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-accent border-foreground/20"
              }`}
            >
              <div className="font-medium">{n}</div>
              <div className="text-[10px] opacity-80 truncate">{LIKELIHOOD_LABEL[n as 1 | 2 | 3 | 4 | 5]}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Impact */}
      <div>
        <Label className="text-xs text-muted-foreground">Impact</Label>
        <div className="grid grid-cols-5 gap-1 mt-0.5">
          {(["A","B","C","D","E"] as const).map((letter) => (
            <button
              key={letter}
              type="button"
              onClick={() => {
                setImpact(letter);
                persist(likelihood, letter, rationale);
              }}
              className={`text-xs py-1.5 rounded border transition-colors ${
                impact === letter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-accent border-foreground/20"
              }`}
            >
              <div className="font-medium">{letter}</div>
              <div className="text-[10px] opacity-80 truncate">{IMPACT_LABEL[letter]}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Rationale toggle */}
      <div>
        {showRationale ? (
          <Textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            onBlur={() => persist(likelihood, impact, rationale)}
            placeholder="Why this rating? (optional, will appear in the report)"
            rows={2}
            className="text-sm"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowRationale(true)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {rationale ? `Rationale: ${rationale.substring(0, 60)}${rationale.length > 60 ? "…" : ""}` : "+ Add rationale"}
          </button>
        )}
      </div>
    </div>
  );
}
