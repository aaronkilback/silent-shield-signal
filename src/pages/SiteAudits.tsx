/**
 * SiteAudits — list page for the audit workflow.
 *
 * Two states:
 *   • picker mode: shows an AssetPicker so the operator can pick or
 *     create the asset to audit. Used when no auditId is in the URL.
 *   • wizard mode: when an auditId is in the URL, renders the
 *     SiteAuditWizard for that audit. Resume / new-audit flow share
 *     the same component.
 *
 * Plus a small "your in-progress audits" tile so the operator can
 * resume a partial audit started yesterday at a different site.
 */

import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, Clock, MapPin } from "lucide-react";
import { AssetPicker } from "@/components/site-audit/AssetPicker";
import { SiteAuditWizard } from "@/components/site-audit/SiteAuditWizard";
import { useMyOpenAudits } from "@/hooks/useSiteAudit";
import { formatDistanceToNow } from "date-fns";

export default function SiteAudits() {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();

  if (params.id) {
    return <SiteAuditWizard auditId={params.id} />;
  }

  return <SiteAuditsList onAuditStarted={(id) => navigate(`/site-audits/${id}`)} />;
}

function SiteAuditsList({ onAuditStarted }: { onAuditStarted: (id: string) => void }) {
  const navigate = useNavigate();
  const { data: openAudits } = useMyOpenAudits();
  const inProgress = (openAudits ?? []).filter((a) => a.status === "in_progress");
  const recentlyCompleted = (openAudits ?? []).filter((a) => a.status === "completed").slice(0, 5);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {inProgress.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-amber-500" />
              In progress ({inProgress.length})
            </CardTitle>
            <CardDescription>Resume an audit you started earlier.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {inProgress.map((a) => (
              <button
                key={a.id}
                onClick={() => navigate(`/site-audits/${a.id}`)}
                className="w-full flex items-center justify-between p-3 border rounded hover:bg-accent/50 text-left"
              >
                <div>
                  <div className="font-medium">{a.asset?.name ?? "Untitled site"}</div>
                  <div className="text-xs text-muted-foreground">
                    Started {formatDistanceToNow(new Date(a.started_at), { addSuffix: true })}
                    {a.observations_count > 0 && ` · ${a.observations_count} observation${a.observations_count === 1 ? "" : "s"}`}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <AssetPicker onAuditStarted={onAuditStarted} />

      {recentlyCompleted.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Recently completed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentlyCompleted.map((a) => (
              <button
                key={a.id}
                onClick={() => navigate(`/site-audits/${a.id}`)}
                className="w-full flex items-center justify-between p-2 border rounded hover:bg-accent/50 text-left"
              >
                <div>
                  <div className="text-sm">{a.asset?.name ?? "Untitled site"}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.completed_at && formatDistanceToNow(new Date(a.completed_at), { addSuffix: true })}
                  </div>
                </div>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
