import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Plus, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useClientSelection } from "@/hooks/useClientSelection";

const Investigations = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);
  const { selectedClientId, isContextReady } = useClientSelection();

  const { data: investigations = [], isLoading } = useQuery({
    queryKey: ['investigations', selectedClientId],
    queryFn: async () => {
      let query = supabase
        .from('investigations')
        .select('*');
      
      if (selectedClientId) {
        query = query.eq('client_id', selectedClientId);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!user && isContextReady
  });

  const createNewInvestigation = async () => {
    if (!user) return;

    setIsCreating(true);
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

      const { data, error } = await supabase
        .from('investigations')
        .insert({
          file_number: fileNumber,
          prepared_by: user.id,
          created_by_name: profile?.name || user.email || 'Unknown',
          client_id: selectedClientId || null
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Investigation file created");
      navigate(`/investigation/${data.id}`);
    } catch (error: any) {
      console.error('Error creating investigation:', error);
      toast.error(error.message || "Failed to create investigation");
    } finally {
      setIsCreating(false);
    }
  };

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
          <Button onClick={createNewInvestigation} disabled={isCreating}>
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
            <Button onClick={createNewInvestigation} disabled={isCreating}>
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
                  <p>Created: {format(new Date(investigation.created_at), 'MMM dd, yyyy')}</p>
                  <p>By: {investigation.created_by_name}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Investigations;
