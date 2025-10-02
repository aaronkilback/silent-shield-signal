import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileJson, FileSpreadsheet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const ClientOnboarding = () => {
  const [loading, setLoading] = useState(false);
  const [manualData, setManualData] = useState({
    name: "",
    organization: "",
    contact_email: "",
    industry: "",
    locations: "",
    high_value_assets: "",
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const text = await file.text();
      let parsedData;

      // Handle CSV from Google Forms
      if (file.name.endsWith('.csv')) {
        parsedData = parseGoogleFormCSV(text);
      } else if (file.name.endsWith('.json')) {
        parsedData = JSON.parse(text);
      } else {
        throw new Error("Unsupported file format. Please upload CSV or JSON.");
      }

      // Process the data
      await processClientData(parsedData);

      toast.success("Client data uploaded successfully");
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload file");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const parseGoogleFormCSV = (csv: string) => {
    const lines = csv.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    return lines.slice(1).filter(line => line.trim()).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/"/g, ''));
      const row: any = {};
      headers.forEach((header, i) => {
        row[header] = values[i] || '';
      });
      return row;
    });
  };

  const processClientData = async (data: any[]) => {
    for (const entry of data) {
      const { error } = await supabase.functions.invoke("process-client-onboarding", {
        body: { clientData: entry },
      });

      if (error) {
        console.error("Error processing client:", error);
        throw error;
      }
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await processClientData([manualData]);
      toast.success("Client onboarded successfully");
      setManualData({
        name: "",
        organization: "",
        contact_email: "",
        industry: "",
        locations: "",
        high_value_assets: "",
      });
    } catch (error) {
      console.error("Error:", error);
      toast.error("Failed to onboard client");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client Onboarding</CardTitle>
        <CardDescription>
          Upload Google Form responses or enter client data manually
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <h3 className="font-medium">Upload from Google Forms</h3>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => document.getElementById("csv-upload")?.click()}
              className="flex-1"
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Upload CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => document.getElementById("json-upload")?.click()}
              className="flex-1"
            >
              <FileJson className="w-4 h-4 mr-2" />
              Upload JSON
            </Button>
          </div>
          <input
            id="csv-upload"
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            id="json-upload"
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>

        <div className="border-t pt-6">
          <h3 className="font-medium mb-4">Manual Entry</h3>
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Client Name *</Label>
                <Input
                  id="name"
                  value={manualData.name}
                  onChange={(e) => setManualData({ ...manualData, name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="organization">Organization</Label>
                <Input
                  id="organization"
                  value={manualData.organization}
                  onChange={(e) => setManualData({ ...manualData, organization: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Contact Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={manualData.contact_email}
                  onChange={(e) => setManualData({ ...manualData, contact_email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={manualData.industry}
                  onChange={(e) => setManualData({ ...manualData, industry: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="locations">Locations (comma-separated)</Label>
              <Input
                id="locations"
                value={manualData.locations}
                onChange={(e) => setManualData({ ...manualData, locations: e.target.value })}
                placeholder="e.g., New York, Los Angeles, Chicago"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assets">High-Value Assets (comma-separated)</Label>
              <Textarea
                id="assets"
                value={manualData.high_value_assets}
                onChange={(e) => setManualData({ ...manualData, high_value_assets: e.target.value })}
                placeholder="e.g., Data Center, Executive Suite, Research Lab"
                rows={3}
              />
            </div>
            <Button type="submit" disabled={loading} className="w-full">
              <Upload className="w-4 h-4 mr-2" />
              {loading ? "Processing..." : "Onboard Client"}
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
};
