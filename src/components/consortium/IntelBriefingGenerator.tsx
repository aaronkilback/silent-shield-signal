import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useUserConsortia, useCreateIntelProduct, usePublishIntelProduct } from "@/hooks/useConsortia";
import { TLPBadge } from "./TLPBadge";
import { 
  IntelProductType, 
  TLPClassification,
  PRODUCT_TYPE_LABELS,
  TLP_DESCRIPTIONS
} from "@/lib/consortiumTypes";
import { supabase } from "@/integrations/supabase/client";
import { 
  FileText, 
  Loader2, 
  Sparkles, 
  Send, 
  Volume2,
  Clock,
  Calendar,
  CheckCircle,
  AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

export const IntelBriefingGenerator = () => {
  const [selectedConsortiumId, setSelectedConsortiumId] = useState<string | null>(null);
  const [productType, setProductType] = useState<IntelProductType>("blof");
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState<TLPClassification>("TLP:AMBER");
  const [periodDays, setPeriodDays] = useState(7);
  const [generatedContent, setGeneratedContent] = useState<string | null>(null);
  const [generatedHtml, setGeneratedHtml] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  
  const { data: consortia } = useUserConsortia();
  const createProduct = useCreateIntelProduct();
  const publishProduct = usePublishIntelProduct();
  
  const handleGenerate = async () => {
    if (!selectedConsortiumId) {
      toast.error("Please select a consortium");
      return;
    }
    
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-consortium-briefing', {
        body: {
          consortium_id: selectedConsortiumId,
          product_type: productType,
          period_days: periodDays,
          classification,
        },
      });
      
      if (error) throw error;
      
      setGeneratedContent(data.content);
      setGeneratedHtml(data.content_html);
      setTitle(data.suggested_title || `${PRODUCT_TYPE_LABELS[productType].label} - ${format(new Date(), 'MMM d, yyyy')}`);
      
      toast.success("Briefing generated successfully");
    } catch (error: any) {
      console.error('Error generating briefing:', error);
      toast.error(error.message || "Failed to generate briefing");
    } finally {
      setIsGenerating(false);
    }
  };
  
  const handleGenerateAudio = async () => {
    if (!generatedContent) return;
    
    setIsGeneratingAudio(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-briefing-audio', {
        body: {
          content: generatedContent,
          title,
        },
      });
      
      if (error) throw error;
      
      setAudioUrl(data.audio_url);
      toast.success("Audio briefing generated");
    } catch (error: any) {
      console.error('Error generating audio:', error);
      toast.error(error.message || "Failed to generate audio");
    } finally {
      setIsGeneratingAudio(false);
    }
  };
  
  const handleSave = async (publish: boolean = false) => {
    if (!selectedConsortiumId || !title || !generatedContent) {
      toast.error("Please generate a briefing first");
      return;
    }
    
    const product = await createProduct.mutateAsync({
      consortium_id: selectedConsortiumId,
      product_type: productType,
      title,
      summary: generatedContent.substring(0, 500),
      content: generatedContent,
      content_html: generatedHtml || undefined,
      classification,
      period_start: subDays(new Date(), periodDays).toISOString(),
      period_end: new Date().toISOString(),
      is_draft: !publish,
      ai_generated: true,
    });
    
    if (publish) {
      await publishProduct.mutateAsync(product.id);
    }
    
    // Reset form
    setGeneratedContent(null);
    setGeneratedHtml(null);
    setTitle("");
    setAudioUrl(null);
  };
  
  const selectedConsortium = consortia?.find(c => c.id === selectedConsortiumId);
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle>Intelligence Briefing Generator</CardTitle>
              <CardDescription>
                Generate BLOF reports, intel briefings, and incident digests for consortium dissemination
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="configure">
            <TabsList>
              <TabsTrigger value="configure">Configure</TabsTrigger>
              <TabsTrigger value="preview" disabled={!generatedContent}>Preview</TabsTrigger>
              <TabsTrigger value="disseminate" disabled={!generatedContent}>Disseminate</TabsTrigger>
            </TabsList>
            
            {/* Configure Tab */}
            <TabsContent value="configure" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Target Consortium</Label>
                  <Select value={selectedConsortiumId || ""} onValueChange={setSelectedConsortiumId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select consortium..." />
                    </SelectTrigger>
                    <SelectContent>
                      {consortia?.map((consortium) => (
                        <SelectItem key={consortium.id} value={consortium.id}>
                          {consortium.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Product Type</Label>
                  <Select value={productType} onValueChange={(v) => setProductType(v as IntelProductType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRODUCT_TYPE_LABELS).map(([key, { label, description }]) => (
                        <SelectItem key={key} value={key}>
                          <div>
                            <span className="font-medium">{label}</span>
                            <span className="text-xs text-muted-foreground ml-2">{description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Classification</Label>
                  <Select value={classification} onValueChange={(v) => setClassification(v as TLPClassification)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(TLP_DESCRIPTIONS).map(([tlp]) => (
                        <SelectItem key={tlp} value={tlp}>
                          <span className="font-mono text-xs">{tlp}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Reporting Period</Label>
                  <Select value={periodDays.toString()} onValueChange={(v) => setPeriodDays(parseInt(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Last 24 Hours</SelectItem>
                      <SelectItem value="7">Last 7 Days</SelectItem>
                      <SelectItem value="14">Last 14 Days</SelectItem>
                      <SelectItem value="30">Last 30 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {selectedConsortium && (
                <div className="p-4 rounded-lg bg-muted/50 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{selectedConsortium.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedConsortium.region} • {selectedConsortium.sector}
                    </p>
                  </div>
                  <TLPBadge classification={selectedConsortium.classification_default} showDescription />
                </div>
              )}
              
              <Button 
                onClick={handleGenerate} 
                disabled={!selectedConsortiumId || isGenerating}
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Briefing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate {PRODUCT_TYPE_LABELS[productType].label}
                  </>
                )}
              </Button>
            </TabsContent>
            
            {/* Preview Tab */}
            <TabsContent value="preview" className="mt-4 space-y-4">
              {generatedContent && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-2 flex-1 mr-4">
                      <Label>Title</Label>
                      <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Briefing title..."
                      />
                    </div>
                    <TLPBadge classification={classification} size="lg" showDescription />
                  </div>
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span>Period: {format(subDays(new Date(), periodDays), 'MMM d')} - {format(new Date(), 'MMM d, yyyy')}</span>
                    <Badge variant="secondary">{PRODUCT_TYPE_LABELS[productType].label}</Badge>
                  </div>
                  
                  <Card className="bg-muted/30">
                    <CardContent className="p-4">
                      <div 
                        className="prose prose-sm dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: generatedHtml || generatedContent }}
                      />
                    </CardContent>
                  </Card>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={handleGenerateAudio}
                      disabled={isGeneratingAudio}
                    >
                      {isGeneratingAudio ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Generating Audio...
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4 mr-2" />
                          Generate Audio Briefing
                        </>
                      )}
                    </Button>
                    
                    {audioUrl && (
                      <audio controls src={audioUrl} className="h-10">
                        Your browser does not support audio playback.
                      </audio>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 pt-4 border-t">
                    <Button
                      variant="outline"
                      onClick={() => handleSave(false)}
                      disabled={createProduct.isPending}
                    >
                      <Clock className="w-4 h-4 mr-2" />
                      Save as Draft
                    </Button>
                    <Button
                      onClick={() => handleSave(true)}
                      disabled={createProduct.isPending || publishProduct.isPending}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Save & Publish
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
            
            {/* Disseminate Tab */}
            <TabsContent value="disseminate" className="mt-4 space-y-4">
              {generatedContent && (
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0" />
                      <div>
                        <h3 className="font-semibold">Ready to Disseminate</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          This briefing will be shared with all consortium members based on their
                          classification clearance and sharing preferences.
                        </p>
                        <div className="mt-4 flex items-center gap-2">
                          <TLPBadge classification={classification} />
                          <span className="text-sm text-muted-foreground">
                            {TLP_DESCRIPTIONS[classification]}
                          </span>
                        </div>
                        <Button className="mt-4">
                          <Send className="w-4 h-4 mr-2" />
                          Disseminate to Consortium
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};
