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
import { Loader2, Mail, Shield } from "lucide-react";
import { toast } from "sonner";
import { MCM_ROLE_ORDER, MCM_ROLES, type MCMRole } from "@/lib/mcmRoles";
import { Badge } from "@/components/ui/badge";

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
  const [mcmRole, setMcmRole] = useState<MCMRole>("investigator");
  const [systemRole, setSystemRole] = useState("viewer");
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
            mcmRole,
            systemRole,
          },
        }
      );

      if (error) throw error;

      toast.success(`Invitation sent to ${email}`);
      setEmail("");
      setMcmRole("investigator");
      setSystemRole("viewer");
      onOpenChange(false);
    } catch (error: any) {
      console.error("Error sending invitation:", error);
      toast.error(error?.message || "Failed to send invitation");
    } finally {
      setSending(false);
    }
  };

  const selectedRoleInfo = MCM_ROLES[mcmRole];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Invite Team Member
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
            <label className="text-sm font-medium flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Investigation Role (MCM)
            </label>
            <p className="text-xs text-muted-foreground mb-2">
              Major Case Management role within this investigation
            </p>
            <Select value={mcmRole} onValueChange={(v) => setMcmRole(v as MCMRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MCM_ROLE_ORDER.map((role) => {
                  const info = MCM_ROLES[role];
                  return (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        <Badge variant={info.badgeVariant} className="text-xs px-1.5 py-0">
                          {info.shortLabel}
                        </Badge>
                        <span>{info.label}</span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {selectedRoleInfo && (
              <p className="text-xs text-muted-foreground mt-1.5 bg-muted/50 p-2 rounded">
                {selectedRoleInfo.description}
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">System Access</label>
            <p className="text-xs text-muted-foreground mb-1">
              App-wide permissions for agents, reports, etc.
            </p>
            <Select value={systemRole} onValueChange={setSystemRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">Viewer — Read-only access to data</SelectItem>
                <SelectItem value="analyst">Analyst — Create & manage incidents, signals</SelectItem>
                <SelectItem value="admin">Admin — Full system access</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="text-xs text-muted-foreground bg-muted p-3 rounded space-y-1">
            <p className="font-medium">Permission Summary:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {selectedRoleInfo?.permissions.map((perm) => (
                <li key={perm}>{perm.replace(/_/g, ' ')}</li>
              ))}
            </ul>
          </div>
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
