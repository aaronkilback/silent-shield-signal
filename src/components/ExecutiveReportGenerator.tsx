import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Download, Loader2, Calendar, FileDown, Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import DOMPurify from 'dompurify';
import { useActivityTracking } from "@/hooks/useActivityTracking";
import { generatePdfFromHtml } from "@/utils/htmlToPdf";
import { useReportArchive } from "@/hooks/useReportArchive";

// Configure DOMPurify for safe HTML rendering in reports
const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'tr', 'td', 'th', 'div', 'span', 'img', 'style', 'head', 'body', 'html', 'meta', 'a'],
    ALLOWED_ATTR: ['class', 'style', 'src', 'alt', 'width', 'height', 'href', 'charset', 'content'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover']
  });
};

export const ExecutiveReportGenerator = () => {
  const { toast } = useToast();
  const { trackReportGeneration } = useActivityTracking();
  const { persistReport } = useReportArchive();
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

      if (error) {
        const reason = data?.message || data?.error || error.message;
        throw new Error(reason);
      }

      if (data.success) {
        setReportHtml(data.html);
        
        // Track report generation (excludes super_admin)
        trackReportGeneration('executive', data.metadata?.client || 'Unknown');
        
        // Auto-archive the report
        const clientName = data.metadata?.client || 'Unknown';
        const periodEnd = new Date();
        const periodStart = new Date();
        periodStart.setDate(periodStart.getDate() - parseInt(periodDays));
        persistReport.mutate({
          report_type: 'executive',
          title: `Executive Report — ${clientName} (${periodDays}d)`,
          client_id: selectedClientId,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          html_content: data.html,
          metadata: { client_name: clientName, period_days: parseInt(periodDays) },
        });
        
        toast({
          title: "Report Generated & Archived",
          description: `Executive intelligence report for ${clientName} is ready and saved to your archive.`,
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

  const downloadReportHTML = () => {
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
      description: "The HTML report has been saved to your device.",
    });
  };

  const downloadReportPDF = async () => {
    if (!reportHtml) return;

    try {
      toast({ title: "Generating PDF", description: "Please wait..." });
      const pdf = await generatePdfFromHtml(reportHtml);
      pdf.save(`executive-report-${new Date().toISOString().split('T')[0]}.pdf`);
      toast({ title: "PDF Downloaded", description: "The PDF report has been saved to your device." });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({ title: "PDF Generation Failed", description: "Failed to generate PDF", variant: "destructive" });
    }
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
            <div className="space-y-2 pt-4 border-t">
              <Button 
                onClick={openInNewTab} 
                variant="outline"
                className="w-full"
              >
                <Eye className="w-4 h-4 mr-2" />
                Preview Report
              </Button>
              <div className="flex gap-2">
                <Button 
                  onClick={downloadReportHTML} 
                  variant="outline"
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  HTML
                </Button>
                <Button 
                  onClick={downloadReportPDF} 
                  variant="outline"
                  className="flex-1"
                >
                  <FileDown className="w-4 h-4 mr-2" />
                  PDF
                </Button>
              </div>
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