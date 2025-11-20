import { Header } from "@/components/Header";
import { EntitySuggestionsPanel } from "@/components/EntitySuggestionsPanel";
import { EntityUnifiedProfile } from "@/components/EntityUnifiedProfile";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

const EntityManagement = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [selectedEntityId, setSelectedEntityId] = useState<string>("");

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const { data: entities } = useQuery({
    queryKey: ['entities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entities')
        .select('id, name, type')
        .eq('is_active', true)
        .order('name');
      
      if (error) throw error;
      return data;
    }
  });

  if (loading) {
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
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Entity Management</h1>
          <p className="text-muted-foreground mt-2">
            Review suggestions and view unified entity profiles
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <EntitySuggestionsPanel />
          
          <div className="space-y-6">
            <div className="space-y-2">
              <Label>View Entity Profile</Label>
              <Select value={selectedEntityId} onValueChange={setSelectedEntityId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an entity" />
                </SelectTrigger>
                <SelectContent>
                  {entities?.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.name} ({entity.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedEntityId && (
              <EntityUnifiedProfile
                entityId={selectedEntityId}
                entityName={entities?.find(e => e.id === selectedEntityId)?.name || ''}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default EntityManagement;
