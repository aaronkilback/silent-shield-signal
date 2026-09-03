import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface BriefClaim {
  text: string;
  source_ids: string[];
}

interface BriefSourceRecord {
  id: string;
  type: string;
  label: string;
  url?: string;
  timestamp?: string | null;
}

interface IncidentDecisionBrief {
  recommendation_label: string;
  recommendation_text: string;
  confidence: "high" | "medium" | "low";
  evidence_threshold: string;
  what_changed: BriefClaim[];
  what_matters: BriefClaim[];
  not_decision_grade: BriefClaim[];
  next_steps: BriefClaim[];
  supporting_records: BriefSourceRecord[];
  omitted_cross_boundary_signal_count: number;
}

interface IncidentDecisionBriefPanelProps {
  incidentId: string;
  enabled: boolean;
}

export function IncidentDecisionBriefPanel({ incidentId, enabled }: IncidentDecisionBriefPanelProps) {
  const [brief, setBrief] = useState<IncidentDecisionBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadBrief() {
      if (!enabled || !incidentId) return;
      setLoading(true);
      setError(null);
      const { data, error: invokeError } = await supabase.functions.invoke("incident-decision-brief", {
        body: { incident_id: incidentId },
      });
      if (cancelled) return;
      if (invokeError) {
        setBrief(null);
        setError("Decision brief is unavailable for this incident.");
      } else {
        setBrief(data as IncidentDecisionBrief);
      }
      setLoading(false);
    }
    loadBrief();
    return () => {
      cancelled = true;
    };
  }, [enabled, incidentId]);

  if (!enabled) return null;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading Aegis decision brief
        </CardContent>
      </Card>
    );
  }

  if (error || !brief) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 p-4 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <span>{error || "Decision brief is not available."}</span>
        </CardContent>
      </Card>
    );
  }

  const sourcesById = new Map(brief.supporting_records.map((record) => [record.id, record]));

  return (
    <Card>
      <CardHeader className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Aegis Decision Brief</CardTitle>
          <Badge variant={brief.recommendation_label === "Hold" ? "outline" : "default"}>
            {brief.recommendation_label}
          </Badge>
          <Badge variant="secondary">{brief.confidence} confidence</Badge>
        </div>
        <CardDescription>{brief.recommendation_text}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          Evidence threshold: {brief.evidence_threshold}
        </div>

        <BriefSection title="What changed" claims={brief.what_changed} sourcesById={sourcesById} />
        <BriefSection title="What matters" claims={brief.what_matters} sourcesById={sourcesById} emptyText="No decision-grade supporting evidence yet." />
        <BriefSection title="Not decision-grade evidence" claims={brief.not_decision_grade} sourcesById={sourcesById} emptyText="No low-grade or incomplete evidence was included." />
        <BriefSection title="What should happen next" claims={brief.next_steps} sourcesById={sourcesById} />

        {brief.omitted_cross_boundary_signal_count > 0 && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {brief.omitted_cross_boundary_signal_count} linked record was omitted because it did not match this incident boundary.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BriefSection({
  title,
  claims,
  sourcesById,
  emptyText,
}: {
  title: string;
  claims: BriefClaim[];
  sourcesById: Map<string, BriefSourceRecord>;
  emptyText?: string;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      {claims.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText || "No source-backed records available."}</p>
      ) : (
        <div className="space-y-2">
          {claims.map((claim, index) => (
            <div key={`${title}-${index}`} className="rounded-md border bg-background p-3">
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <p>{claim.text}</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {claim.source_ids.map((sourceId) => {
                  const source = sourcesById.get(sourceId);
                  if (!source) return null;
                  return <SourceChip key={sourceId} source={source} />;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SourceChip({ source }: { source: BriefSourceRecord }) {
  const content = (
    <>
      {source.label}
      {source.url && <ExternalLink className="h-3 w-3" />}
    </>
  );

  if (source.url) {
    return (
      <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
        <a href={source.url} target="_blank" rel="noreferrer">
          {content}
        </a>
      </Button>
    );
  }

  return (
    <Badge variant="outline" className="h-7 gap-1 px-2 text-xs font-normal">
      {content}
    </Badge>
  );
}
