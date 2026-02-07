import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FileText, Download, Eye, Loader2, FileDown, Upload, Image as ImageIcon, X } from "lucide-react";
import { format } from "date-fns";
import { generatePdfFromHtml } from "@/utils/htmlToPdf";
import { Checkbox } from "@/components/ui/checkbox";
import DOMPurify from 'dompurify';
import { ImageLightbox, ImageLightboxTrigger } from "@/components/ui/image-lightbox";

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

interface SecurityBulletinGeneratorProps {
  preselectedEntityId?: string;
}

export const SecurityBulletinGenerator = ({ preselectedEntityId }: SecurityBulletinGeneratorProps) => {
  const [selectedEntity, setSelectedEntity] = useState<string>(preselectedEntityId || "");
  const [details, setDetails] = useState("");
  const [offenceDate, setOffenceDate] = useState("");
  const [generatedBulletin, setGeneratedBulletin] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<{ file: File; preview: string }[]>([]);
  const [selectedEntityPhotoIds, setSelectedEntityPhotoIds] = useState<Set<string>>(new Set());

  const { data: entities = [] } = useQuery({
    queryKey: ['entities-for-bulletin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entities')
        .select('id, name, type, description, threat_score, risk_level')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data;
    }
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
      
      // Get public URLs for the photos
      const photosWithUrls = await Promise.all(
        data.map(async (photo) => {
          const { data: urlData } = supabase.storage
            .from('entity-photos')
            .getPublicUrl(photo.storage_path);
          
          return {
            ...photo,
            url: urlData.publicUrl
          };
        })
      );
      
      return photosWithUrls;
    },
    enabled: !!selectedEntity && selectedEntity !== "none"
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newImages = files.map(file => ({
      file,
      preview: URL.createObjectURL(file)
    }));
    setUploadedImages([...uploadedImages, ...newImages]);
  };

  const removeUploadedImage = (index: number) => {
    const newImages = [...uploadedImages];
    URL.revokeObjectURL(newImages[index].preview);
    newImages.splice(index, 1);
    setUploadedImages(newImages);
  };

  const toggleEntityPhoto = (photoId: string) => {
    const newSelected = new Set(selectedEntityPhotoIds);
    if (newSelected.has(photoId)) {
      newSelected.delete(photoId);
    } else {
      newSelected.add(photoId);
    }
    setSelectedEntityPhotoIds(newSelected);
  };

  const generateBulletin = async () => {
    if (!details) {
      toast.error("Please provide incident details");
      return;
    }

    setIsGenerating(true);
    try {
      const entity = selectedEntity && selectedEntity !== "none" 
        ? entities.find(e => e.id === selectedEntity)
        : null;
      const currentDate = format(new Date(), "MMMM dd, yyyy");
      const incidentDate = offenceDate ? format(new Date(offenceDate), "MMMM dd, yyyy") : "Not specified";

      // Prepare images HTML
      const selectedPhotos = entityPhotos.filter(photo => selectedEntityPhotoIds.has(photo.id));
      const allPhotos = [
        ...selectedPhotos.map(p => ({ url: p.url, caption: p.caption || '' })),
        ...uploadedImages.map(img => ({ url: img.preview, caption: '' }))
      ];

      const photosHtml = allPhotos.length > 0 
        ? allPhotos.map(photo => `
            <div style="margin: 15px 0; page-break-inside: avoid;">
              <img src="${photo.url}" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px;" />
              ${photo.caption ? `<p style="margin: 5px 0 0 0; font-size: 12px; color: #666; font-style: italic;">${photo.caption}</p>` : ''}
            </div>
          `).join('')
        : '<p style="color: #999;">No photos attached</p>';

      // Generate HTML bulletin
      const bulletin = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      color: #333;
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #1a365d;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      color: #1a365d;
      margin: 0 0 10px 0;
      font-size: 32px;
    }
    .tagline {
      color: #666;
      font-style: italic;
      margin: 0;
    }
    .section {
      margin: 25px 0;
      padding: 15px;
      background: #f8f9fa;
      border-left: 4px solid #1a365d;
    }
    .section-title {
      font-weight: bold;
      color: #1a365d;
      margin-bottom: 8px;
      font-size: 14px;
      text-transform: uppercase;
    }
    .section-content {
      color: #333;
      line-height: 1.6;
    }
    .entity-info {
      background: #fff3cd;
      padding: 15px;
      border-radius: 5px;
      margin: 20px 0;
      border: 1px solid #ffc107;
    }
    .risk-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: bold;
      margin-left: 10px;
    }
    .risk-critical { background: #dc2626; color: white; }
    .risk-high { background: #ea580c; color: white; }
    .risk-medium { background: #f59e0b; color: white; }
    .risk-low { background: #16a34a; color: white; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e5e7eb;
      text-align: center;
      font-size: 12px;
      color: #666;
    }
    .contact-box {
      background: #1a365d;
      color: white;
      padding: 20px;
      border-radius: 5px;
      margin: 30px 0;
    }
    .contact-box h3 {
      margin: 0 0 10px 0;
      font-size: 16px;
    }
    .contact-info {
      line-height: 1.8;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Security Bulletin</h1>
    <p class="tagline">Safely Observe, Document, Report</p>
  </div>

  <div class="section">
    <div class="section-title">Bulletin Date</div>
    <div class="section-content">${currentDate}</div>
  </div>

  ${entity ? `
  <div class="entity-info">
    <strong>Entity:</strong> ${entity.name}
    ${entity.risk_level ? `<span class="risk-badge risk-${entity.risk_level}">${entity.risk_level.toUpperCase()}</span>` : ''}
    <br><strong>Type:</strong> ${entity.type}
    ${entity.description ? `<br><strong>Description:</strong> ${entity.description}` : ''}
    ${entity.threat_score ? `<br><strong>Threat Score:</strong> ${entity.threat_score}/100` : ''}
  </div>
  ` : ''}

  <div class="section">
    <div class="section-title">Incident Date</div>
    <div class="section-content">${incidentDate}</div>
  </div>

  <div class="section">
    <div class="section-title">Details</div>
    <div class="section-content">${details.replace(/\n/g, '<br>')}</div>
  </div>

  <div class="section">
    <div class="section-title">Photos</div>
    <div class="section-content">
      ${photosHtml}
    </div>
  </div>

  <div class="contact-box">
    <h3>Contact Information</h3>
    <div class="contact-info">
      <strong>Security Operations Center</strong><br>
      24-Hour Emergency Line: 1-844-299-2566<br>
      Email: security@operations.local<br>
      For non-urgent matters: security-bulletin@operations.local
    </div>
  </div>

  <div class="footer">
    <p><strong>CONFIDENTIAL</strong> - This bulletin contains sensitive security information.</p>
    <p>Generated on ${currentDate} via Security Intelligence Platform</p>
  </div>
</body>
</html>
      `;

      setGeneratedBulletin(bulletin);
      toast.success("Security bulletin generated successfully");
    } catch (error) {
      console.error("Error generating bulletin:", error);
      toast.error("Failed to generate security bulletin");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadBulletinHTML = () => {
    if (!generatedBulletin) return;

    const blob = new Blob([generatedBulletin], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security_bulletin_${format(new Date(), 'yyyy-MM-dd')}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("HTML bulletin downloaded");
  };

  const downloadBulletinPDF = async () => {
    if (!generatedBulletin) return;

    try {
      toast.loading("Generating PDF...");
      const pdf = await generatePdfFromHtml(generatedBulletin, { backgroundColor: "#ffffff" });
      pdf.save(`security_bulletin_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.dismiss();
      toast.success("PDF bulletin downloaded");
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.dismiss();
      toast.error("Failed to generate PDF");
    }
  };

  const openInNewTab = () => {
    if (!generatedBulletin) return;

    const newWindow = window.open();
    if (newWindow) {
      newWindow.document.write(generatedBulletin);
      newWindow.document.close();
    }
  };

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
              Create formal security bulletins for incidents and entity observations
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="entity-select">Entity (Optional)</Label>
            <Select value={selectedEntity} onValueChange={setSelectedEntity}>
              <SelectTrigger id="entity-select">
                <SelectValue placeholder="Select an entity to include" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No entity</SelectItem>
                {entities.map((entity) => (
                  <SelectItem key={entity.id} value={entity.id}>
                    {entity.name} ({entity.type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offence-date">Incident Date</Label>
            <Input
              id="offence-date"
              type="date"
              value={offenceDate}
              onChange={(e) => setOffenceDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="details">Incident Details *</Label>
            <Textarea
              id="details"
              placeholder="Describe the security incident, observations, or threat details..."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="min-h-[150px]"
            />
          </div>

          <div className="space-y-3">
            <Label>Photos</Label>
            
            {/* Upload Images Section */}
            <div className="space-y-2">
              <Label htmlFor="image-upload" className="text-sm text-muted-foreground">
                Upload Images
              </Label>
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
                      <ImageLightbox
                        src={img.preview}
                        alt={`Upload ${index + 1}`}
                        className="w-full h-24 object-contain rounded-md border bg-muted"
                      />
                      <Button
                        variant="destructive"
                        size="icon"
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

            {/* Entity Photos Section */}
            {selectedEntity && selectedEntity !== "none" && entityPhotos.length > 0 && (
              <div className="space-y-2 pt-3 border-t">
                <Label className="text-sm text-muted-foreground">
                  Select from Entity Photos
                </Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {entityPhotos.map((photo) => {
                    const isSelected = selectedEntityPhotoIds.has(photo.id);
                    return (
                      <div 
                        key={photo.id}
                        className={`relative cursor-pointer border-2 rounded-md overflow-hidden transition-all ${
                          isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => toggleEntityPhoto(photo.id)}
                      >
                        <img
                          src={photo.url}
                          alt={photo.caption || 'Entity photo'}
                          className="w-full h-24 object-contain bg-muted"
                        />
                        <div className="absolute top-1 right-1 flex gap-1">
                          <ImageLightboxTrigger 
                            src={photo.url} 
                            alt={photo.caption || 'Entity photo'}
                            className="h-6 w-6 opacity-0 group-hover:opacity-100"
                          />
                          <Checkbox
                            checked={isSelected}
                            className="bg-background"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        {photo.caption && (
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-1 truncate">
                            {photo.caption}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <Button 
            onClick={generateBulletin} 
            disabled={isGenerating || !details}
            className="w-full"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Generate Bulletin
              </>
            )}
          </Button>

          {generatedBulletin && (
            <div className="space-y-2">
              <Button variant="outline" onClick={openInNewTab} className="w-full">
                <Eye className="w-4 h-4 mr-2" />
                Preview
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={downloadBulletinHTML} className="flex-1">
                  <Download className="w-4 h-4 mr-2" />
                  HTML
                </Button>
                <Button variant="outline" onClick={downloadBulletinPDF} className="flex-1">
                  <FileDown className="w-4 h-4 mr-2" />
                  PDF
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
