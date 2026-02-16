import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Pencil, Save, X, Plus, Tag, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const CATEGORIES = [
  "active_threat", "advisory", "civil_emergency", "community_outreach",
  "emergency", "entity_proximity", "environmental", "health_concern",
  "hostage", "legal", "operational", "physical_security", "protest",
  "regulatory", "reputational", "sabotage", "social_sentiment",
  "surveillance", "terrorism", "threat-intelligence", "violence",
];

const SEVERITIES = ["critical", "high", "medium", "low"];

const PRIORITIES = ["p1", "p2", "p3", "p4"];

interface SignalManualOverrideProps {
  signal: {
    id: string;
    category: string | null;
    severity: string | null;
    entity_tags?: string[] | null;
    rule_priority?: string | null;
    normalized_text?: string | null;
  };
  onUpdated?: () => void;
}

export function SignalManualOverride({ signal, onUpdated }: SignalManualOverrideProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState(signal.category || "");
  const [severity, setSeverity] = useState(signal.severity || "");
  const [priority, setPriority] = useState(signal.rule_priority || "");
  const [tags, setTags] = useState<string[]>(signal.entity_tags || []);
  const [newTag, setNewTag] = useState("");
  const [applyToFuture, setApplyToFuture] = useState(true);

  const hasChanges =
    category !== (signal.category || "") ||
    severity !== (signal.severity || "") ||
    priority !== (signal.rule_priority || "") ||
    JSON.stringify(tags) !== JSON.stringify(signal.entity_tags || []);

  const addTag = () => {
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleSave = async () => {
    if (!hasChanges) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      // 1. Update the signal itself
      const updates: Record<string, any> = {};
      if (category !== (signal.category || "")) updates.category = category;
      if (severity !== (signal.severity || "")) updates.severity = severity;
      if (priority !== (signal.rule_priority || "")) updates.rule_priority = priority;
      if (JSON.stringify(tags) !== JSON.stringify(signal.entity_tags || [])) updates.entity_tags = tags;

      const { error: updateError } = await supabase
        .from("signals")
        .update(updates)
        .eq("id", signal.id);

      if (updateError) throw updateError;

      // 2. If applyToFuture, create an immediate correction rule
      if (applyToFuture) {
        await createCorrectionRule(signal, updates);
      }

      // 3. Log the correction for audit
      await supabase.from("autonomous_actions_log").insert({
        action_type: "analyst_signal_correction",
        trigger_source: "manual_override",
        trigger_id: signal.id,
        status: "completed",
        action_details: {
          signal_id: signal.id,
          changes: updates,
          apply_to_future: applyToFuture,
          original: {
            category: signal.category,
            severity: signal.severity,
            rule_priority: signal.rule_priority,
            entity_tags: signal.entity_tags,
          },
        },
      });

      toast.success(
        applyToFuture
          ? "Signal updated & correction rule applied to future scans"
          : "Signal updated"
      );
      setEditing(false);
      onUpdated?.();
    } catch (error) {
      console.error("Error saving signal override:", error);
      toast.error("Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Pencil className="w-3.5 h-3.5" />
          Manual Override
        </h4>
        {!editing ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="w-3 h-3 mr-1.5" />
            Edit
          </Button>
        ) : (
          <div className="flex gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCategory(signal.category || "");
                setSeverity(signal.severity || "");
                setPriority(signal.rule_priority || "");
                setTags(signal.entity_tags || []);
                setEditing(false);
              }}
            >
              <X className="w-3 h-3 mr-1" />
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !hasChanges}>
              {saving ? (
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              ) : (
                <Save className="w-3 h-3 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <div className="space-y-4 p-3 rounded-lg border bg-muted/30">
          {/* Category */}
          <div className="space-y-1.5">
            <Label className="text-xs">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c.replace(/_/g, " ").replace(/-/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Severity */}
          <div className="space-y-1.5">
            <Label className="text-xs">Severity</Label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select severity" />
              </SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select priority" />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p} className="text-xs uppercase">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label className="text-xs">Tags</Label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {tags.map((tag) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="text-xs cursor-pointer hover:bg-destructive/20"
                  onClick={() => removeTag(tag)}
                >
                  {tag} <X className="w-2.5 h-2.5 ml-1" />
                </Badge>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
                placeholder="Add tag..."
                className="h-7 text-xs"
              />
              <Button variant="outline" size="sm" className="h-7 px-2" onClick={addTag}>
                <Plus className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Apply to future signals toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">Apply to future signals</Label>
              <p className="text-[10px] text-muted-foreground">
                Agents will use this correction on matching content
              </p>
            </div>
            <Switch checked={applyToFuture} onCheckedChange={setApplyToFuture} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Correction Rule Pipeline ----

async function createCorrectionRule(
  signal: { id: string; category: string | null; severity: string | null; normalized_text?: string | null },
  changes: Record<string, any>
) {
  // Extract keywords from the signal text for matching
  const text = signal.normalized_text || "";
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4);

  // Pick top distinctive keywords (skip very common words)
  const stopWords = new Set([
    "about", "after", "their", "there", "these", "those", "would", "could",
    "should", "which", "where", "while", "being", "other", "every", "under",
    "between", "through", "during", "before", "following", "according",
  ]);
  const keywords = [...new Set(words.filter((w) => !stopWords.has(w)))].slice(0, 8);

  if (keywords.length < 2) {
    // Not enough keywords to create a meaningful rule
    console.log("Skipping rule creation — insufficient keywords");
    return;
  }

  const ruleName = `analyst_correction_${signal.id.substring(0, 8)}`;
  const rule = {
    rule_name: ruleName,
    source: "analyst_correction",
    signal_id: signal.id,
    created_at: new Date().toISOString(),
    conditions: {
      keywords,
    },
    actions: {
      ...(changes.category ? { set_category: changes.category } : {}),
      ...(changes.rule_priority ? { set_priority: changes.rule_priority } : {}),
      ...(changes.entity_tags ? { add_tags: changes.entity_tags } : {}),
      ...(changes.severity ? { set_severity: changes.severity } : {}),
    },
  };

  // Store as an approved rule in intelligence_config
  const configKey = `signal_categorization_rules_proposal_correction_${signal.id.substring(0, 8)}`;

  const { error } = await supabase.from("intelligence_config").upsert(
    {
      key: configKey,
      value: {
        status: "approved",
        source: "analyst_correction",
        approved_at: new Date().toISOString(),
        proposals: [rule],
      },
      description: `Analyst correction rule from signal ${signal.id.substring(0, 8)}`,
    },
    { onConflict: "key" }
  );

  if (error) {
    console.error("Failed to create correction rule:", error);
    toast.error("Signal updated but failed to create future rule");
  }
}
