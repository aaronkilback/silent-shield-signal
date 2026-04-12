import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { FileText, Download, Eye, Loader2, FileDown, Upload, X, MapPin, AlertTriangle, Shield, Zap } from "lucide-react";
import { format } from "date-fns";
import { generatePdfFromHtml } from "@/utils/htmlToPdf";
import { Checkbox } from "@/components/ui/checkbox";
import DOMPurify from 'dompurify';
import { ImageLightbox, ImageLightboxTrigger } from "@/components/ui/image-lightbox";
import { useClientSelection } from "@/hooks/useClientSelection";

const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'table', 'tr', 'td', 'th', 'div', 'span', 'img', 'style', 'head', 'body', 'html', 'meta', 'a'],
    ALLOWED_ATTR: ['class', 'style', 'src', 'alt', 'width', 'height', 'href', 'charset', 'content'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'link'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });
};

const SEVERITY_CONFIG = {
  critical: { label: 'CRITICAL', color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
  high:     { label: 'HIGH',     color: '#ea580c', bg: '#fff7ed', border: '#fdba74' },
  medium:   { label: 'MEDIUM',   color: '#d97706', bg: '#fffbeb', border: '#fcd34d' },
  low:      { label: 'LOW',      color: '#16a34a', bg: '#f0fdf4', border: '#86efac' },
};

// Generate a bulletin reference number
function genBulletinRef(): string {
  const d = new Date();
  const ymd = format(d, 'yyyyMMdd');
  const seq = String(d.getHours() * 100 + d.getMinutes()).padStart(4, '0');
  return `SB-${ymd}-${seq}`;
}

// Build a Mapbox static image URL from a location string using Geocoding API
async function buildMapImageUrl(location: string, token: string): Promise<string | null> {
  if (!location || !token || token === 'your_mapbox_token_here') return null;
  try {
    const geo = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${token}&country=CA&limit=1`
    );
    const geoData = await geo.json();
    const feature = geoData.features?.[0];
    if (!feature) return null;
    const [lon, lat] = feature.center;
    return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/pin-s+dc2626(${lon},${lat})/${lon},${lat},11,0/800x360@2x?access_token=${token}`;
  } catch {
    return null;
  }
}

interface SecurityBulletinGeneratorProps {
  preselectedEntityId?: string;
}

export const SecurityBulletinGenerator = ({ preselectedEntityId }: SecurityBulletinGeneratorProps) => {
  const { selectedClientId } = useClientSelection();

  const [selectedEntity, setSelectedEntity] = useState<string>(preselectedEntityId || "");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>("");
  const [selectedSignalIds, setSelectedSignalIds] = useState<Set<string>>(new Set());
  const [bulletinType, setBulletinType] = useState<string>("threat_advisory");
  const [severity, setSeverity] = useState<string>("medium");
  const [location, setLocation] = useState<string>("");
  const [analystNotes, setAnalystNotes] = useState("");
  const [offenceDate, setOffenceDate] = useState("");
  const [generatedBulletin, setGeneratedBulletin] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<{ file: File; preview: string }[]>([]);
  const [selectedEntityPhotoIds, setSelectedEntityPhotoIds] = useState<Set<string>>(new Set());

  // ── Data queries ──────────────────────────────────────────────────────
  const { data: entities = [] } = useQuery({
    queryKey: ['entities-for-bulletin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entities')
        .select('id, name, type, description, threat_score, risk_level, current_location, address_city, address_province')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['incidents-for-bulletin'],
    queryFn: async () => {
      let q = supabase
        .from('incidents')
        .select('id, title, priority, status, opened_at')
        .in('status', ['open', 'investigating'])
        .order('opened_at', { ascending: false })
        .limit(30);
      if (selectedClientId) q = q.eq('client_id', selectedClientId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: recentSignals = [] } = useQuery({
    queryKey: ['signals-for-bulletin', selectedClientId],
    queryFn: async () => {
      let q = supabase
        .from('signals')
        .select('id, normalized_text, severity, category, created_at, source_url, title')
        .neq('is_test', true)
        .or('signal_type.neq.pattern,signal_type.is.null')
        .order('created_at', { ascending: false })
        .limit(40);
      if (selectedClientId) q = q.eq('client_id', selectedClientId);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: entityPhotos = [] } = useQuery({
    queryKey: ['entity-photos-for-bulletin', selectedEntity],
    queryFn: async () => {
      if (!selectedEntity || selectedEntity === "none") return [];
      const { data, error } = await supabase
        .from('entity_photos')
        .select('id, storage_path, caption')
        .eq('entity_id', selectedEntity);
      if (error) throw error;

      const paths = data.map((p: any) => p.storage_path);
      const { data: signedData } = await supabase.storage
        .from('entity-photos')
        .createSignedUrls(paths, 3600);
      const urlMap: Record<string, string> = {};
      signedData?.forEach((item: any) => { if (item.path && item.signedUrl) urlMap[item.path] = item.signedUrl; });
      return data.map((photo: any) => ({ ...photo, url: urlMap[photo.storage_path] || '' }));
    },
    enabled: !!selectedEntity && selectedEntity !== "none",
  });

  const { data: clientData } = useQuery({
    queryKey: ['client-for-bulletin', selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return null;
      const { data } = await supabase.from('clients').select('name').eq('id', selectedClientId).single();
      return data;
    },
    enabled: !!selectedClientId,
  });

  // Auto-populate location from incident or entity
  useEffect(() => {
    if (selectedIncidentId) {
      const inc = incidents.find((i: any) => i.id === selectedIncidentId);
      if (inc?.description) {
        // try to extract location from description title or keep blank
      }
    }
    const entity = entities.find((e: any) => e.id === selectedEntity);
    if (entity) {
      const loc = entity.current_location || [entity.address_city, entity.address_province].filter(Boolean).join(', ');
      if (loc && !location) setLocation(loc);
    }
  }, [selectedEntity, selectedIncidentId]);

  // ── Image handlers ────────────────────────────────────────────────────
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedImages(prev => [...prev, ...files.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
  };

  const removeUploadedImage = (index: number) => {
    setUploadedImages(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const toggleEntityPhoto = (photoId: string) => {
    setSelectedEntityPhotoIds(prev => {
      const n = new Set(prev);
      n.has(photoId) ? n.delete(photoId) : n.add(photoId);
      return n;
    });
  };

  const toggleSignal = (signalId: string) => {
    setSelectedSignalIds(prev => {
      const n = new Set(prev);
      if (n.has(signalId)) { n.delete(signalId); } else if (n.size < 5) { n.add(signalId); }
      return n;
    });
  };

  // ── Generate ──────────────────────────────────────────────────────────
  const generateBulletin = async () => {
    setIsGenerating(true);
    try {
      const bulletinRef = genBulletinRef();
      const currentDate = format(new Date(), "MMMM dd, yyyy");
      const incidentDate = offenceDate ? format(new Date(offenceDate + 'T12:00:00'), "MMMM dd, yyyy") : null;

      const entity = selectedEntity && selectedEntity !== "none"
        ? entities.find((e: any) => e.id === selectedEntity)
        : null;
      const incident = selectedIncidentId && selectedIncidentId !== 'none'
        ? incidents.find((i: any) => i.id === selectedIncidentId)
        : null;
      const chosenSignals = recentSignals.filter((s: any) => selectedSignalIds.has(s.id));

      // Fetch AI-generated content
      const { data: fnData, error: fnError } = await supabase.functions.invoke('generate-security-bulletin', {
        body: {
          entity,
          incident,
          signals: chosenSignals,
          analystNotes,
          location,
          severity,
          bulletinType,
          clientName: clientData?.name || 'Petronas Canada',
        },
      });

      if (fnError) {
        throw new Error(`Function error: ${fnError.message}`);
      }
      if (!fnData?.content) {
        throw new Error(`Unexpected response: ${JSON.stringify(fnData)}`);
      }

      // Normalise threat_assessment to a string if the AI returned an object
      const rawAi = fnData.content;
      const ai = {
        ...rawAi,
        threat_assessment: typeof rawAi.threat_assessment === 'object'
          ? Object.entries(rawAi.threat_assessment).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join('\n')
          : rawAi.threat_assessment,
      };
      const sev = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG] || SEVERITY_CONFIG.medium;

      // Map image
      const mapboxToken = localStorage.getItem('mapbox_token');
      const mapImageUrl = location && mapboxToken
        ? await buildMapImageUrl(location, mapboxToken)
        : null;

      // Photos HTML
      const selectedPhotos = entityPhotos.filter((p: any) => selectedEntityPhotoIds.has(p.id));
      const allPhotos = [
        ...selectedPhotos.map((p: any) => ({ url: p.url, caption: p.caption || '' })),
        ...uploadedImages.map(img => ({ url: img.preview, caption: '' })),
      ];

      const bulletin = buildBulletinHtml({
        bulletinRef,
        currentDate,
        incidentDate,
        severity: sev,
        location,
        entity,
        incident,
        chosenSignals,
        ai,
        mapImageUrl,
        allPhotos,
        clientName: clientData?.name || 'Petronas Canada',
      });

      setGeneratedBulletin(bulletin);
      toast.success("Security bulletin generated");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Error generating bulletin:", msg);
      toast.error(`Failed to generate bulletin: ${msg.substring(0, 120)}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── Download / preview ────────────────────────────────────────────────
  const downloadHTML = () => {
    if (!generatedBulletin) return;
    const blob = new Blob([generatedBulletin], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security_bulletin_${format(new Date(), 'yyyy-MM-dd')}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("HTML downloaded");
  };

  const downloadPDF = async () => {
    if (!generatedBulletin) return;
    try {
      toast.loading("Generating PDF...");
      const pdf = await generatePdfFromHtml(generatedBulletin, { backgroundColor: "#ffffff" });
      pdf.save(`security_bulletin_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.dismiss();
      toast.success("PDF downloaded");
    } catch (error) {
      toast.dismiss();
      toast.error("Failed to generate PDF");
    }
  };

  const openPreview = () => {
    if (!generatedBulletin) return;
    const w = window.open();
    if (w) { w.document.write(generatedBulletin); w.document.close(); }
  };

  const canGenerate = !isGenerating && (analystNotes || selectedIncidentId || selectedEntity || selectedSignalIds.size > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle>Security Bulletin Generator</CardTitle>
            <CardDescription>
              Threat advisories, incident reports, and site safety notices — from signals, entities, and analyst input
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Bulletin Type */}
        <div className="space-y-2">
          <Label>Bulletin Type</Label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'threat_advisory', label: 'Threat Advisory', desc: 'Emerging risk or trend (e.g. fuel theft, protest activity)' },
              { key: 'incident_report', label: 'Incident Report', desc: 'Something that happened — linked to an incident' },
              { key: 'security_notice', label: 'Security Notice', desc: 'Staff awareness — plain language, brief' },
              { key: 'site_safety',     label: 'Site Safety',     desc: 'Physical safety and site access bulletin' },
            ].map(({ key, label, desc }) => (
              <button
                key={key}
                onClick={() => setBulletinType(key)}
                className={`text-left p-3 rounded-md border-2 transition-all ${bulletinType === key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
              >
                <div className="font-medium text-sm">{label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div className="space-y-2">
          <Label>Severity Classification</Label>
          <div className="flex gap-2">
            {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setSeverity(key)}
                className={`flex-1 py-2 px-3 rounded-md border-2 text-xs font-bold transition-all ${severity === key ? 'border-current' : 'border-border opacity-50 hover:opacity-80'}`}
                style={severity === key ? { borderColor: cfg.color, color: cfg.color, background: cfg.bg } : {}}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Incident */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
            Linked Incident <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Select value={selectedIncidentId} onValueChange={setSelectedIncidentId}>
            <SelectTrigger>
              <SelectValue placeholder="Select open incident..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No incident</SelectItem>
              {incidents.map((inc: any) => (
                <SelectItem key={inc.id} value={inc.id}>
                  <span className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs px-1">{inc.priority?.toUpperCase()}</Badge>
                    {inc.title}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Entity */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-blue-500" />
            Subject Entity <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Select value={selectedEntity} onValueChange={setSelectedEntity}>
            <SelectTrigger>
              <SelectValue placeholder="Select entity..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No entity</SelectItem>
              {entities.map((e: any) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name} <span className="text-muted-foreground">({e.type})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Signals */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-yellow-500" />
            Supporting Signals <span className="text-muted-foreground font-normal">(select up to 5)</span>
          </Label>
          {recentSignals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent signals available</p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
              {recentSignals.map((s: any) => (
                <label
                  key={s.id}
                  className={`flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-muted/50 transition-colors ${selectedSignalIds.has(s.id) ? 'bg-primary/5 border border-primary/20' : ''}`}
                >
                  <Checkbox
                    checked={selectedSignalIds.has(s.id)}
                    onCheckedChange={() => toggleSignal(s.id)}
                    disabled={!selectedSignalIds.has(s.id) && selectedSignalIds.size >= 5}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Badge variant="outline" className="text-xs px-1 h-4">{s.severity}</Badge>
                      <Badge variant="outline" className="text-xs px-1 h-4">{s.category}</Badge>
                      <span className="text-xs text-muted-foreground ml-auto">{format(new Date(s.created_at), 'MMM d')}</span>
                    </div>
                    <p className="text-xs line-clamp-2 text-muted-foreground">
                      {s.title || s.normalized_text}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          )}
          {selectedSignalIds.size > 0 && (
            <p className="text-xs text-muted-foreground">{selectedSignalIds.size}/5 signals selected</p>
          )}
        </div>

        {/* Location */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-red-500" />
            Location <span className="text-muted-foreground font-normal">(for map)</span>
          </Label>
          <Input
            placeholder="e.g. Fort St. John, BC or 215 2nd St SW Calgary"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          {!localStorage.getItem('mapbox_token') || localStorage.getItem('mapbox_token') === 'your_mapbox_token_here' ? (
            <p className="text-xs text-muted-foreground">Map requires a Mapbox token (set in the map view)</p>
          ) : (
            <p className="text-xs text-green-600">Map will be generated for this location</p>
          )}
        </div>

        {/* Incident Date */}
        <div className="space-y-2">
          <Label>Incident Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
          <Input
            type="date"
            value={offenceDate}
            onChange={(e) => setOffenceDate(e.target.value)}
          />
        </div>

        {/* Analyst Notes */}
        <div className="space-y-2">
          <Label>Analyst Notes / Additional Context</Label>
          <Textarea
            placeholder="Add any observations, context, or details not captured above..."
            value={analystNotes}
            onChange={(e) => setAnalystNotes(e.target.value)}
            className="min-h-[120px]"
          />
        </div>

        {/* Photos */}
        <div className="space-y-3">
          <Label>Evidence Photos</Label>

          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                id="image-upload"
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                className="flex-1"
              />
              <Button variant="outline" size="icon" asChild>
                <label htmlFor="image-upload" className="cursor-pointer">
                  <Upload className="w-4 h-4" />
                </label>
              </Button>
            </div>

            {uploadedImages.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                {uploadedImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <ImageLightbox src={img.preview} alt={`Upload ${index + 1}`} className="w-full h-24 object-contain rounded-md border bg-muted" />
                    <Button
                      variant="destructive" size="icon"
                      className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      onClick={() => removeUploadedImage(index)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedEntity && selectedEntity !== "none" && entityPhotos.length > 0 && (
            <div className="space-y-2 pt-3 border-t">
              <Label className="text-sm text-muted-foreground">Select from entity photos</Label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {entityPhotos.map((photo: any) => {
                  const isSelected = selectedEntityPhotoIds.has(photo.id);
                  return (
                    <div
                      key={photo.id}
                      className={`relative cursor-pointer border-2 rounded-md overflow-hidden transition-all ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'}`}
                      onClick={() => toggleEntityPhoto(photo.id)}
                    >
                      <img src={photo.url} alt={photo.caption || 'Entity photo'} className="w-full h-24 object-contain bg-muted" />
                      <div className="absolute top-1 right-1 flex gap-1">
                        <ImageLightboxTrigger src={photo.url} alt={photo.caption || ''} className="h-6 w-6 opacity-0 group-hover:opacity-100" />
                        <Checkbox checked={isSelected} className="bg-background" onClick={(e) => e.stopPropagation()} />
                      </div>
                      {photo.caption && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">{photo.caption}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Generate */}
        <Button onClick={generateBulletin} disabled={!canGenerate} className="w-full">
          {isGenerating ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>
          ) : (
            <><FileText className="w-4 h-4 mr-2" />Generate Bulletin</>
          )}
        </Button>

        {generatedBulletin && (
          <div className="space-y-2">
            <Button variant="outline" onClick={openPreview} className="w-full">
              <Eye className="w-4 h-4 mr-2" />Preview
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={downloadHTML} className="flex-1">
                <Download className="w-4 h-4 mr-2" />HTML
              </Button>
              <Button variant="outline" onClick={downloadPDF} className="flex-1">
                <FileDown className="w-4 h-4 mr-2" />PDF
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ── Bulletin HTML builder ─────────────────────────────────────────────────────
function buildBulletinHtml({
  bulletinRef, currentDate, incidentDate, severity, location, entity, incident,
  chosenSignals, ai, mapImageUrl, allPhotos, clientName,
}: any): string {

  const entityHtml = entity ? `
    <div class="entity-box">
      <div class="section-title">Subject Entity</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="width:160px;color:#666;padding:3px 0;"><strong>Name</strong></td><td>${entity.name}</td></tr>
        <tr><td style="color:#666;padding:3px 0;"><strong>Type</strong></td><td>${entity.type}</td></tr>
        ${entity.risk_level ? `<tr><td style="color:#666;padding:3px 0;"><strong>Risk Level</strong></td><td><span class="risk-badge risk-${entity.risk_level}">${entity.risk_level.toUpperCase()}</span></td></tr>` : ''}
        ${entity.threat_score != null ? `<tr><td style="color:#666;padding:3px 0;"><strong>Threat Score</strong></td><td>${entity.threat_score}/100</td></tr>` : ''}
        ${entity.description ? `<tr><td colspan="2" style="padding-top:8px;color:#444;font-size:13px;">${entity.description.substring(0, 400)}${entity.description.length > 400 ? '…' : ''}</td></tr>` : ''}
      </table>
    </div>` : '';

  const incidentHtml = incident ? `
    <div class="section">
      <div class="section-title">Linked Incident</div>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="width:160px;color:#666;padding:3px 0;"><strong>Title</strong></td><td>${incident.title}</td></tr>
        <tr><td style="color:#666;padding:3px 0;"><strong>Priority</strong></td><td>${incident.priority?.toUpperCase()}</td></tr>
        <tr><td style="color:#666;padding:3px 0;"><strong>Status</strong></td><td>${incident.status}</td></tr>
        <tr><td style="color:#666;padding:3px 0;"><strong>Opened</strong></td><td>${new Date(incident.opened_at).toLocaleDateString('en-CA')}</td></tr>
      </table>
    </div>` : '';

  const signalsHtml = chosenSignals.length > 0 ? `
    <div class="section">
      <div class="section-title">Supporting Intelligence Signals</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tr style="background:#f8f9fa;"><th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb;">Date</th><th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb;">Severity</th><th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb;">Category</th><th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb;">Summary</th></tr>
        ${chosenSignals.map((s: any) => `
        <tr>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;white-space:nowrap;">${new Date(s.created_at).toLocaleDateString('en-CA')}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;text-transform:uppercase;font-size:11px;font-weight:bold;">${s.severity}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${s.category}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${(s.title || s.normalized_text || '').substring(0, 180)}</td>
        </tr>`).join('')}
      </table>
    </div>` : '';

  const mapHtml = mapImageUrl ? `
    <div class="section">
      <div class="section-title">Location Map — ${location}</div>
      <img src="${mapImageUrl}" style="width:100%;border-radius:4px;border:1px solid #ddd;" alt="Location map" />
    </div>` : (location ? `
    <div class="section">
      <div class="section-title">Location</div>
      <div style="display:flex;align-items:center;gap:8px;color:#374151;padding:8px 0;">
        <span style="font-size:18px;">📍</span><strong>${location}</strong>
      </div>
    </div>` : '');

  const photosHtml = allPhotos.length > 0 ? `
    <div class="section">
      <div class="section-title">Evidence Photos</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;margin-top:8px;">
        ${allPhotos.map((p: any) => `
          <div style="page-break-inside:avoid;">
            <img src="${p.url}" style="width:100%;height:auto;max-height:300px;object-fit:contain;border:1px solid #ddd;border-radius:4px;background:#f8f9fa;" />
            ${p.caption ? `<p style="margin:5px 0 0;font-size:12px;color:#666;font-style:italic;">${p.caption}</p>` : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  const actionsHtml = ai.recommended_actions?.length ? `
    <ul style="margin:8px 0 0;padding-left:20px;">
      ${ai.recommended_actions.map((a: string) => `<li style="margin-bottom:6px;">${a}</li>`).join('')}
    </ul>` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; max-width: 860px; margin: 0 auto; padding: 40px 24px; color: #1f2937; line-height: 1.6; }
    .header { border-bottom: 4px solid ${severity.color}; padding-bottom: 20px; margin-bottom: 28px; }
    .header-top { display: flex; justify-content: space-between; align-items: flex-start; }
    .bulletin-title { font-size: 28px; font-weight: bold; color: #111827; margin: 0; }
    .client-name { font-size: 14px; color: #6b7280; margin-top: 4px; }
    .severity-badge { display: inline-block; padding: 6px 18px; border-radius: 4px; font-weight: bold; font-size: 14px; letter-spacing: 1px; background: ${severity.color}; color: white; }
    .ref-block { text-align: right; font-size: 12px; color: #6b7280; margin-top: 8px; }
    .classification-banner { background: ${severity.bg}; border: 1px solid ${severity.border}; border-radius: 4px; padding: 8px 16px; margin: 16px 0; text-align: center; font-weight: bold; font-size: 13px; color: ${severity.color}; letter-spacing: 1px; }
    .executive-summary { background: #1e293b; color: white; padding: 20px 24px; border-radius: 6px; margin: 24px 0; }
    .executive-summary .label { font-size: 11px; letter-spacing: 2px; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; }
    .executive-summary p { margin: 0; font-size: 15px; line-height: 1.7; }
    .section { margin: 20px 0; padding: 16px 18px; background: #f8fafc; border-left: 4px solid ${severity.color}; border-radius: 0 4px 4px 0; }
    .section-title { font-weight: bold; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: ${severity.color}; margin-bottom: 10px; }
    .entity-box { background: #fff7ed; border: 1px solid ${severity.border}; padding: 16px 18px; border-radius: 6px; margin: 20px 0; }
    .risk-badge { display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: bold; }
    .risk-critical { background: #dc2626; color: white; }
    .risk-high { background: #ea580c; color: white; }
    .risk-medium { background: #d97706; color: white; }
    .risk-low { background: #16a34a; color: white; }
    .actions-box { background: #f0fdf4; border: 1px solid #86efac; padding: 16px 18px; border-radius: 6px; margin: 20px 0; }
    .actions-box .section-title { color: #16a34a; }
    .contact-box { background: #1e293b; color: white; padding: 20px 24px; border-radius: 6px; margin: 28px 0; }
    .contact-box h3 { margin: 0 0 10px; font-size: 14px; letter-spacing: 1px; text-transform: uppercase; color: #94a3b8; }
    .footer { margin-top: 36px; padding-top: 16px; border-top: 2px solid #e5e7eb; font-size: 11px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="bulletin-title">Security Bulletin</div>
        <div class="client-name">${clientName}</div>
      </div>
      <div style="text-align:right;">
        <div class="severity-badge">${severity.label}</div>
        <div class="ref-block">
          Ref: ${bulletinRef}<br>
          Issued: ${currentDate}${incidentDate ? `<br>Incident Date: ${incidentDate}` : ''}
        </div>
      </div>
    </div>
  </div>

  <div class="classification-banner">${ai.classification || 'CONFIDENTIAL — SECURITY SENSITIVE'}</div>

  <div class="executive-summary">
    <div class="label">Executive Summary — Bottom Line Up Front</div>
    <p>${ai.executive_summary || ''}</p>
  </div>

  ${entityHtml}
  ${incidentHtml}

  <div class="section">
    <div class="section-title">Situation Overview</div>
    <div style="white-space:pre-line;">${ai.situation_overview || ''}</div>
  </div>

  <div class="section">
    <div class="section-title">Threat Assessment</div>
    ${ai.threat_assessment || ''}
  </div>

  ${signalsHtml}
  ${mapHtml}

  <div class="actions-box">
    <div class="section-title">Recommended Actions</div>
    ${actionsHtml}
  </div>

  ${photosHtml}

  <div class="contact-box">
    <h3>Distribution &amp; Contact</h3>
    <div style="font-size:13px;color:#e2e8f0;margin-bottom:12px;">${ai.distribution_guidance || 'Security Operations, Senior Leadership'}</div>
    <div style="font-size:13px;line-height:1.8;color:#cbd5e1;">
      <strong>Field Security</strong><br>
      250-794-5673
    </div>
  </div>

  <div class="footer">
    <p><strong>${ai.classification || 'CONFIDENTIAL — SECURITY SENSITIVE'}</strong></p>
    <p>Generated ${currentDate} · ${bulletinRef} · Security Intelligence Platform</p>
  </div>
</body>
</html>`;
}
