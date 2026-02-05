import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, Loader2, CheckCircle, AlertTriangle, Building2 } from "lucide-react";
import { toast } from "sonner";

interface ParsedReport {
  source_provider: string;
  report_type: string;
  location: {
    city?: string;
    country?: string;
    region?: string;
  };
  risk_rating: string;
  key_risks: string[];
  latest_developments: string[];
  security_advice: string[];
  emergency_contacts: { name: string; number: string }[];
  valid_date: string;
  raw_content: string;
}

const REPORT_PROVIDERS = [
  { id: "international_sos", name: "International SOS" },
  { id: "control_risks", name: "Control Risks" },
  { id: "global_guardian", name: "Global Guardian" },
  { id: "world_aware", name: "WorldAware" },
  { id: "crisis24", name: "Crisis24" },
  { id: "other", name: "Other Provider" },
];

export function SecurityReportUpload() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [parsedData, setParsedData] = useState<ParsedReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async ({ file, provider }: { file: File; provider: string }) => {
      // Upload file to storage
      const fileName = `${Date.now()}_${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("travel-documents")
        .upload(`security-reports/${fileName}`, file);

      if (uploadError) throw uploadError;

      // Get file content as base64
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // Call edge function to parse and extract intelligence
      const { data, error } = await supabase.functions.invoke("parse-travel-security-report", {
        body: {
          file_base64: base64,
          file_name: file.name,
          file_type: file.type,
          provider,
          storage_path: uploadData.path,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setParsedData(data.parsed_report);
      queryClient.invalidateQueries({ queryKey: ["security-reports"] });
      queryClient.invalidateQueries({ queryKey: ["travel-alerts"] });
      toast.success("Security report processed and intelligence extracted");
    },
    onError: (error) => {
      toast.error("Failed to process report: " + (error as Error).message);
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        toast.error("File size must be under 20MB");
        return;
      }
      setSelectedFile(file);
      setParsedData(null);
    }
  };

  const handleUpload = () => {
    if (!selectedFile || !provider) {
      toast.error("Please select a file and provider");
      return;
    }
    uploadMutation.mutate({ file: selectedFile, provider });
  };

  const getRiskColor = (risk: string) => {
    const lower = risk?.toLowerCase() || "";
    if (lower.includes("extreme") || lower.includes("critical")) return "destructive";
    if (lower.includes("high")) return "destructive";
    if (lower.includes("medium")) return "default";
    return "secondary";
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Upload Third-Party Security Report
          </CardTitle>
          <CardDescription>
            Upload security briefings from International SOS, Control Risks, or other providers.
            Intelligence will be extracted and integrated into travel risk assessments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Report Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_PROVIDERS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Report File (PDF)</Label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx"
                onChange={handleFileSelect}
                className="cursor-pointer"
              />
            </div>
          </div>

          {selectedFile && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>{selectedFile.name}</span>
              <span>({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</span>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={!selectedFile || !provider || uploadMutation.isPending}
            className="w-full"
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing Report...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload & Extract Intelligence
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {parsedData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Extracted Intelligence
            </CardTitle>
            <CardDescription>
              From {REPORT_PROVIDERS.find((p) => p.id === provider)?.name || provider}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-sm text-muted-foreground">Location:</span>
                <p className="font-medium">
                  {parsedData.location.city}, {parsedData.location.country}
                </p>
              </div>
              <Badge variant={getRiskColor(parsedData.risk_rating)}>
                {parsedData.risk_rating} Risk
              </Badge>
            </div>

            {parsedData.key_risks.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Key Risks</h4>
                <div className="flex flex-wrap gap-2">
                  {parsedData.key_risks.map((risk, i) => (
                    <Badge key={i} variant="outline">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {risk}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {parsedData.latest_developments.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Latest Developments</h4>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  {parsedData.latest_developments.slice(0, 5).map((dev, i) => (
                    <li key={i}>{dev}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsedData.security_advice.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Security Advice</h4>
                <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                  {parsedData.security_advice.slice(0, 5).map((advice, i) => (
                    <li key={i}>{advice}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsedData.emergency_contacts.length > 0 && (
              <div>
                <h4 className="font-medium mb-2">Emergency Contacts</h4>
                <div className="grid gap-1 text-sm">
                  {parsedData.emergency_contacts.map((contact, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{contact.name}</span>
                      <span className="font-mono">{contact.number}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
