import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Target } from "lucide-react";

interface IncidentOutcomeDialogProps {
  incidentId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  openedAt: string;
}

export const IncidentOutcomeDialog = ({
  incidentId,
  open,
  onClose,
  onSuccess,
  openedAt,
}: IncidentOutcomeDialogProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [wasAccurate, setWasAccurate] = useState<boolean>(true);
  const [falsePositive, setFalsePositive] = useState(false);
  const [outcomeType, setOutcomeType] = useState<string>("resolved");
  const [lessonsLearned, setLessonsLearned] = useState("");
  const [improvementSuggestions, setImprovementSuggestions] = useState("");

  const handleSubmit = async () => {
    try {
      setLoading(true);

      // Calculate response time
      const responseTimeSeconds = Math.floor(
        (new Date().getTime() - new Date(openedAt).getTime()) / 1000
      );

      // Parse improvement suggestions into array
      const suggestions = improvementSuggestions
        .split("\n")
        .filter((s) => s.trim())
        .map((s) => s.trim());

      const { error } = await supabase.from("incident_outcomes").insert({
        incident_id: incidentId,
        was_accurate: wasAccurate,
        false_positive: falsePositive,
        outcome_type: outcomeType,
        response_time_seconds: responseTimeSeconds,
        lessons_learned: lessonsLearned || null,
        improvement_suggestions: suggestions.length > 0 ? suggestions : null,
      });

      if (error) throw error;

      toast({
        title: "Outcome Recorded",
        description: "Incident outcome has been saved for learning analytics",
      });

      // Reset form
      setWasAccurate(true);
      setFalsePositive(false);
      setOutcomeType("resolved");
      setLessonsLearned("");
      setImprovementSuggestions("");

      onSuccess();
    } catch (error) {
      console.error("Error recording outcome:", error);
      toast({
        title: "Error",
        description: "Failed to record incident outcome",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Record Incident Outcome
          </DialogTitle>
          <DialogDescription>
            Help improve AI accuracy by recording the outcome of this incident
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Accuracy Assessment */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">
              Was the AI's threat assessment accurate?
            </Label>
            <RadioGroup
              value={wasAccurate ? "accurate" : "inaccurate"}
              onValueChange={(v) => setWasAccurate(v === "accurate")}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="accurate" id="accurate" />
                <Label htmlFor="accurate" className="font-normal cursor-pointer">
                  ✅ Accurate - Real threat correctly identified
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="inaccurate" id="inaccurate" />
                <Label htmlFor="inaccurate" className="font-normal cursor-pointer">
                  ❌ Inaccurate - Assessment was incorrect
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* False Positive */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="falsePositive"
              checked={falsePositive}
              onCheckedChange={(checked) => setFalsePositive(checked as boolean)}
            />
            <Label htmlFor="falsePositive" className="cursor-pointer">
              <Badge variant="destructive" className="mr-2">
                False Positive
              </Badge>
              This was not a real security threat
            </Label>
          </div>

          {/* Outcome Type */}
          <div className="space-y-3">
            <Label htmlFor="outcomeType" className="text-base font-semibold">
              Outcome Type
            </Label>
            <RadioGroup value={outcomeType} onValueChange={setOutcomeType}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="resolved" id="resolved" />
                <Label htmlFor="resolved" className="font-normal cursor-pointer">
                  Resolved Successfully
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="mitigated" id="mitigated" />
                <Label htmlFor="mitigated" className="font-normal cursor-pointer">
                  Threat Mitigated
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="escalated" id="escalated" />
                <Label htmlFor="escalated" className="font-normal cursor-pointer">
                  Escalated to Higher Authority
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dismissed" id="dismissed" />
                <Label htmlFor="dismissed" className="font-normal cursor-pointer">
                  Dismissed (No Action Needed)
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Lessons Learned */}
          <div className="space-y-2">
            <Label htmlFor="lessons" className="text-base font-semibold">
              Lessons Learned
            </Label>
            <Textarea
              id="lessons"
              placeholder="What did we learn from this incident? How can we improve detection or response?"
              value={lessonsLearned}
              onChange={(e) => setLessonsLearned(e.target.value)}
              rows={3}
            />
          </div>

          {/* Improvement Suggestions */}
          <div className="space-y-2">
            <Label htmlFor="improvements" className="text-base font-semibold">
              Improvement Suggestions
            </Label>
            <Textarea
              id="improvements"
              placeholder="Enter each suggestion on a new line:&#10;- Adjust detection threshold for X&#10;- Add monitoring for Y&#10;- Update playbook for Z"
              value={improvementSuggestions}
              onChange={(e) => setImprovementSuggestions(e.target.value)}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Enter one suggestion per line. These will help train the AI.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Skip
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Record Outcome
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
