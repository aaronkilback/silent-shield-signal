import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Camera, X } from "lucide-react";
import html2canvas from "html2canvas";

interface BugReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const BugReportDialog = ({ open, onOpenChange }: BugReportDialogProps) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);

  const captureScreenshot = async () => {
    setIsCapturing(true);
    try {
      // Close the dialog temporarily to capture the page behind it
      onOpenChange(false);
      
      // Wait a moment for the dialog to close
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Capture the entire page
      const canvas = await html2canvas(document.body, {
        allowTaint: true,
        useCORS: true,
        logging: false,
      });
      
      // Reopen the dialog
      onOpenChange(true);
      
      // Convert canvas to blob
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((blob) => resolve(blob!), 'image/png');
      });
      
      // Upload to Supabase storage
      const timestamp = Date.now();
      const filename = `screenshot-${timestamp}.png`;
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('bug-screenshots')
        .upload(filename, blob, {
          contentType: 'image/png',
        });
      
      if (uploadError) throw uploadError;
      
      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('bug-screenshots')
        .getPublicUrl(filename);
      
      setScreenshots([...screenshots, publicUrl]);
      toast.success("Screenshot captured");
    } catch (error) {
      console.error("Error capturing screenshot:", error);
      toast.error("Failed to capture screenshot");
      onOpenChange(true); // Make sure dialog reopens even on error
    } finally {
      setIsCapturing(false);
    }
  };

  const removeScreenshot = (index: number) => {
    setScreenshots(screenshots.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim() || !description.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        toast.error("You must be logged in to submit a bug report");
        return;
      }

      const { error } = await supabase
        .from('bug_reports')
        .insert({
          user_id: user.id,
          title: title.trim(),
          description: description.trim(),
          severity,
          page_url: window.location.href,
          browser_info: navigator.userAgent,
          screenshots: screenshots.length > 0 ? screenshots : null,
        });

      if (error) throw error;

      toast.success("Bug report submitted successfully");
      setTitle("");
      setDescription("");
      setSeverity("medium");
      setScreenshots([]);
      onOpenChange(false);
    } catch (error) {
      console.error("Error submitting bug report:", error);
      toast.error("Failed to submit bug report");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Report a Bug</DialogTitle>
          <DialogDescription>
            Help us improve the platform by reporting issues you encounter
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Issue Title *</Label>
            <Input
              id="title"
              placeholder="Brief description of the issue"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="severity">Severity *</Label>
            <Select value={severity} onValueChange={(value: any) => setSeverity(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low - Minor inconvenience</SelectItem>
                <SelectItem value="medium">Medium - Affects workflow</SelectItem>
                <SelectItem value="high">High - Major functionality broken</SelectItem>
                <SelectItem value="critical">Critical - System unusable</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="Detailed description of the issue, including steps to reproduce..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={8}
            />
          </div>

          <div className="space-y-2">
            <Label>Screenshots (Optional)</Label>
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                onClick={captureScreenshot}
                disabled={isCapturing || isSubmitting}
                className="w-full"
              >
                {isCapturing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Capturing...
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 mr-2" />
                    Capture Screenshot
                  </>
                )}
              </Button>
              
              {screenshots.length > 0 && (
                <div className="space-y-2">
                  {screenshots.map((screenshot, index) => (
                    <div key={index} className="flex items-center gap-2 p-2 bg-muted rounded">
                      <img 
                        src={screenshot} 
                        alt={`Screenshot ${index + 1}`}
                        className="w-16 h-16 object-cover rounded"
                      />
                      <span className="text-sm flex-1">Screenshot {index + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeScreenshot(index)}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="text-xs text-muted-foreground space-y-1">
            <p>Automatically captured:</p>
            <ul className="list-disc list-inside pl-2">
              <li>Current page: {window.location.pathname}</li>
              <li>Browser: {navigator.userAgent.split(" ").slice(-2).join(" ")}</li>
            </ul>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Bug Report"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};