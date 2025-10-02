import { ClientQualificationForm } from "./ClientQualificationForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileSpreadsheet, FileJson, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";

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

      if (file.name.endsWith('.csv')) {
        parsedData = parseGoogleFormCSV(text);
      } else if (file.name.endsWith('.json')) {
        parsedData = JSON.parse(text);
      } else {
        throw new Error("Unsupported file format. Please upload CSV or JSON.");
      }

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
    <Tabs defaultValue="qualification" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="qualification">
          <UserPlus className="h-4 w-4 mr-2" />
          Client Qualification
        </TabsTrigger>
        <TabsTrigger value="bulk">
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Bulk Import
        </TabsTrigger>
        <TabsTrigger value="quick">
          <FileJson className="h-4 w-4 mr-2" />
          Quick Entry
        </TabsTrigger>
      </TabsList>

      <TabsContent value="qualification" className="mt-6">
        <ClientQualificationForm />
      </TabsContent>

      <TabsContent value="bulk" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Bulk Import</CardTitle>
            <CardDescription>
              Upload Google Form responses (CSV or JSON)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="quick" className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle>Quick Entry</CardTitle>
            <CardDescription>
              Manually enter basic client information
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                {loading ? "Processing..." : "Onboard Client"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
};
