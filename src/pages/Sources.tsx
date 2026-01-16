import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AddSourceDialog } from "@/components/AddSourceDialog";
import { EditSourceDialog } from "@/components/EditSourceDialog";
import { SourcesList } from "@/components/SourcesList";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { reportError } from "@/lib/errorReporting";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MonitoringDiagnostics } from "@/components/MonitoringDiagnostics";
import { Activity, Database } from "lucide-react";

const Sources = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const { data: sources, isLoading } = useQuery({
    queryKey: ["sources"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sources")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("sources")
        .update({ status: isActive ? 'paused' : 'active' })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source updated successfully");
    },
    onError: (error) => {
      console.error("Error updating source:", error);
      toast.error("Failed to update source");
      
      reportError({
        title: "Source Update Failed",
        description: "Failed to toggle source active status",
        severity: "medium",
        error: error instanceof Error ? error : new Error(String(error)),
        context: "Source Management"
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("sources")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sources"] });
      toast.success("Source deleted successfully");
    },
    onError: (error) => {
      console.error("Error deleting source:", error);
      toast.error("Failed to delete source");
      
      reportError({
        title: "Source Deletion Failed",
        description: "Failed to delete OSINT source",
        severity: "medium",
        error: error instanceof Error ? error : new Error(String(error)),
        context: "Source Management"
      });
    },
  });

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const filteredSources = sources?.filter((source) => {
    const searchLower = searchQuery.toLowerCase();
    return (
      source.name?.toLowerCase().includes(searchLower) ||
      source.type?.toLowerCase().includes(searchLower) ||
      source.status?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">OSINT Sources</h1>
            <p className="text-muted-foreground mt-2">
              Global monitoring sources that scan for signals (signals are then assigned to clients)
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Source
          </Button>
        </div>

        <Tabs defaultValue="sources" className="space-y-4">
          <TabsList>
            <TabsTrigger value="sources">
              <Database className="w-4 h-4 mr-2" />
              Sources
            </TabsTrigger>
            <TabsTrigger value="diagnostics">
              <Activity className="w-4 h-4 mr-2" />
              Diagnostics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sources" className="space-y-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search sources by name, type, or status..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Active Sources</CardTitle>
                <CardDescription>
                  Configure and manage OSINT sources for intelligence gathering
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ErrorBoundary context="Sources List">
                  {filteredSources && filteredSources.length > 0 ? (
                    <SourcesList
                      sources={filteredSources}
                      onToggleActive={(id, isActive) =>
                        toggleActiveMutation.mutate({ id, isActive })
                      }
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onEdit={(source) => {
                        setEditingSource(source);
                        setIsEditDialogOpen(true);
                      }}
                    />
                  ) : searchQuery ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No sources match your search.
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      No sources configured yet. Add your first source to get started.
                    </div>
                  )}
                </ErrorBoundary>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="diagnostics">
            <MonitoringDiagnostics />
          </TabsContent>
        </Tabs>
      </main>

      <AddSourceDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      />

      <EditSourceDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        source={editingSource}
      />
    </div>
  );
};

export default Sources;
