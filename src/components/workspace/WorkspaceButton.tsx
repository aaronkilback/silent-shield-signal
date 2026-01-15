import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Users, Loader2 } from "lucide-react";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

interface WorkspaceButtonProps {
  incidentId?: string;
  investigationId?: string;
  defaultTitle?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

export const WorkspaceButton = ({
  incidentId,
  investigationId,
  defaultTitle,
  variant = "outline",
  size = "default",
  className
}: WorkspaceButtonProps) => {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  // Check if workspace already exists for this incident/investigation
  const { data: existingWorkspace, isLoading } = useQuery({
    queryKey: ['workspace-exists', incidentId, investigationId],
    queryFn: async () => {
      let query = supabase
        .from('investigation_workspaces')
        .select('id, title')
        .eq('status', 'active');

      if (incidentId) {
        query = query.eq('incident_id', incidentId);
      } else if (investigationId) {
        query = query.eq('investigation_id', investigationId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!(incidentId || investigationId)
  });

  if (isLoading) {
    return (
      <Button variant={variant} size={size} disabled className={className}>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Loading...
      </Button>
    );
  }

  if (existingWorkspace) {
    return (
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => navigate(`/workspace/${existingWorkspace.id}`)}
      >
        <Users className="w-4 h-4 mr-2" />
        Open Workspace
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={() => setShowCreate(true)}
      >
        <Users className="w-4 h-4 mr-2" />
        Create Workspace
      </Button>

      <CreateWorkspaceDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        incidentId={incidentId}
        investigationId={investigationId}
        defaultTitle={defaultTitle}
      />
    </>
  );
};
