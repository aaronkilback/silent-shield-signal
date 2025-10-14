import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Download, Loader2, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

export const ExecutiveReportGenerator = () => {
  const { toast } = useToast();
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [periodDays, setPeriodDays] = useState<string>("7");
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>("");

  // Fetch clients
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name, status')
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  const generateReport = async () => {
    if (!selectedClientId) {
      toast({
        title: "Client Required",
        description: "Please select a client to generate a report.",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setReportHtml("");

    try {
      const { data, error } = await supabase.functions.invoke('generate-executive-report', {
        body: { 
          client_id: selectedClientId,
          period_days: parseInt(periodDays)
        }
      });

      if (error) throw error;

      if (data.success) {
        setReportHtml(data.html);
        toast({
          title: "Report Generated",
          description: `Executive intelligence report for ${data.metadata.client} is ready.`,
        });
      }
    } catch (error) {
      console.error('Error generating report:', error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadReport = () => {
    if (!reportHtml) return;

    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `executive-report-${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Report Downloaded",
      description: "The report has been saved to your device.",
    });
  };

  const openInNewTab = () => {
    if (!reportHtml) return;
    
    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(reportHtml);
      newWindow.document.close();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Executive Intelligence Report Generator
          </CardTitle>
          <CardDescription>
            Generate comprehensive, AI-powered security awareness reports with executive summaries, risk ratings, and strategic deductions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Client</label>
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Reporting Period
              </label>
              <Select value={periodDays} onValueChange={setPeriodDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 24 Hours</SelectItem>
                  <SelectItem value="3">Last 3 Days</SelectItem>
                  <SelectItem value="7">Last Week</SelectItem>
                  <SelectItem value="14">Last 2 Weeks</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={generateReport} 
              disabled={isGenerating || !selectedClientId}
              className="flex-1"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Generate Executive Report
                </>
              )}
            </Button>
          </div>

          {reportHtml && (
            <div className="flex gap-2 pt-4 border-t">
              <Button 
                onClick={openInNewTab} 
                variant="outline"
                className="flex-1"
              >
                <FileText className="w-4 h-4 mr-2" />
                Preview Report
              </Button>
              <Button 
                onClick={downloadReport} 
                variant="outline"
                className="flex-1"
              >
                <Download className="w-4 h-4 mr-2" />
                Download HTML
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-lg">Report Features</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span><strong>Executive Summary:</strong> AI-generated narrative analysis of threats and developments</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span><strong>Risk Matrix:</strong> Surveillance, Protest, Sabotage, and Threat categorization</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span><strong>Detailed Narratives:</strong> Professional intelligence write-ups by category</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span><strong>Strategic Deductions:</strong> Analysis of implications and escalation scenarios</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span><strong>Source Citations:</strong> Signal-level detail with timestamps and severity</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary mt-0.5">✓</span>
              <span><strong>Professional Format:</strong> Print-ready layout suitable for executive distribution</span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};