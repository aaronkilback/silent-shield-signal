import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ChangePassword } from "./ChangePassword";
import { AlertTriangle } from "lucide-react";

export const PasswordExpiryGuard = () => {
  const { user } = useAuth();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!user?.id) return;

    const checkExpiry = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('last_password_changed_at')
        .eq('id', user.id)
        .single();

      if (!data?.last_password_changed_at) return;

      const lastChanged = new Date(data.last_password_changed_at);
      const now = new Date();
      const daysSince = Math.floor((now.getTime() - lastChanged.getTime()) / (1000 * 60 * 60 * 24));
      setExpired(daysSince >= 90);
    };

    checkExpiry();
  }, [user?.id]);

  if (!expired) return null;

  return (
    <Dialog open={expired} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            Password Expired
          </DialogTitle>
          <DialogDescription>
            Your password is over 90 days old. You must change it before continuing. This is a mandatory security requirement.
          </DialogDescription>
        </DialogHeader>
        <ChangePassword />
      </DialogContent>
    </Dialog>
  );
};
