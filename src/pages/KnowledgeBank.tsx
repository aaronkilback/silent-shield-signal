import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BookOpen, ArrowRight, Trash2, CheckCircle, ArrowLeft, Lightbulb, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface SavedNugget {
  id: string;
  knowledge_id: string;
  title: string;
  content: string;
  domain: string;
  subdomain: string | null;
  citation: string | null;
  confidence_score: number | null;
  saved_from_route: string | null;
  notes: string | null;
  is_operationalized: boolean;
  created_at: string;
}

export default function KnowledgeBank() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nuggets, setNuggets] = useState<SavedNugget[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesText, setNotesText] = useState("");

  useEffect(() => {
    if (!user) return;
    fetchNuggets();
  }, [user]);

  const fetchNuggets = async () => {
    const { data, error } = await supabase
      .from("saved_knowledge_nuggets")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setNuggets(data as unknown as SavedNugget[]);
    setLoading(false);
  };

  const toggleOperationalized = async (id: string, current: boolean) => {
    await supabase
      .from("saved_knowledge_nuggets")
      .update({ is_operationalized: !current })
      .eq("id", id);
    setNuggets(prev => prev.map(n => n.id === id ? { ...n, is_operationalized: !current } : n));
    toast.success(!current ? "Marked as operationalized" : "Unmarked");
  };

  const saveNotes = async (id: string) => {
    await supabase
      .from("saved_knowledge_nuggets")
      .update({ notes: notesText })
      .eq("id", id);
    setNuggets(prev => prev.map(n => n.id === id ? { ...n, notes: notesText } : n));
    setEditingNotes(null);
    toast.success("Notes saved");
  };

  const deleteNugget = async (id: string) => {
    await supabase.from("saved_knowledge_nuggets").delete().eq("id", id);
    setNuggets(prev => prev.filter(n => n.id !== id));
    toast.success("Removed from Knowledge Bank");
  };

  const deepDive = (nugget: SavedNugget) => {
    const prompt = `Explain the concept "${nugget.title}" in the context of ${nugget.domain.replace(/_/g, " ")}. What is it, why does it matter for my operations, and how should I operationalize it? Reference: ${nugget.citation || "N/A"}`;
    navigate("/", { state: { aegisPrompt: prompt } });
  };

  const active = nuggets.filter(n => !n.is_operationalized);
  const operationalized = nuggets.filter(n => n.is_operationalized);

  return (
    <div className="min-h-screen bg-background p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
          <BookOpen className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Knowledge Bank</h1>
          <p className="text-sm text-muted-foreground">
            Saved intel nuggets for operationalization — {nuggets.length} total
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading saved knowledge…</p>
      ) : nuggets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <BookOpen className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-muted-foreground">No saved knowledge yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              When intel popups appear while navigating, hit the save button to retain them here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                <Lightbulb className="h-3.5 w-3.5" /> To Operationalize ({active.length})
              </h2>
              <div className="space-y-3">
                {active.map(nugget => (
                  <NuggetCard
                    key={nugget.id}
                    nugget={nugget}
                    editingNotes={editingNotes}
                    notesText={notesText}
                    onToggle={toggleOperationalized}
                    onDelete={deleteNugget}
                    onDeepDive={deepDive}
                    onEditNotes={(id, existing) => { setEditingNotes(id); setNotesText(existing || ""); }}
                    onSaveNotes={saveNotes}
                    onNotesChange={setNotesText}
                    onCancelNotes={() => setEditingNotes(null)}
                  />
                ))}
              </div>
            </div>
          )}

          {operationalized.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5" /> Operationalized ({operationalized.length})
              </h2>
              <div className="space-y-3 opacity-70">
                {operationalized.map(nugget => (
                  <NuggetCard
                    key={nugget.id}
                    nugget={nugget}
                    editingNotes={editingNotes}
                    notesText={notesText}
                    onToggle={toggleOperationalized}
                    onDelete={deleteNugget}
                    onDeepDive={deepDive}
                    onEditNotes={(id, existing) => { setEditingNotes(id); setNotesText(existing || ""); }}
                    onSaveNotes={saveNotes}
                    onNotesChange={setNotesText}
                    onCancelNotes={() => setEditingNotes(null)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NuggetCard({
  nugget, editingNotes, notesText,
  onToggle, onDelete, onDeepDive, onEditNotes, onSaveNotes, onNotesChange, onCancelNotes,
}: {
  nugget: SavedNugget;
  editingNotes: string | null;
  notesText: string;
  onToggle: (id: string, current: boolean) => void;
  onDelete: (id: string) => void;
  onDeepDive: (n: SavedNugget) => void;
  onEditNotes: (id: string, existing: string | null) => void;
  onSaveNotes: (id: string) => void;
  onNotesChange: (v: string) => void;
  onCancelNotes: () => void;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm font-semibold leading-snug">{nugget.title}</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-[10px]">
                {nugget.domain.replace(/_/g, " ")}
              </Badge>
              {nugget.subdomain && (
                <Badge variant="secondary" className="text-[10px]">
                  {nugget.subdomain.replace(/_/g, " ")}
                </Badge>
              )}
              {nugget.saved_from_route && (
                <span className="text-[10px] text-muted-foreground">
                  from {nugget.saved_from_route}
                </span>
              )}
            </div>
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(new Date(nugget.created_at), { addSuffix: true })}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">
          {nugget.content.length > 600 ? nugget.content.substring(0, 600) + "…" : nugget.content}
        </p>

        {nugget.citation && (
          <p className="text-[10px] text-muted-foreground/60 italic">{nugget.citation}</p>
        )}

        {/* Notes */}
        {editingNotes === nugget.id ? (
          <div className="space-y-2">
            <Textarea
              value={notesText}
              onChange={e => onNotesChange(e.target.value)}
              placeholder="How will you operationalize this? Add notes…"
              className="text-xs min-h-[60px]"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => onSaveNotes(nugget.id)}>
                Save Notes
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancelNotes}>
                Cancel
              </Button>
            </div>
          </div>
        ) : nugget.notes ? (
          <div
            className="bg-accent/30 rounded-lg px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onEditNotes(nugget.id, nugget.notes)}
          >
            <p className="text-[11px] text-foreground/80 leading-relaxed flex items-start gap-1.5">
              <StickyNote className="h-3 w-3 mt-0.5 flex-shrink-0 text-primary" />
              {nugget.notes}
            </p>
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => onDeepDive(nugget)}
          >
            <ArrowRight className="h-3 w-3" /> Deep Dive
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            onClick={() => onEditNotes(nugget.id, nugget.notes)}
          >
            <StickyNote className="h-3 w-3" /> {nugget.notes ? "Edit Notes" : "Add Notes"}
          </Button>
          <Button
            size="sm"
            variant={nugget.is_operationalized ? "secondary" : "ghost"}
            className="h-7 text-xs gap-1"
            onClick={() => onToggle(nugget.id, nugget.is_operationalized)}
          >
            <CheckCircle className="h-3 w-3" /> {nugget.is_operationalized ? "Undo" : "Operationalized"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-destructive hover:text-destructive ml-auto"
            onClick={() => onDelete(nugget.id)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
