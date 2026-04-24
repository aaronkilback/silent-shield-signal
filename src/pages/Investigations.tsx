import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Plus, FileText, Loader2, Sparkles, AlertTriangle, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface InvestigationTemplate {
  id: string;
  template_name: string;
  category: string;
  description: string;
  typical_synopsis_structure: string | null;
  typical_recommendations: string[] | null;
  common_entry_patterns: string[] | null;
  avg_entry_count: number | null;
  avg_days_to_close: number | null;
  confidence_score: number;
}

const Investigations = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const { selectedClientId, isContextReady } = useClientSelection();
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templates, setTemplates] = useState<InvestigationTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [duplicateWarnings, setDuplicateWarnings] = useState<any[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<InvestigationTemplate | null>(null);

  const { data: investigations = [], isLoading } = useQuery({
    queryKey: ['investigations'],
    queryFn: async () => {
      console.log('[Investigations] Fetching investigations...');
      const { data, error } = await supabase
        .from('investigations')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('[Investigations] Error fetching:', error);
        throw error;
      }
      console.log('[Investigations] Fetched count:', data?.length || 0);
      return data;
    },
    enabled: !!user && isContextReady
  });

  const fetchTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const { data, error } = await supabase.functions.invoke('investigation-ai-assist', {
        body: { action: 'suggest_template' }
      });
      if (error) throw error;
      setTemplates(data.templates || []);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      // Silently fail — templates are optional
    } finally {
      setLoadingTemplates(false);
    }
  };

  const handleNewInvestigation = async () => {
    // Fetch templates if we have learned patterns
    await fetchTemplates();
    if (templates.length > 0 || loadingTemplates) {
      setShowTemplateDialog(true);
    } else {
      // No templates available — create directly
      await createNewInvestigation(null);
    }
  };

  const createNewInvestigation = async (template: InvestigationTemplate | null) => {
    if (!user) return;

    setIsCreating(true);
    setShowTemplateDialog(false);
    try {
      // Generate file number
      const year = new Date().getFullYear();
      const count = investigations.length + 1;
      const fileNumber = `INV-${year}-${String(count).padStart(4, '0')}`;

      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .single();

      const insertData: any = {
        file_number: fileNumber,
        prepared_by: user.id,
        created_by_name: profile?.name || user.email || 'Unknown',
        client_id: selectedClientId || null,
      };

      // Apply template if selected
      if (template) {
        if (template.typical_synopsis_structure) {
          insertData.synopsis = template.typical_synopsis_structure;
        }
        if (template.typical_recommendations?.length) {
          insertData.recommendations = template.typical_recommendations.join('\n\n');
        }
      }

      const { data, error } = await supabase
        .from('investigations')
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;

      // If template had entry patterns, create initial entries
      if (template?.common_entry_patterns?.length) {
        const firstPattern = template.common_entry_patterns[0];
        if (firstPattern) {
          await supabase.from('investigation_entries').insert({
            investigation_id: data.id,
            entry_text: firstPattern,
            created_by: user.id,
            created_by_name: profile?.name || user.email || 'Unknown',
            is_ai_generated: true,
          });
        }
      }

      // Track template usage for feedback loop
      if (template) {
        await supabase.from('investigation_templates')
          .update({ times_used: (template as any).times_used ? (template as any).times_used + 1 : 1 })
          .eq('id', template.id);
      }

      toast.success(template 
        ? `Investigation created from "${template.template_name}" template` 
        : "Investigation file created"
      );
      navigate(`/investigation/${data.id}`);
    } catch (error: any) {
      console.error('Error creating investigation:', error);
      toast.error(error.message || "Failed to create investigation");
    } finally {
      setIsCreating(false);
    }
  };

  // Re-fetch templates when dialog opens
  useEffect(() => {
    if (showTemplateDialog && templates.length === 0) {
      fetchTemplates();
    }
  }, [showTemplateDialog]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  const categoryColors: Record<string, string> = {
    general: 'bg-muted text-muted-foreground',
    incident_response: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    vip_protection: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    travel_security: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    insider_threat: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
    cyber: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
    physical_security: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    fraud: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-primary/10">
              <FileText className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Investigations</h1>
              <p className="text-muted-foreground">Document and manage investigation files</p>
            </div>
          </div>
          <Button onClick={handleNewInvestigation} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                New Investigation
              </>
            )}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : investigations.length === 0 ? (
          <Card className="p-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No investigations yet</h3>
            <p className="text-muted-foreground mb-6">
              Create your first investigation file to start documenting evidence and investigative steps
            </p>
            <Button onClick={handleNewInvestigation} disabled={isCreating}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Investigation
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {investigations.map((investigation) => (
              <Card
                key={investigation.id}
                className="p-6 cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => navigate(`/investigation/${investigation.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg">{investigation.file_number}</h3>
                    {investigation.maximo_number && (
                      <p className="text-sm text-muted-foreground">
                        Maximo: {investigation.maximo_number}
                      </p>
                    )}
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    investigation.file_status === 'open' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : investigation.file_status === 'under_review'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }`}>
                    {investigation.file_status.replace('_', ' ')}
                  </span>
                </div>
                {investigation.synopsis && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {investigation.synopsis}
                  </p>
                )}
                <div className="text-xs text-muted-foreground">
                  <p>Created: {format(new Date(investigation.created_at), "MMM d, yyyy 'at' h:mm a")}</p>
                  <p>By: {investigation.created_by_name}</p>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Template Selection Dialog */}
        <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Start Investigation
              </DialogTitle>
              <DialogDescription>
                Choose a template based on learned patterns from past investigations, or start blank.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {/* Blank option */}
              <Card
                className="p-4 cursor-pointer hover:bg-accent/50 transition-colors border-2 border-transparent hover:border-primary/30"
                onClick={() => createNewInvestigation(null)}
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h4 className="font-medium">Blank Investigation</h4>
                    <p className="text-sm text-muted-foreground">Start from scratch with an empty file</p>
                  </div>
                </div>
              </Card>

              {loadingTemplates ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mr-2" />
                  <span className="text-sm text-muted-foreground">Loading learned templates...</span>
                </div>
              ) : templates.map((template) => (
                <Card
                  key={template.id}
                  className="p-4 cursor-pointer hover:bg-accent/50 transition-colors border-2 border-transparent hover:border-primary/30"
                  onClick={() => createNewInvestigation(template)}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <LayoutTemplate className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium">{template.template_name}</h4>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[template.category] || categoryColors.general}`}>
                          {template.category.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{template.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {template.avg_entry_count && (
                          <span>~{template.avg_entry_count} entries typical</span>
                        )}
                        {template.avg_days_to_close && (
                          <span>~{template.avg_days_to_close} days to close</span>
                        )}
                        <span>{Math.round(template.confidence_score * 100)}% confidence</span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Investigations;
