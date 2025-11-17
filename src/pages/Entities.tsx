import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CreateEntityDialog } from "@/components/CreateEntityDialog";
import { EntityDetailDialog } from "@/components/EntityDetailDialog";
import { SecurityBulletinGenerator } from "@/components/SecurityBulletinGenerator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Users, MapPin, Building2, Globe, Upload, LayoutGrid, List, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";

export default function Entities() {
  const [searchTerm, setSearchTerm] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [bulletinDialogOpen, setBulletinDialogOpen] = useState(false);
  const [bulletinEntityId, setBulletinEntityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { data: entities = [], refetch } = useQuery({
    queryKey: ['entities', searchTerm, selectedType],
    queryFn: async () => {
      let query = supabase
        .from('entities')
        .select(`
          *,
          entity_mentions(count),
          created_by_profile:profiles!entities_created_by_fkey(name)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (searchTerm) {
        query = query.or(`name.ilike.%${searchTerm}%,aliases.cs.{${searchTerm}}`);
      }

      if (selectedType) {
        query = query.eq('type', selectedType as any);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      toast.loading("Processing document and extracting entities...");
      
      const reader = new FileReader();
      reader.readAsDataURL(file);
      
      await new Promise((resolve, reject) => {
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(',')[1];
            
            const { data, error } = await supabase.functions.invoke("parse-entities-document", {
              body: {
                file: base64,
                filename: file.name,
                mimeType: file.type,
              },
            });

            if (error) throw error;
            
            const count = data.entities?.length || 0;
            toast.success(`Successfully created ${count} entities from document`);
            refetch();
            resolve(data);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
      });
    } catch (error) {
      console.error("Error uploading document:", error);
      toast.error("Failed to process document");
    } finally {
      setLoading(false);
      e.target.value = "";
    }
  };

  const getTypeIcon = (type: string) => {
    const icons: Record<string, any> = {
      person: Users,
      organization: Building2,
      location: MapPin,
      domain: Globe,
      ip_address: Globe
    };
    return icons[type] || Users;
  };

  const getRiskColor = (level: string) => {
    const colors: Record<string, string> = {
      critical: 'destructive',
      high: 'default',
      medium: 'secondary',
      low: 'outline'
    };
    return colors[level] || 'outline';
  };

  const getThreatFlames = (score: number | null | undefined) => {
    if (score === null || score === undefined) return '';
    // Convert 0-10 to 1-5 scale: 0-2=1🔥, 2-4=2🔥, 4-6=3🔥, 6-8=4🔥, 8-10=5🔥
    const flames = Math.min(5, Math.max(1, Math.ceil(score / 2)));
    return '🔥'.repeat(flames);
  };

  const entityTypes = [
    { value: 'person', label: 'People' },
    { value: 'organization', label: 'Organizations' },
    { value: 'location', label: 'Locations' },
    { value: 'infrastructure', label: 'Infrastructure' },
    { value: 'domain', label: 'Domains' },
    { value: 'ip_address', label: 'IP Addresses' }
  ];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Entity Tracking</h1>
            <p className="text-muted-foreground">
              Track persons, organizations, and indicators across signals
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline"
              disabled={loading}
              onClick={() => document.getElementById("entity-document-upload")?.click()}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Document
            </Button>
            <input
              id="entity-document-upload"
              type="file"
              accept=".pdf,.doc,.docx,.txt,.csv,.md"
              className="hidden"
              onChange={handleDocumentUpload}
            />
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Entity
            </Button>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search entities..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-2 flex-wrap">
              <Button
                variant={selectedType === null ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedType(null)}
              >
                All
              </Button>
              {entityTypes.map(type => (
                <Button
                  key={type.value}
                  variant={selectedType === type.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedType(type.value)}
                >
                  {type.label}
                </Button>
              ))}
            </div>
            <div className="flex gap-1">
              <Button
                variant={viewMode === 'grid' ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {entities.map((entity: any) => {
              const Icon = getTypeIcon(entity.type);
              return (
                <Card 
                  key={entity.id} 
                  className="p-4 hover:shadow-lg transition-shadow"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div 
                        className="flex items-center gap-2 cursor-pointer flex-1"
                        onClick={() => {
                          setSelectedEntityId(entity.id);
                          setDetailDialogOpen(true);
                        }}
                      >
                        <Icon className="w-5 h-5 text-primary" />
                        <h3 className="font-semibold">{entity.name}</h3>
                        {entity.threat_score !== null && entity.threat_score !== undefined && (
                          <span className="text-lg" title={`Threat Score: ${entity.threat_score}/10 (Recency + Confidence + Relevancy)`}>
                            {getThreatFlames(entity.threat_score)}
                          </span>
                        )}
                      </div>
                      <Badge variant={getRiskColor(entity.risk_level) as any}>
                        {entity.risk_level || 'unknown'}
                      </Badge>
                    </div>
                    
                    {entity.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {entity.description}
                      </p>
                    )}

                    {entity.aliases && entity.aliases.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {entity.aliases.slice(0, 3).map((alias: string, idx: number) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {alias}
                          </Badge>
                        ))}
                        {entity.aliases.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{entity.aliases.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{entity.entity_mentions[0]?.count || 0} mentions</span>
                      <span>{formatDistanceToNow(new Date(entity.created_at), { addSuffix: true })}</span>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEntityId(entity.id);
                          setDetailDialogOpen(true);
                        }}
                        className="flex-1"
                      >
                        View Details
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBulletinEntityId(entity.id);
                          setBulletinDialogOpen(true);
                        }}
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {entities.map((entity: any) => {
              const Icon = getTypeIcon(entity.type);
              return (
                <Card 
                  key={entity.id} 
                  className="p-4 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-center gap-4">
                    <Icon 
                      className="w-5 h-5 text-primary flex-shrink-0 cursor-pointer" 
                      onClick={() => {
                        setSelectedEntityId(entity.id);
                        setDetailDialogOpen(true);
                      }}
                    />
                    <div 
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => {
                        setSelectedEntityId(entity.id);
                        setDetailDialogOpen(true);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{entity.name}</h3>
                        {entity.threat_score !== null && entity.threat_score !== undefined && (
                          <span className="text-lg flex-shrink-0" title={`Threat Score: ${entity.threat_score}/10 (Recency + Confidence + Relevancy)`}>
                            {getThreatFlames(entity.threat_score)}
                          </span>
                        )}
                      </div>
                      {entity.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {entity.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0">
                      <Badge variant="outline" className="text-xs">
                        {entity.type}
                      </Badge>
                      <Badge variant={getRiskColor(entity.risk_level) as any}>
                        {entity.risk_level || 'unknown'}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {entity.entity_mentions[0]?.count || 0} mentions
                      </span>
                      <span className="text-xs text-muted-foreground w-24 text-right">
                        {formatDistanceToNow(new Date(entity.created_at), { addSuffix: true })}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBulletinEntityId(entity.id);
                          setBulletinDialogOpen(true);
                        }}
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {entities.length === 0 && (
          <div className="text-center py-12">
            <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No entities yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first entity to start tracking across signals
            </p>
            <Button onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Entity
            </Button>
          </div>
        )}
      </main>

        <CreateEntityDialog 
          open={createDialogOpen} 
          onOpenChange={setCreateDialogOpen}
        />
        
      <EntityDetailDialog
        entityId={selectedEntityId}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />

      <Dialog open={bulletinDialogOpen} onOpenChange={setBulletinDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Generate Security Bulletin</DialogTitle>
          </DialogHeader>
          <SecurityBulletinGenerator preselectedEntityId={bulletinEntityId || undefined} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
