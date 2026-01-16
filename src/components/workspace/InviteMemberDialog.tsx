import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
}

export const InviteMemberDialog = ({
  open,
  onOpenChange,
  workspaceId,
}: InviteMemberDialogProps) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("contributor");
  const [sending, setSending] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error("Please enter a valid email address");
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-workspace-invitation",
        {
          body: {
            workspaceId,
            email: email.trim(),
            role,
          },
        }
      );

      if (error) throw error;

      toast.success(`Invitation sent to ${email}`);
      setEmail("");
      setRole("contributor");
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending invitation:", error);
      toast.error(error?.message || "Failed to send invitation");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Invite by Email
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Email Address</label>
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Role</label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                <SelectItem value="contributor">
                  Contributor (can edit)
                </SelectItem>
                <SelectItem value="owner">Owner (full control)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            They'll receive an email with a link to sign up and automatically
            join this workspace.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button onClick={handleInvite} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              "Send Invitation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
