import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Camera, X, Mic, MicOff } from "lucide-react";
import html2canvas from "html2canvas";

// Voice dictation button component
function VoiceDictationButton({ 
  onResult, 
  size = "default" 
}: { 
  onResult: (text: string) => void;
  size?: "default" | "sm";
}) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Voice dictation not supported in this browser");
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      if (result.isFinal) {
        onResult(result[0].transcript);
      }
    };

    rec.onerror = () => {
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
    };

    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  };

  return (
    <Button
      type="button"
      variant={isListening ? "destructive" : "outline"}
      size={size === "sm" ? "sm" : "icon"}
      onClick={toggleListening}
      className={size === "sm" ? "gap-1" : ""}
    >
      {isListening ? (
        <>
          <MicOff className="h-4 w-4" />
          {size === "sm" && "Stop"}
        </>
      ) : (
        <>
          <Mic className="h-4 w-4" />
          {size === "sm" && "Dictate"}
        </>
      )}
    </Button>
  );
}

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
      
      // Get signed URL for private bucket
      const { data: signedData } = await supabase.storage
        .from('bug-screenshots')
        .createSignedUrl(filename, 86400); // 24h for bug reports
      
      setScreenshots([...screenshots, signedData?.signedUrl || '']);
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

      const { data, error } = await supabase
        .from('bug_reports')
        .insert({
          user_id: user.id,
          title: title.trim(),
          description: description.trim(),
          severity,
          page_url: window.location.href,
          browser_info: navigator.userAgent,
          screenshots: screenshots.length > 0 ? screenshots : null,
        })
        .select('id')
        .single();

      if (error) throw error;

      // Fire-and-forget AI triage
      if (data?.id) {
        supabase.functions.invoke('process-bug-report', {
          body: { bug_id: data.id, title: title.trim(), description: description.trim(), severity, page_url: window.location.href }
        }).catch(console.error);
      }

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
            Help us improve the platform by reporting issues you encounter. Use the microphone buttons to dictate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Issue Title *</Label>
            <div className="flex gap-2">
              <Input
                id="title"
                placeholder="Brief description of the issue"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={200}
                className="flex-1"
              />
              <VoiceDictationButton onResult={(text) => setTitle(prev => prev ? `${prev} ${text}` : text)} />
            </div>
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
            <div className="flex items-center justify-between">
              <Label htmlFor="description">Description *</Label>
              <VoiceDictationButton 
                onResult={(text) => setDescription(prev => prev ? `${prev} ${text}` : text)} 
                size="sm"
              />
            </div>
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