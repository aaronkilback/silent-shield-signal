import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, AlertTriangle, Archive, FolderOpen } from "lucide-react";
import { format } from "date-fns";

interface EntityUnifiedProfileProps {
  entityId: string;
  entityName: string;
}

export const EntityUnifiedProfile = ({ entityId, entityName }: EntityUnifiedProfileProps) => {
  const { data: signals } = useQuery({
    queryKey: ['entity-signals', entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .contains('auto_correlated_entities', [entityId])
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data;
    }
  });

  const { data: archivalDocs } = useQuery({
    queryKey: ['entity-archival', entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('archival_documents')
        .select('*')
        .contains('correlated_entity_ids', [entityId])
        .order('upload_date', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data;
    }
  });

  const { data: investigations } = useQuery({
    queryKey: ['entity-investigations', entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigations')
        .select('*')
        .contains('correlated_entity_ids', [entityId])
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      return data;
    }
  });

  const { data: mentions } = useQuery({
    queryKey: ['entity-mentions', entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entity_mentions')
        .select('*')
        .eq('entity_id', entityId)
        .order('detected_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unified Profile: {entityName}</CardTitle>
        <CardDescription>
          All correlated data, signals, documents, and investigations
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{signals?.length || 0}</div>
            <div className="text-sm text-muted-foreground">Signals</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{archivalDocs?.length || 0}</div>
            <div className="text-sm text-muted-foreground">Archival Docs</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{investigations?.length || 0}</div>
            <div className="text-sm text-muted-foreground">Investigations</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-primary">{mentions?.length || 0}</div>
            <div className="text-sm text-muted-foreground">Total Mentions</div>
          </div>
        </div>

        <Tabs defaultValue="signals">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="signals">Signals</TabsTrigger>
            <TabsTrigger value="archival">Archival</TabsTrigger>
            <TabsTrigger value="investigations">Investigations</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="signals">
            <ScrollArea className="h-[400px]">
              {!signals || signals.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No signals correlated
                </div>
              ) : (
                <div className="space-y-3">
                  {signals.map((signal) => (
                    <div key={signal.id} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-orange-500" />
                          <Badge variant={signal.severity === 'critical' ? 'destructive' : 'secondary'}>
                            {signal.severity || 'low'}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(signal.created_at), 'MMM d, yyyy HH:mm')}
                        </span>
                      </div>
                      <p className="text-sm line-clamp-2">{signal.normalized_text}</p>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="archival">
            <ScrollArea className="h-[400px]">
              {!archivalDocs || archivalDocs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No archival documents correlated
                </div>
              ) : (
                <div className="space-y-3">
                  {archivalDocs.map((doc) => (
                    <div key={doc.id} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Archive className="w-4 h-4 text-primary" />
                          <span className="font-medium text-sm">{doc.filename}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(doc.upload_date), 'MMM d, yyyy')}
                        </span>
                      </div>
                      {doc.summary && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{doc.summary}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="investigations">
            <ScrollArea className="h-[400px]">
              {!investigations || investigations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No investigations correlated
                </div>
              ) : (
                <div className="space-y-3">
                  {investigations.map((inv) => (
                    <div key={inv.id} className="p-3 border rounded-lg">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="w-4 h-4 text-primary" />
                          <span className="font-medium text-sm">{inv.file_number}</span>
                        </div>
                        <Badge variant="outline">{inv.file_status}</Badge>
                      </div>
                      {inv.synopsis && (
                        <p className="text-sm text-muted-foreground line-clamp-2">{inv.synopsis}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="timeline">
            <ScrollArea className="h-[400px]">
              {!mentions || mentions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No timeline data available
                </div>
              ) : (
                <div className="space-y-3">
                  {mentions.map((mention) => (
                    <div key={mention.id} className="p-3 border-l-2 border-primary pl-4">
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="outline" className="text-xs">
                          Confidence: {(mention.confidence * 100).toFixed(0)}%
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(mention.detected_at), 'MMM d, yyyy HH:mm')}
                        </span>
                      </div>
                      {mention.context && (
                        <p className="text-sm text-muted-foreground italic">"{mention.context}"</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
