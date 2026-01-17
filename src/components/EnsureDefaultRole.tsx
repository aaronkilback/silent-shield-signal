import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Ensures every authenticated user gets a minimal 'viewer' role.
 * Without this, new users have zero roles and RLS prevents them from seeing Signals/Clients.
 */
export function EnsureDefaultRole() {
  const queryClient = useQueryClient();
  const ranForThisSession = useRef(false);

  useEffect(() => {
    let active = true;

    const ensureViewerRole = async () => {
      if (!active) return;

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!active) return;

      // AuthSessionMissingError is expected when user is not logged in (e.g., on /auth page)
      // Only log unexpected errors
      if (userError) {
        if (userError.name !== 'AuthSessionMissingError') {
          console.error("[EnsureDefaultRole] Failed to get user:", userError);
        }
        return;
      }

      if (!user) return;
      if (ranForThisSession.current) return;

      ranForThisSession.current = true;

      const { data: existingRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .limit(1);

      if (rolesError) {
        console.error("[EnsureDefaultRole] Failed to check existing roles:", rolesError);
        return;
      }

      if ((existingRoles || []).length > 0) return;

      const { error: insertError } = await supabase
        .from("user_roles")
        .insert({ user_id: user.id, role: "viewer", created_by: user.id });

      if (insertError) {
        console.error("[EnsureDefaultRole] Failed to assign viewer role:", insertError);
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["user-roles"] });
    };

    // Run once on mount
    ensureViewerRole();

    // And re-run after auth transitions (login/logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      ranForThisSession.current = false;
      if (session?.user) ensureViewerRole();
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [queryClient]);

  return null;
}
