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
import { Plus, Trash2, Sparkles, Edit3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type RecommendationBucket,
  type AuditRecommendation,
  useRecommendations,
  useUpsertRecommendation,
  useDeleteRecommendation,
} from "@/hooks/useAuditReport";

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

function RecommendationRow({ rec }: { rec: AuditRecommendation }) {
  const upsert = useUpsertRecommendation();
  const del = useDeleteRecommendation();
  const [text, setText] = useState(rec.description);
  const [editing, setEditing] = useState(false);

  return (
    <div className="border-l-2 border-foreground/30 pl-2 py-1 text-sm flex items-start gap-2">
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
          <div onClick={() => setEditing(true)} className="cursor-pointer">
            {rec.description}
          </div>
        )}
        <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
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
        </div>
      </div>
      <button
        type="button"
        onClick={() => del.mutate({ id: rec.id, audit_id: rec.audit_id })}
        className="text-muted-foreground hover:text-red-600 shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
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
