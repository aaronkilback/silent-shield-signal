import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Flame, Download, Loader2, FileDown, Eye, RefreshCw, AlertTriangle, Wind } from "lucide-react";
import DOMPurify from "dompurify";
import { generatePdfFromHtml } from "@/utils/htmlToPdf";
import { useReportArchive } from "@/hooks/useReportArchive";

const sanitizeHtml = (html: string): string =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'b','i','em','strong','p','br','ul','ol','li','h1','h2','h3','h4',
      'table','thead','tbody','tr','td','th','div','span','img','style',
      'head','body','html','meta','a',
    ],
    ALLOWED_ATTR: ['class','style','src','alt','width','height','href','charset','content','colspan','rowspan'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script','iframe','object','embed','link'],
    FORBID_ATTR: ['onerror','onload','onclick','onmouseover'],
  });

interface ReportMetadata {
  report_date: string;
  generated_at: string;
  station_count: number;
  active_fire_count: number;
  flare_count: number;
  lightning_count: number;
  lightning_latent_count: number;
  db_signal_count: number;
  highest_rating: string;
}

const ratingColor: Record<string, string> = {
  Low: 'text-green-700 bg-green-50 border-green-300',
  Moderate: 'text-yellow-700 bg-yellow-50 border-yellow-300',
  High: 'text-orange-700 bg-orange-50 border-orange-300',
  'Very High': 'text-red-700 bg-red-50 border-red-300',
  Extreme: 'text-purple-700 bg-purple-50 border-purple-300',
};

export const WildfireReportGenerator = () => {
  const { toast } = useToast();
  const { persistReport } = useReportArchive();
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportHtml, setReportHtml] = useState<string>("");
  const [metadata, setMetadata] = useState<ReportMetadata | null>(null);

  const generateReport = async () => {
    setIsGenerating(true);
    setReportHtml("");
    setMetadata(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-wildfire-daily-report', {
        body: {},
      });

      if (error) {
        const reason = data?.message || data?.error || error.message;
        throw new Error(reason);
      }

      if (data?.success) {
        setReportHtml(data.html);
        setMetadata(data.metadata);

        // Auto-archive to report library
        persistReport.mutate({
          report_type: 'wildfire_daily',
          title: `Daily Wildfire & Air Quality Report — ${data.metadata?.report_date ?? new Date().toLocaleDateString('en-CA')}`,
          period_start: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
          period_end: new Date().toISOString(),
          html_content: data.html,
          metadata: data.metadata ?? {},
        });

        toast({
          title: "Report Generated",
          description: `Wildfire & Air Quality report ready. ${data.metadata?.active_fire_count ?? 0} active detections in zone. Highest rating: ${data.metadata?.highest_rating ?? '—'}.`,
        });
      }
    } catch (err) {
      console.error('Wildfire report generation error:', err);
      toast({
        title: "Generation Failed",
        description: err instanceof Error ? err.message : "Failed to generate wildfire report",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadHTML = () => {
    if (!reportHtml) return;
    const blob = new Blob([reportHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wildfire-report-${metadata?.report_date ?? new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: "HTML report saved." });
  };

  const downloadPDF = async () => {
    if (!reportHtml) return;
    try {
      toast({ title: "Generating PDF", description: "Please wait..." });
      const pdf = await generatePdfFromHtml(reportHtml);
      pdf.save(`wildfire-report-${metadata?.report_date ?? new Date().toISOString().split('T')[0]}.pdf`);
      toast({ title: "PDF Downloaded", description: "Report saved as PDF." });
    } catch {
      toast({ title: "PDF Failed", description: "Could not generate PDF.", variant: "destructive" });
    }
  };

  const openInTab = () => {
    if (!reportHtml) return;
    const w = window.open();
    if (w) { w.document.write(reportHtml); w.document.close(); }
  };

  const ratingBadge = metadata?.highest_rating
    ? ratingColor[metadata.highest_rating] ?? 'text-gray-700 bg-gray-50 border-gray-300'
    : null;

  return (
    <div className="space-y-6">
      <Card className="border-orange-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded bg-orange-100">
              <Flame className="w-5 h-5 text-orange-600" />
            </div>
            Daily Wildfire & Air Quality Report
          </CardTitle>
          <CardDescription>
            Auto-populated from CWFIS/NRCan live fire data, BC Wildfire Service FWI, and Environment Canada AQHI.
            Covers all Petronas PECL operational zones (Peace/Montney, Skeena/Kitimat, Fort Nelson).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Live data sources badge row */}
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              { label: 'CWFIS Hotspots', desc: 'VIIRS satellite fire detections' },
              { label: 'Open-Meteo FWI', desc: 'Fire Weather Index per station' },
              { label: 'AQHI / EC', desc: 'Fort St. John air quality' },
              { label: 'FBP Spread Model', desc: 'Elliptical fire projections' },
              { label: '5 AWS Stations', desc: 'Hudson Hope · Graham · Wonowon · Pink Mtn · Muskwa' },
            ].map(s => (
              <span key={s.label} className="px-2 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200" title={s.desc}>
                {s.label}
              </span>
            ))}
          </div>

          <Button
            onClick={generateReport}
            disabled={isGenerating}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Fetching live data from CWFIS, Open-Meteo, AQHI...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Generate Today's Wildfire Report
              </>
            )}
          </Button>

          {/* Result summary strip */}
          {metadata && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
              <div className="text-center p-2 rounded-lg bg-slate-50 border">
                <div className="text-lg font-bold text-slate-800">{metadata.station_count}</div>
                <div className="text-xs text-slate-500 mt-0.5">Stations</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-50 border">
                <div className={`text-lg font-bold ${metadata.active_fire_count > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {metadata.active_fire_count}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">🔥 Fires</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-50 border">
                <div className={`text-lg font-bold ${metadata.flare_count > 0 ? 'text-orange-500' : 'text-slate-400'}`}>
                  {metadata.flare_count ?? 0}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">🏭 Flares</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-50 border">
                <div className={`text-lg font-bold ${metadata.lightning_count > 0 ? 'text-yellow-600' : 'text-slate-400'}`}>
                  {metadata.lightning_count ?? 0}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">⚡ Lightning</div>
              </div>
              <div className="text-center p-2 rounded-lg bg-slate-50 border">
                <div className={`text-lg font-bold ${(metadata.lightning_latent_count ?? 0) > 0 ? 'text-purple-600' : 'text-slate-400'}`}>
                  {metadata.lightning_latent_count ?? 0}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">⚡ Latent risk</div>
              </div>
              <div className={`text-center p-2 rounded-lg border ${ratingBadge ?? ''}`}>
                <div className="text-sm font-bold">{metadata.highest_rating}</div>
                <div className="text-xs mt-0.5 opacity-75">Highest rating</div>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {reportHtml && (
            <div className="space-y-2 pt-2 border-t">
              <Button onClick={openInTab} variant="outline" className="w-full">
                <Eye className="w-4 h-4 mr-2" />
                Preview Full Report
              </Button>
              <div className="flex gap-2">
                <Button onClick={downloadHTML} variant="outline" className="flex-1">
                  <Download className="w-4 h-4 mr-2" />
                  Download HTML
                </Button>
                <Button onClick={downloadPDF} variant="outline" className="flex-1">
                  <FileDown className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Feature highlights */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wind className="w-4 h-4 text-blue-500" />
            What's in this report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {[
              { icon: '🔥', title: 'Live Fire Danger Ratings', desc: '5 AWS stations — danger rating, days at rating, FWI trend, 3-day forecast' },
              { icon: '🚧', title: 'Restriction Decision Matrix', desc: 'Campfire, open burning, industrial, OHV — auto-determined from current rating' },
              { icon: '📡', title: 'CWFIS Hotspot Detections', desc: 'VIIRS satellite detections in last 24h with FRP, HFI, ROS, distance to Petronas assets' },
              { icon: '💨', title: 'AQHI — Fort St. John', desc: 'Current air quality, health category, forecast periods, field worker guidance' },
              { icon: '📐', title: 'FBP Spread Projections', desc: 'Canadian FBP elliptical fire model — 6h/12h/24h projected spread from active signals' },
              { icon: '🏢', title: 'Business Unit Summary', desc: 'SBU / EBU / WBU aggregate risk roll-up at a glance' },
              { icon: '📋', title: 'Operational Recommendations', desc: 'Rating-specific actions for HSE field personnel and supervisors' },
              { icon: '⚡', title: 'Auto-archived', desc: 'Every report saved to the Report Archive — accessible, downloadable, printable' },
            ].map(f => (
              <div key={f.title} className="flex items-start gap-2 p-2 rounded bg-background border">
                <span className="text-lg mt-0.5">{f.icon}</span>
                <div>
                  <div className="font-medium text-sm">{f.title}</div>
                  <div className="text-xs text-muted-foreground">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-2 p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Danger ratings are computed from Open-Meteo FWI data at station coordinates and validated against CWFIS hotspot FWI.
              Always confirm regulatory orders at <strong>bcwildfire.ca</strong> before making permit decisions.
              Report is intended as an operational awareness tool, not a substitute for official BCWS fire weather bulletins.
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
