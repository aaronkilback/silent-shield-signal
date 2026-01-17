import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Flag, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { toast } from "sonner";

interface ReportViolationDialogProps {
  contentType: string;
  contentId?: string;
  contentExcerpt?: string;
  reportedUserId?: string;
  trigger?: React.ReactNode;
}

const VIOLATION_CATEGORIES = [
  { value: 'harassment', label: 'Harassment or Abuse' },
  { value: 'threat', label: 'Threats or Violence' },
  { value: 'misinformation', label: 'Misinformation or False Claims' },
  { value: 'pii', label: 'Exposed Personal Information' },
  { value: 'security_risk', label: 'Security Risk or Exploit' },
  { value: 'inappropriate', label: 'Inappropriate Content' },
  { value: 'spam', label: 'Spam or Abuse' },
  { value: 'other', label: 'Other Violation' },
];

export function ReportViolationDialog({
  contentType,
  contentId,
  contentExcerpt,
  reportedUserId,
  trigger
}: ReportViolationDialogProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();
  const { currentTenant } = useTenant();

  const handleSubmit = async () => {
    if (!category) {
      toast.error("Please select a violation category");
      return;
    }

    if (!user) {
      toast.error("You must be logged in to report violations");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase
        .from('violation_reports')
        .insert({
          reporter_id: user.id,
          reported_user_id: reportedUserId || null,
          tenant_id: currentTenant?.id || null,
          content_type: contentType,
          content_id: contentId || null,
          content_excerpt: contentExcerpt?.substring(0, 500) || null,
          violation_category: category,
          description: description || null,
          status: 'pending'
        });

      if (error) throw error;

      toast.success("Report submitted", {
        description: "Thank you for helping keep our community safe. We'll review this shortly."
      });

      setOpen(false);
      setCategory("");
      setDescription("");
    } catch (error) {
      console.error("Error submitting report:", error);
      toast.error("Failed to submit report", {
        description: "Please try again later."
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
            <Flag className="h-4 w-4 mr-1" />
            Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            Report a Violation
          </DialogTitle>
          <DialogDescription>
            Help us maintain a safe environment by reporting content that violates our community guidelines.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="category">Violation Type *</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Select violation type" />
              </SelectTrigger>
              <SelectContent>
                {VIOLATION_CATEGORIES.map(cat => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {contentExcerpt && (
            <div className="space-y-2">
              <Label>Reported Content</Label>
              <div className="bg-muted p-3 rounded-md text-sm text-muted-foreground max-h-24 overflow-y-auto">
                {contentExcerpt.length > 200 
                  ? contentExcerpt.substring(0, 200) + '...' 
                  : contentExcerpt}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="description">Additional Details (Optional)</Label>
            <Textarea
              id="description"
              placeholder="Provide any additional context that might help our review..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
            />
            <p className="text-xs text-muted-foreground text-right">
              {description.length}/1000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || !category}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Flag className="h-4 w-4 mr-2" />
                Submit Report
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
