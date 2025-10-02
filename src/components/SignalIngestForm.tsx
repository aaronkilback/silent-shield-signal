import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const SignalIngestForm = () => {
  const [text, setText] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    setLoading(true);
    try {
      const { error } = await supabase.functions.invoke("ingest-signal", {
        body: {
          text: text.trim(),
          location: location.trim() || undefined,
        },
      });

      if (error) throw error;

      toast.success("Signal ingested successfully");
      setText("");
      setLocation("");
    } catch (error) {
      console.error("Error ingesting signal:", error);
      toast.error("Failed to ingest signal");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);

      // Handle array of signals or single signal
      const signals = Array.isArray(json) ? json : [json];

      for (const signal of signals) {
        const { error } = await supabase.functions.invoke("ingest-signal", {
          body: {
            text: signal.text || signal.message || JSON.stringify(signal),
            location: signal.location,
            raw_json: signal,
          },
        });

        if (error) throw error;
      }

      toast.success(`Ingested ${signals.length} signal(s)`);
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload file. Ensure it's valid JSON.");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingest Signal</CardTitle>
        <CardDescription>
          Submit a signal manually or upload JSON file
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="text">Signal Text</Label>
            <Textarea
              id="text"
              placeholder="Enter threat intelligence, suspicious activity, or security event..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location (Optional)</Label>
            <Input
              id="location"
              placeholder="e.g., Building A, Main Gate, Server Room"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={loading} className="flex-1">
              <Send className="w-4 h-4 mr-2" />
              Submit Signal
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => document.getElementById("file-upload")?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload JSON
            </Button>
            <input
              id="file-upload"
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
