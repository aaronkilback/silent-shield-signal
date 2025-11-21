import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Upload, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const SignalIngestForm = () => {
  const [text, setText] = useState("");
  const [location, setLocation] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingStatus, setProcessingStatus] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !url.trim()) return;

    setLoading(true);
    try {
      const body: any = {
        location: location.trim() || undefined,
      };

      if (url.trim()) {
        body.url = url.trim();
        toast.loading("Scanning website...");
      } else {
        body.text = text.trim();
      }

      const { error } = await supabase.functions.invoke("ingest-signal", {
        body,
      });

      if (error) throw error;

      toast.success(url.trim() ? "Website scanned and signals created" : "Signal ingested successfully");
      setText("");
      setLocation("");
      setUrl("");
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

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // File size validation (20MB limit for edge functions)
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    if (file.size > MAX_FILE_SIZE) {
      toast.error(`File too large. Maximum size is 20MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB. Please use the Archival Upload feature for larger files.`);
      e.target.value = "";
      return;
    }

    setLoading(true);
    setUploadProgress(0);
    setProcessingStatus("Reading file...");
    const toastId = toast.loading("Processing document...");
    
    try {
      // Convert file to base64 for sending to edge function
      const reader = new FileReader();
      reader.readAsDataURL(file);
      
      // Simulate reading progress
      const readInterval = setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 30) {
            clearInterval(readInterval);
            return 30;
          }
          return prev + 5;
        });
      }, 100);
      
      await new Promise((resolve, reject) => {
        reader.onload = async () => {
          try {
            clearInterval(readInterval);
            setUploadProgress(40);
            setProcessingStatus("Uploading document...");
            
            const base64 = (reader.result as string).split(',')[1];
            
            setUploadProgress(60);
            setProcessingStatus("Processing content...");
            
            const { data, error } = await supabase.functions.invoke("parse-document", {
              body: {
                file: base64,
                filename: file.name,
                mimeType: file.type,
                location: location.trim() || undefined,
              },
            });

            if (error) {
              console.error("Edge function error:", error);
              throw new Error(error.message || "Failed to process document");
            }
            
            setUploadProgress(90);
            setProcessingStatus("Creating signal...");
            
            await new Promise(r => setTimeout(r, 500));
            
            setUploadProgress(100);
            setProcessingStatus("Complete!");
            
            toast.success("Document processed and signal created", { id: toastId });
            setText("");
            setLocation("");
            resolve(data);
          } catch (err) {
            clearInterval(readInterval);
            reject(err);
          }
        };
        reader.onerror = () => {
          clearInterval(readInterval);
          reject(new Error("Failed to read file"));
        };
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to process document";
      toast.error(errorMessage, { id: toastId });
      setUploadProgress(0);
      setProcessingStatus("");
    } finally {
      setTimeout(() => {
        setLoading(false);
        setUploadProgress(0);
        setProcessingStatus("");
      }, 1000);
      e.target.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ingest Signal</CardTitle>
        <CardDescription>
          Submit a signal manually, scan a website URL, upload documents (PDF, DOCX, TXT), or upload JSON file
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && uploadProgress > 0 && (
          <div className="space-y-2 p-4 bg-muted rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{processingStatus}</span>
              <span className="font-medium">{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="url">Website URL (Optional)</Label>
            <Input
              id="url"
              type="url"
              placeholder="https://example.com - AI will scan and analyze the website"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (e.target.value.trim()) setText("");
              }}
            />
          </div>

          <div className="text-center text-sm text-muted-foreground">OR</div>

          <div className="space-y-2">
            <Label htmlFor="text">Signal Text</Label>
            <Textarea
              id="text"
              placeholder="Enter threat intelligence, suspicious activity, or security event..."
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value.trim()) setUrl("");
              }}
              rows={4}
              disabled={!!url.trim()}
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
              onClick={() => document.getElementById("document-upload")?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Document
            </Button>
            <input
              id="document-upload"
              type="file"
              accept=".pdf,.doc,.docx,.txt,.csv,.md"
              className="hidden"
              onChange={handleDocumentUpload}
            />

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
