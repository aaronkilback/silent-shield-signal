/**
 * RecommendationsEditor — bucketed recommendations editor for Stage 9.
 *
 * Phase 2F. Three buckets matching the operator's SRA format:
 *   • Short term  (0-3 months)
 *   • Medium term (3-6 months)
 *   • Long term   (>6 months)
 *
 * Each row: description, optional rationale, source pill (operator /
 * AI / AI-then-human-edited), priority for ordering.
 */

import { useState } from "react";
import { Plus, Trash2, Sparkles, Edit3, ChevronDown, ChevronRight, CheckCircle, Clock, XCircle, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type RecommendationBucket,
  type AuditRecommendation,
  useRecommendations,
  useUpsertRecommendation,
  useDeleteRecommendation,
  useUpdateRecommendationStatus,
} from "@/hooks/useAuditReport";
import { useAuth } from "@/hooks/useAuth";
import { formatDistanceToNow } from "date-fns";

const BUCKET_LABEL: Record<RecommendationBucket, string> = {
  short_term: "Short term · 0-3 months",
  medium_term: "Medium term · 3-6 months",
  long_term: "Long term · >6 months",
};

const BUCKET_ORDER: RecommendationBucket[] = ["short_term", "medium_term", "long_term"];

interface RecommendationsEditorProps {
  auditId: string;
}

export function RecommendationsEditor({ auditId }: RecommendationsEditorProps) {
  const { data: recs } = useRecommendations(auditId);

  const grouped: Record<RecommendationBucket, AuditRecommendation[]> = {
    short_term: [], medium_term: [], long_term: [],
  };
  for (const r of recs ?? []) grouped[r.bucket].push(r);

  return (
    <div className="space-y-3">
      {BUCKET_ORDER.map((bucket) => (
        <div key={bucket} className="rounded border p-3 space-y-2 bg-card">
          <div className="text-sm font-medium">{BUCKET_LABEL[bucket]}</div>
          {grouped[bucket].length === 0 && (
            <div className="text-xs text-muted-foreground italic">No recommendations yet.</div>
          )}
          {grouped[bucket].map((r) => (
            <RecommendationRow key={r.id} rec={r} />
          ))}
          <NewRecommendation auditId={auditId} bucket={bucket} />
        </div>
      ))}
    </div>
  );
}

const STATUS_META: Record<AuditRecommendation["status"], { label: string; icon: typeof Circle; color: string }> = {
  open:        { label: "Open",        icon: Circle,      color: "text-muted-foreground" },
  in_progress: { label: "In progress", icon: Clock,       color: "text-amber-600" },
  complete:    { label: "Complete",    icon: CheckCircle, color: "text-emerald-600" },
  dismissed:   { label: "Dismissed",   icon: XCircle,     color: "text-red-600/70" },
};

function RecommendationRow({ rec }: { rec: AuditRecommendation }) {
  const upsert = useUpsertRecommendation();
  const updateStatus = useUpdateRecommendationStatus();
  const del = useDeleteRecommendation();
  const { user } = useAuth();
  const [text, setText] = useState(rec.description);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(rec.action_notes ?? "");

  const StatusIcon = STATUS_META[rec.status].icon;

  const setStatus = (newStatus: AuditRecommendation["status"]) => {
    updateStatus.mutate({
      id: rec.id,
      audit_id: rec.audit_id,
      status: newStatus,
      actor_id: user?.id,
    });
  };

  const saveNotes = () => {
    if (notes === (rec.action_notes ?? "")) return;
    updateStatus.mutate({
      id: rec.id,
      audit_id: rec.audit_id,
      action_notes: notes,
      actor_id: user?.id,
    });
  };

  return (
    <div className="border-l-2 border-foreground/30 pl-2 py-1 text-sm">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setStatus(rec.status === "complete" ? "open" : "complete")}
          className={`mt-0.5 ${STATUS_META[rec.status].color} hover:opacity-70 shrink-0`}
          title={`Status: ${STATUS_META[rec.status].label} — tap to toggle complete`}
        >
          <StatusIcon className="w-4 h-4" />
        </button>
        <div className="flex-1">
          {editing ? (
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (text !== rec.description) {
                  upsert.mutate({
                    id: rec.id,
                    audit_id: rec.audit_id,
                    bucket: rec.bucket,
                    description: text,
                    source: rec.source === "ai" ? "ai_then_human_edited" : rec.source,
                  });
                }
              }}
              rows={2}
              autoFocus
              className="text-sm"
            />
          ) : (
            <div
              onClick={() => setEditing(true)}
              className={`cursor-pointer ${rec.status === "complete" ? "line-through text-muted-foreground" : ""}`}
            >
              {rec.description}
            </div>
          )}
          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5 flex-wrap">
            {rec.source === "ai" && (
              <span className="flex items-center gap-0.5 text-amber-600">
                <Sparkles className="w-3 h-3" /> AI-drafted
              </span>
            )}
            {rec.source === "ai_then_human_edited" && (
              <span className="flex items-center gap-0.5 text-blue-600">
                <Edit3 className="w-3 h-3" /> edited
              </span>
            )}
            {rec.rationale && <span className="italic">{rec.rationale}</span>}
            {rec.last_action_at && (
              <span>· last action {formatDistanceToNow(new Date(rec.last_action_at), { addSuffix: true })}</span>
            )}
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="ml-auto flex items-center gap-0.5 hover:text-foreground"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              {expanded ? "Hide" : "Action log"}
            </button>
          </div>

          {expanded && (
            <div className="mt-2 space-y-2 border-t pt-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Status:</span>
                <Select
                  value={rec.status}
                  onValueChange={(v) => setStatus(v as AuditRecommendation["status"])}
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_META) as Array<AuditRecommendation["status"]>).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_META[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rec.closed_at && (
                  <span className="text-emerald-600">
                    closed {formatDistanceToNow(new Date(rec.closed_at), { addSuffix: true })}
                  </span>
                )}
              </div>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                rows={3}
                placeholder="Action log — what's been done, when, who you talked to. e.g. '2026-05-12: Met with camp manager Tom — agreed to lock all doors by Friday.'"
                className="text-xs"
              />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => del.mutate({ id: rec.id, audit_id: rec.audit_id })}
          className="text-muted-foreground hover:text-red-600 shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function NewRecommendation({ auditId, bucket }: { auditId: string; bucket: RecommendationBucket }) {
  const upsert = useUpsertRecommendation();
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim()) return;
    upsert.mutate({
      audit_id: auditId,
      bucket,
      description: text.trim(),
      source: "operator",
    });
    setText("");
  };

  return (
    <div className="flex items-start gap-1 pt-1">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder="+ Add recommendation (Cmd+Enter to save)"
        className="text-sm flex-1 resize-none"
      />
      <Button size="sm" variant="outline" onClick={submit} disabled={!text.trim() || upsert.isPending} className="h-9">
        <Plus className="w-3 h-3" />
      </Button>
    </div>
  );
}
