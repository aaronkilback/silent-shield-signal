import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, Shield, Edit, Trash2, Check, Star, Loader2 } from "lucide-react";
import { RoEEditor } from "./RoEEditor";
import { toast } from "sonner";

export function RoEPanel() {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [selectedRoeId, setSelectedRoeId] = useState<string | undefined>();

  const { data: roeList, isLoading, refetch } = useQuery({
    queryKey: ["rules-of-engagement"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rules_of_engagement")
        .select("*")
        .order("is_global_default", { ascending: false })
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const handleEdit = (id: string) => {
    setSelectedRoeId(id);
    setIsEditorOpen(true);
  };

  const handleCreate = () => {
    setSelectedRoeId(undefined);
    setIsEditorOpen(true);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("rules_of_engagement")
      .delete()
      .eq("id", id);
    
    if (error) {
      toast.error("Failed to delete RoE");
    } else {
      toast.success("RoE deleted");
      refetch();
    }
  };

  const handleSetDefault = async (id: string) => {
    // First, unset all defaults
    await supabase
      .from("rules_of_engagement")
      .update({ is_global_default: false })
      .neq("id", "00000000-0000-0000-0000-000000000000");
    
    // Set new default
    const { error } = await supabase
      .from("rules_of_engagement")
      .update({ is_global_default: true })
      .eq("id", id);
    
    if (error) {
      toast.error("Failed to set default");
    } else {
      toast.success("Default RoE updated");
      refetch();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Rules of Engagement
          </CardTitle>
          <Button size="sm" onClick={handleCreate}>
            <Plus className="h-4 w-4 mr-1" />
            New RoE
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : roeList?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Shield className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No RoE configurations yet</p>
            <Button className="mt-4" onClick={handleCreate}>
              Create First RoE
            </Button>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {roeList?.map((roe) => (
                <div
                  key={roe.id}
                  className="border rounded-lg p-4 space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{roe.name}</h4>
                        {roe.is_global_default && (
                          <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">
                            <Star className="h-3 w-3 mr-1" />
                            Default
                          </Badge>
                        )}
                      </div>
                      {roe.description && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {roe.description}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!roe.is_global_default && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleSetDefault(roe.id)}
                          title="Set as default"
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleEdit(roe.id)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      {!roe.is_global_default && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(roe.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={roe.mode === "STRICT" ? "destructive" : "secondary"}
                    >
                      {roe.mode}
                    </Badge>
                    <Badge variant="outline">{roe.audience}</Badge>
                    <Badge variant="outline">{roe.classification}</Badge>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {(roe.permissions as any)?.can_read_sources && (
                      <Badge variant="secondary" className="text-xs">
                        <Check className="h-2 w-2 mr-1" />
                        Sources
                      </Badge>
                    )}
                    {(roe.permissions as any)?.can_use_external_web && (
                      <Badge variant="secondary" className="text-xs">
                        <Check className="h-2 w-2 mr-1" />
                        Web
                      </Badge>
                    )}
                    {(roe.permissions as any)?.can_issue_directives && (
                      <Badge variant="secondary" className="text-xs">
                        <Check className="h-2 w-2 mr-1" />
                        Directives
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs">
                      Min: {(roe.evidence_policy as any)?.minimum_evidence_for_client_output || "E2"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <RoEEditor
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          roeId={selectedRoeId}
          onSuccess={() => refetch()}
        />
      </CardContent>
    </Card>
  );
}
