import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId?: string;
  investigationId?: string;
  defaultTitle?: string;
}

export const CreateWorkspaceDialog = ({
  open,
  onOpenChange,
  incidentId,
  investigationId,
  defaultTitle = ""
}: CreateWorkspaceDialogProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!incidentId && !investigationId) {
      toast.error("This workspace must be linked to an incident or investigation.");
      return;
    }

    if (!user) {
      toast.error("Please sign in to create a workspace.");
      return;
    }

    setCreating(true);
    try {
      // Ensure we have a valid session (prevents RLS failures when token is missing/expired)
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const creatorId = session?.user?.id;
      if (!creatorId) {
        toast.error("Your session has expired. Please sign in again.");
        return;
      }

      // Create workspace
      const { data: workspace, error: workspaceError } = await supabase
        .from("investigation_workspaces")
        .insert({
          title: title.trim() || defaultTitle || "Investigation Workspace",
          description: description.trim() || null,
          incident_id: incidentId || null,
          investigation_id: investigationId || null,
          created_by_user_id: creatorId,
          status: "active",
        })
        .select()
        .single();

      if (workspaceError) throw workspaceError;

      // Add creator as owner
      const { error: memberError } = await supabase.from("workspace_members").insert({
        workspace_id: workspace.id,
        user_id: creatorId,
        role: "owner",
      });

      if (memberError) throw memberError;

      // Add initial system message
      await supabase.from("workspace_messages").insert({
        workspace_id: workspace.id,
        user_id: creatorId,
        content: "Workspace created. Welcome to the collaborative investigation space!",
        message_type: "system_event",
      });

      // Audit log
      await supabase.from("workspace_audit_log").insert({
        workspace_id: workspace.id,
        user_id: creatorId,
        action: "WORKSPACE_CREATED",
        details: { title: workspace.title, incident_id: incidentId, investigation_id: investigationId },
      });

      toast.success("Workspace created successfully!");
      onOpenChange(false);
      navigate(`/workspace/${workspace.id}`);
    } catch (error: any) {
      console.error("Error creating workspace:", error);
      toast.error(error?.message || "Failed to create workspace");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Create Investigation Workspace
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Workspace Title</label>
            <Input
              placeholder="Enter workspace title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description (optional)</label>
            <Textarea
              placeholder="Brief description of the investigation focus..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            You'll be added as the owner. You can invite other team members after creation.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Workspace'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
