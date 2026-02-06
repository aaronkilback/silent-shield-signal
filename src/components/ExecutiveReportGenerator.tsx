import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Download, Loader2, Calendar, FileDown, Eye } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import DOMPurify from 'dompurify';
import { useActivityTracking } from "@/hooks/useActivityTracking";

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
        
        // Track report generation (excludes super_admin)
        trackReportGeneration('executive', data.metadata?.client || 'Unknown');
        
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

    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.width = '794px';
    container.innerHTML = sanitizeHtml(reportHtml);
    document.body.appendChild(container);

    try {
      toast({
        title: "Generating PDF",
        description: "Please wait...",
      });

      const scale = 2;
      const canvas = await html2canvas(container, {
        scale,
        useCORS: true,
        logging: false,
        backgroundColor: '#0a0a0a',
        windowWidth: 794,
      });

      const MARGIN = 12;
      const CONTENT_W = 210 - MARGIN * 2;
      const CONTENT_H = 297 - MARGIN * 2;
      const pxWidth = canvas.width / scale;
      const scaleFactor = CONTENT_W / pxWidth;
      const stripHeightPx = (CONTENT_H / scaleFactor) * scale;

      const pdf = new jsPDF('p', 'mm', 'a4');
      let offsetY = 0;
      let pageIdx = 0;

      while (offsetY < canvas.height) {
        const thisH = Math.min(stripHeightPx, canvas.height - offsetY);
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = thisH;
        const ctx = slice.getContext('2d');
        if (!ctx) break;
        ctx.drawImage(canvas, 0, offsetY, canvas.width, thisH, 0, 0, canvas.width, thisH);

        const imgData = slice.toDataURL('image/jpeg', 0.92);
        const sliceH = (thisH / scale) * scaleFactor;

        if (pageIdx > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', MARGIN, MARGIN, CONTENT_W, sliceH);
        offsetY += thisH;
        pageIdx++;
      }

      pdf.save(`executive-report-${new Date().toISOString().split('T')[0]}.pdf`);

      toast({
        title: "PDF Downloaded",
        description: "The PDF report has been saved to your device.",
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: "PDF Generation Failed",
        description: "Failed to generate PDF",
        variant: "destructive",
      });
    } finally {
      document.body.removeChild(container);
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