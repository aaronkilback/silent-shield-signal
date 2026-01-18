import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, ThumbsUp, ThumbsDown, Lightbulb, Target, Loader2 } from 'lucide-react';

type FeedbackMode = 'feedback' | 'outcome';

interface IncidentFeedbackDialogProps {
  incidentId: string;
  mode?: FeedbackMode;
  signalText?: string;
  openedAt?: string;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
}

export function IncidentFeedbackDialog({ 
  incidentId, 
  mode = 'feedback',
  signalText, 
  openedAt,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  onSuccess 
}: IncidentFeedbackDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [wasAccurate, setWasAccurate] = useState<string>('');
  const [falsePositive, setFalsePositive] = useState(false);
  const [outcomeType, setOutcomeType] = useState<string>('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [improvements, setImprovements] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  const resetForm = () => {
    setWasAccurate('');
    setFalsePositive(false);
    setOutcomeType('');
    setLessonsLearned('');
    setImprovements('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Calculate response time
      let responseTimeSeconds = null;
      if (openedAt) {
        responseTimeSeconds = Math.floor(
          (new Date().getTime() - new Date(openedAt).getTime()) / 1000
        );
      } else {
        // Get incident details for response time calculation
        const { data: incident } = await supabase
          .from('incidents')
          .select('opened_at, resolved_at')
          .eq('id', incidentId)
          .single();

        if (incident?.opened_at && incident?.resolved_at) {
          const opened = new Date(incident.opened_at);
          const resolved = new Date(incident.resolved_at);
          responseTimeSeconds = Math.floor((resolved.getTime() - opened.getTime()) / 1000);
        }
      }

      const improvementSuggestions = improvements
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.trim());

      const { error } = await supabase
        .from('incident_outcomes')
        .insert({
          incident_id: incidentId,
          outcome_type: outcomeType || 'resolved',
          was_accurate: wasAccurate === 'yes' || wasAccurate === 'accurate',
          false_positive: falsePositive,
          lessons_learned: lessonsLearned || null,
          improvement_suggestions: improvementSuggestions.length > 0 ? improvementSuggestions : null,
          response_time_seconds: responseTimeSeconds,
        });

      if (error) throw error;

      toast({
        title: mode === 'outcome' ? "Outcome Recorded" : "Feedback Submitted",
        description: mode === 'outcome' 
          ? "Incident outcome has been saved for learning analytics"
          : "Your feedback will help improve AI decision-making.",
      });

      setOpen(false);
      resetForm();
      onSuccess?.();
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast({
        title: "Error",
        description: "Failed to submit feedback. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const dialogContent = (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {mode === 'outcome' ? (
            <>
              <Target className="w-5 h-5" />
              Record Incident Outcome
            </>
          ) : (
            'AI Decision Feedback'
          )}
        </DialogTitle>
        <DialogDescription>
          {mode === 'outcome' 
            ? "Help improve AI accuracy by recording the outcome of this incident"
            : "Help improve our AI by providing feedback on this incident. Your input trains the system to make better decisions."
          }
        </DialogDescription>
      </DialogHeader>

      {signalText && (
        <div className="bg-muted p-3 rounded-lg mb-4">
          <Label className="text-xs text-muted-foreground mb-1 block">Original Signal</Label>
          <p className="text-sm">{signalText}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Outcome Type */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <Badge variant="outline">Required</Badge>
            How was this incident resolved?
          </Label>
          <RadioGroup value={outcomeType} onValueChange={setOutcomeType} required>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="contained" id="contained" />
              <Label htmlFor="contained" className="font-normal cursor-pointer">
                Contained - Threat was successfully stopped
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="mitigated" id="mitigated" />
              <Label htmlFor="mitigated" className="font-normal cursor-pointer">
                Mitigated - Threat was reduced but not eliminated
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="escalated" id="escalated" />
              <Label htmlFor="escalated" className="font-normal cursor-pointer">
                Escalated - Required external assistance
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="false_alarm" id="false_alarm" />
              <Label htmlFor="false_alarm" className="font-normal cursor-pointer">
                False Alarm - Not a real threat
              </Label>
            </div>
            {mode === 'outcome' && (
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="dismissed" id="dismissed" />
                <Label htmlFor="dismissed" className="font-normal cursor-pointer">
                  Dismissed - No action needed
                </Label>
              </div>
            )}
          </RadioGroup>
        </div>

        {/* Accuracy Assessment */}
        <div className="space-y-3">
          <Label className="flex items-center gap-2">
            <ThumbsUp className="h-4 w-4" />
            Was the AI's threat assessment accurate?
          </Label>
          <RadioGroup value={wasAccurate} onValueChange={setWasAccurate}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="yes" id="accurate-yes" />
              <Label htmlFor="accurate-yes" className="font-normal cursor-pointer">
                ✅ Yes - AI correctly identified the threat level
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no" id="accurate-no" />
              <Label htmlFor="accurate-no" className="font-normal cursor-pointer">
                ❌ No - AI over/under estimated the threat
              </Label>
            </div>
          </RadioGroup>
        </div>

        {/* False Positive Check */}
        <div className="flex items-center space-x-2">
          <Checkbox
            id="falsePositive"
            checked={falsePositive}
            onCheckedChange={(checked) => setFalsePositive(checked as boolean)}
          />
          <Label htmlFor="falsePositive" className="cursor-pointer flex items-center gap-2">
            <ThumbsDown className="h-4 w-4" />
            <Badge variant="destructive">False Positive</Badge>
            This should not have been flagged
          </Label>
        </div>

        {/* Lessons Learned */}
        <div className="space-y-2">
          <Label htmlFor="lessons">
            Lessons Learned (Optional)
          </Label>
          <Textarea
            id="lessons"
            value={lessonsLearned}
            onChange={(e) => setLessonsLearned(e.target.value)}
            placeholder="What did you learn from this incident? What would you do differently next time?"
            rows={3}
          />
        </div>

        {/* Improvement Suggestions */}
        <div className="space-y-2">
          <Label htmlFor="improvements" className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4" />
            How can the AI improve? (Optional)
          </Label>
          <Textarea
            id="improvements"
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            placeholder="Enter one suggestion per line. For example:
- Consider geographic proximity when assessing threats
- Weight historical patterns more heavily
- Add context about seasonal trends"
            rows={4}
          />
          <p className="text-xs text-muted-foreground">
            Each line will be saved as a separate suggestion
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            {mode === 'outcome' ? 'Skip' : 'Cancel'}
          </Button>
          <Button type="submit" disabled={submitting || !outcomeType}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {mode === 'outcome' ? 'Record Outcome' : 'Submit Feedback'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );

  if (trigger) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        {dialogContent}
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <MessageSquare className="h-4 w-4 mr-2" />
            {mode === 'outcome' ? 'Record Outcome' : 'Provide Feedback'}
          </Button>
        </DialogTrigger>
      )}
      {dialogContent}
    </Dialog>
  );
}

// Legacy exports for backward compatibility
export default IncidentFeedbackDialog;
export { IncidentFeedbackDialog as IncidentOutcomeDialog };
