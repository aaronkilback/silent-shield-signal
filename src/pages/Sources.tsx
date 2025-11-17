import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AddSourceDialog } from "@/components/AddSourceDialog";
import { SourcesList } from "@/components/SourcesList";

const Sources = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
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
        .update({ is_active: !isActive })
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">OSINT Sources</h1>
            <p className="text-muted-foreground mt-2">
              Manage your intelligence sources and monitoring configurations
            </p>
          </div>
          <Button onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Source
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Active Sources</CardTitle>
            <CardDescription>
              Configure and manage OSINT sources for intelligence gathering
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sources && sources.length > 0 ? (
              <SourcesList
                sources={sources}
                onToggleActive={(id, isActive) =>
                  toggleActiveMutation.mutate({ id, isActive })
                }
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No sources configured yet. Add your first source to get started.
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AddSourceDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      />
    </div>
  );
};

export default Sources;
