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
      // Ensure we have a valid session (prevents calling backend without auth)
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user?.id) {
        toast.error("Your session has expired. Please sign in again.");
        return;
      }

      const { data, error } = await supabase.functions.invoke("create-workspace", {
        body: {
          title: title.trim() || defaultTitle || "Investigation Workspace",
          description: description.trim() || null,
          incidentId: incidentId || null,
          investigationId: investigationId || null,
        },
      });

      if (error) throw error;

      const workspaceId: string | undefined = data?.workspace?.id;
      if (!workspaceId) {
        throw new Error("Workspace creation succeeded but no ID was returned");
      }

      toast.success("Workspace created successfully!");
      onOpenChange(false);
      navigate(`/workspace/${workspaceId}`);
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
