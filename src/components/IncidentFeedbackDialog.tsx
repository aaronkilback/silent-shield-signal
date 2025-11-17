import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { MessageSquare, ThumbsUp, ThumbsDown, Lightbulb } from 'lucide-react';

interface IncidentFeedbackDialogProps {
  incidentId: string;
  signalText?: string;
  trigger?: React.ReactNode;
}

export default function IncidentFeedbackDialog({ incidentId, signalText, trigger }: IncidentFeedbackDialogProps) {
  const [open, setOpen] = useState(false);
  const [wasAccurate, setWasAccurate] = useState<string>('');
  const [falsePositive, setFalsePositive] = useState<string>('');
  const [outcomeType, setOutcomeType] = useState<string>('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [improvements, setImprovements] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Get incident details for response time calculation
      const { data: incident } = await supabase
        .from('incidents')
        .select('opened_at, resolved_at')
        .eq('id', incidentId)
        .single();

      let responseTimeSeconds = null;
      if (incident?.opened_at && incident?.resolved_at) {
        const opened = new Date(incident.opened_at);
        const resolved = new Date(incident.resolved_at);
        responseTimeSeconds = Math.floor((resolved.getTime() - opened.getTime()) / 1000);
      }

      const improvementSuggestions = improvements
        .split('\n')
        .filter(line => line.trim())
        .map(line => line.trim());

      const { error } = await supabase
        .from('incident_outcomes')
        .insert({
          incident_id: incidentId,
          outcome_type: outcomeType,
          was_accurate: wasAccurate === 'yes',
          false_positive: falsePositive === 'yes',
          lessons_learned: lessonsLearned || null,
          improvement_suggestions: improvementSuggestions.length > 0 ? improvementSuggestions : null,
          response_time_seconds: responseTimeSeconds,
        });

      if (error) throw error;

      toast({
        title: "Feedback Submitted",
        description: "Your feedback will help improve AI decision-making.",
      });

      setOpen(false);
      resetForm();
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

  const resetForm = () => {
    setWasAccurate('');
    setFalsePositive('');
    setOutcomeType('');
    setLessonsLearned('');
    setImprovements('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <MessageSquare className="h-4 w-4 mr-2" />
            Provide Feedback
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI Decision Feedback</DialogTitle>
          <DialogDescription>
            Help improve our AI by providing feedback on this incident. Your input trains the system to make better decisions.
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
                  Yes - AI correctly identified the threat level
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="no" id="accurate-no" />
                <Label htmlFor="accurate-no" className="font-normal cursor-pointer">
                  No - AI over/under estimated the threat
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* False Positive Check */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <ThumbsDown className="h-4 w-4" />
              Was this a false positive?
            </Label>
            <RadioGroup value={falsePositive} onValueChange={setFalsePositive}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="yes" id="false-yes" />
                <Label htmlFor="false-yes" className="font-normal cursor-pointer">
                  Yes - This should not have been flagged
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="no" id="false-no" />
                <Label htmlFor="false-no" className="font-normal cursor-pointer">
                  No - This was a legitimate concern
                </Label>
              </div>
            </RadioGroup>
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

          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !outcomeType}>
              {submitting ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
