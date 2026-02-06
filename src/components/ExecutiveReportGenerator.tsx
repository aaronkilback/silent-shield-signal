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
    container.style.background = '#0a0a0a';

    // Extract body and styles
    const bodyMatch = reportHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    container.innerHTML = sanitizeHtml(bodyMatch ? bodyMatch[1] : reportHtml);
    
    const styleMatch = reportHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
    if (styleMatch) {
      const styleEl = document.createElement("style");
      styleEl.textContent = styleMatch.map((s) => s.replace(/<\/?style[^>]*>/gi, "")).join("\n");
      container.prepend(styleEl);
    }

    document.body.appendChild(container);

    try {
      toast({ title: "Generating PDF", description: "Please wait..." });

      // Pre-load images as base64 to bypass CORS
      const images = Array.from(container.querySelectorAll("img"));
      await Promise.allSettled(images.map(async (img) => {
        const src = img.getAttribute("src") || "";
        if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
        try {
          const resp = await fetch(src);
          if (!resp.ok) throw new Error();
          const blob = await resp.blob();
          const reader = new FileReader();
          const dataUrl = await new Promise<string>((res, rej) => {
            reader.onloadend = () => res(reader.result as string);
            reader.onerror = rej;
            reader.readAsDataURL(blob);
          });
          img.src = dataUrl;
          if (!img.complete) await new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); });
        } catch { img.style.display = "none"; }
      }));

      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)));

      const scale = 2;
      const MARGIN = 12;
      const CONTENT_W = 210 - MARGIN * 2;
      const CONTENT_H = 297 - MARGIN * 2;
      const mmPerPx = CONTENT_W / 794;

      const pdf = new jsPDF('p', 'mm', 'a4');
      const sections = Array.from(container.querySelectorAll("[data-pdf-section]")) as HTMLElement[];

      if (sections.length === 0) {
        // Fallback: render as one canvas and slice
        const canvas = await html2canvas(container, { scale, useCORS: true, allowTaint: true, logging: false, backgroundColor: null, windowWidth: 794 });
        const stripHeightPx = (CONTENT_H / mmPerPx) * scale;
        let offsetY = 0, pageIdx = 0;
        while (offsetY < canvas.height) {
          const thisH = Math.min(stripHeightPx, canvas.height - offsetY);
          const slice = document.createElement('canvas');
          slice.width = canvas.width; slice.height = thisH;
          const ctx = slice.getContext('2d');
          if (!ctx) break;
          ctx.drawImage(canvas, 0, offsetY, canvas.width, thisH, 0, 0, canvas.width, thisH);
          if (pageIdx > 0) pdf.addPage();
          pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN, CONTENT_W, (thisH / scale) * mmPerPx);
          offsetY += thisH; pageIdx++;
        }
      } else {
        // Section-aware rendering
        let currentY = 0;
        for (const section of sections) {
          let sectionCanvas: HTMLCanvasElement;
          try {
            sectionCanvas = await html2canvas(section, {
              scale, useCORS: true, allowTaint: true, logging: false, backgroundColor: null, windowWidth: 794,
            });
          } catch { continue; }
          if (sectionCanvas.height === 0) continue;
          const sectionH = (sectionCanvas.height / scale) * mmPerPx;
          if (currentY > 0 && currentY + sectionH > CONTENT_H) {
            pdf.addPage();
            currentY = 0;
          }
          pdf.addImage(sectionCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, MARGIN + currentY, CONTENT_W, sectionH);
          currentY += sectionH + 2;
        }
      }

      pdf.save(`executive-report-${new Date().toISOString().split('T')[0]}.pdf`);
      toast({ title: "PDF Downloaded", description: "The PDF report has been saved to your device." });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({ title: "PDF Generation Failed", description: "Failed to generate PDF", variant: "destructive" });
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