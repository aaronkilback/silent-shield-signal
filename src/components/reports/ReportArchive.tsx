import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useReportArchive } from "@/hooks/useReportArchive";
import { Archive, Eye, Trash2, Download, FileDown, Loader2 } from "lucide-react";
import { generatePdfFromHtml } from "@/utils/htmlToPdf";
import { toast } from "sonner";
import { format } from "date-fns";

const typeLabels: Record<string, string> = {
  executive: "Executive Report",
  risk_snapshot: "Risk Snapshot",
  security_bulletin: "Security Bulletin",
  "72h-snapshot": "72h Snapshot",
};

export const ReportArchive = () => {
  const { reports, isLoading, deleteReport, getReportHtml } = useReportArchive();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handlePreview = async (reportId: string) => {
    // Open window NOW while still in the synchronous user-gesture callstack.
    // Browsers block window.open() called after an await.
    const w = window.open("", "_blank");
    if (!w) { toast.error("Popup blocked — allow popups for this site and try again."); return; }
    try {
      setLoadingId(reportId);
      const html = await getReportHtml(reportId);
      w.document.write(html);
      w.document.close();
    } catch { w.close(); toast.error("Failed to load report"); }
    finally { setLoadingId(null); }
  };

  const handleDownloadHtml = async (reportId: string, title: string) => {
    try {
      setLoadingId(reportId);
      const html = await getReportHtml(reportId);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error("Failed to download"); }
    finally { setLoadingId(null); }
  };

  const handleDownloadPdf = async (reportId: string, title: string) => {
    // Pre-open the window in gesture context before any await.
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) { toast.error("Popup blocked — allow popups for this site and try again."); return; }
    try {
      setLoadingId(reportId);
      toast.info("Generating PDF…");
      const html = await getReportHtml(reportId);
      await generatePdfFromHtml(html, undefined, popup);
      toast.success("PDF ready — use the browser print dialog to save as PDF");
    } catch { popup.close(); toast.error("PDF generation failed"); }
    finally { setLoadingId(null); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Archive className="w-5 h-5 text-primary" />
          Report Archive
        </CardTitle>
        <CardDescription>
          Previously generated reports — view, download, or re-export
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !reports || reports.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No archived reports yet. Generate a report above to get started.
          </p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
            {reports.map((report) => (
              <div
                key={report.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{report.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      {typeLabels[report.report_type] || report.report_type}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(report.created_at), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                    {report.metadata?.client_name && (
                      <span className="text-xs text-muted-foreground">• {report.metadata.client_name}</span>
                    )}
                    {report.metadata?.scheduled && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent-foreground">Auto</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handlePreview(report.id)}
                    disabled={loadingId === report.id}
                    title="Preview"
                  >
                    {loadingId === report.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleDownloadHtml(report.id, report.title)}
                    title="Download HTML"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleDownloadPdf(report.id, report.title)}
                    title="Download PDF"
                  >
                    <FileDown className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => deleteReport.mutate(report.id)}
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
