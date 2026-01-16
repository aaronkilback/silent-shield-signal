import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Shield, Loader2, Mail } from "lucide-react";

interface InvitationInfo {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  system_role?: string;
  workspace_title?: string;
}

const Auth = () => {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite");
  
  const [isLogin, setIsLogin] = useState(!inviteToken); // Default to signup if invite token present
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(!!inviteToken);
  const navigate = useNavigate();

  // Fetch invitation details if token is present
  useEffect(() => {
    const fetchInvitation = async () => {
      if (!inviteToken) return;
      
      setLoadingInvite(true);
      try {
        const { data, error } = await supabase
          .from("workspace_invitations")
          .select("id, workspace_id, email, role, system_role")
          .eq("token", inviteToken)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .single();

        if (error || !data) {
          toast.error("This invitation is invalid or has expired");
          return;
        }

        // Get workspace title
        const { data: workspace } = await supabase
          .from("investigation_workspaces")
          .select("title")
          .eq("id", data.workspace_id)
          .single();

        setInvitation({
          ...data,
          workspace_title: workspace?.title,
        });
        setEmail(data.email);
        setIsLogin(false); // Default to signup for invitations
      } catch (err) {
        console.error("Error fetching invitation:", err);
      } finally {
        setLoadingInvite(false);
      }
    };

    fetchInvitation();
  }, [inviteToken]);

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // If there's an invitation, handle it before redirecting
        if (invitation) {
          handleAcceptInvitation(session.user.id);
        } else {
          navigate("/");
        }
      }
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session && event === "SIGNED_IN") {
        // If there's an invitation, accept it
        if (invitation) {
          await handleAcceptInvitation(session.user.id);
        }
        navigate(invitation ? `/workspace/${invitation.workspace_id}` : "/");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, invitation]);

  const handleAcceptInvitation = async (userId: string) => {
    if (!invitation) return;

    try {
      // Add user to workspace
      await supabase.from("workspace_members").insert({
        workspace_id: invitation.workspace_id,
        user_id: userId,
        role: invitation.role,
      });

      // Update user's system role if specified in invitation
      // (replaces the default 'analyst' role assigned by trigger)
      if (invitation.system_role && invitation.system_role !== 'analyst') {
        // Delete default role first, then insert the specified role
        await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId);
        
        await supabase
          .from("user_roles")
          .insert({
            user_id: userId,
            role: invitation.system_role as any,
          });
      }

      // Mark invitation as accepted
      await supabase
        .from("workspace_invitations")
        .update({ 
          status: "accepted", 
          accepted_at: new Date().toISOString() 
        })
        .eq("id", invitation.id);

      toast.success(`Welcome to ${invitation.workspace_title || "the workspace"}!`);
    } catch (error: any) {
      console.error("Error accepting invitation:", error);
      // Don't show error if it's a duplicate (user already a member)
      if (!error.message?.includes("duplicate")) {
        toast.error("Could not join workspace automatically");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        toast.success("Welcome back to Fortress AI");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: name || email,
            },
            emailRedirectTo: invitation 
              ? `${window.location.origin}/workspace/${invitation.workspace_id}`
              : `${window.location.origin}/`,
          },
        });

        if (error) throw error;
        toast.success("Account created! You're now signed in.");
      }
    } catch (error: any) {
      console.error("Auth error:", error);
      toast.error(error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  if (loadingInvite) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading invitation...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 bg-card border-border">
        <div className="flex items-center justify-center mb-8">
          <div className="p-3 rounded-lg bg-primary/10">
            <Shield className="w-10 h-10 text-primary" />
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-center mb-2 text-foreground">Fortress AI</h1>
        <p className="text-center text-muted-foreground mb-4">
          Security Intelligence Platform
        </p>

        {invitation && (
          <div className="mb-6 p-4 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Workspace Invitation</span>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              You've been invited to join:
            </p>
            <p className="font-semibold">{invitation.workspace_title || "Investigation Workspace"}</p>
            <Badge variant="secondary" className="mt-2">{invitation.role}</Badge>
          </div>
        )}

        <div className="flex gap-2 mb-6">
          <Button
            variant={isLogin ? "default" : "outline"}
            className="flex-1"
            onClick={() => setIsLogin(true)}
          >
            Sign In
          </Button>
          <Button
            variant={!isLogin ? "default" : "outline"}
            className="flex-1"
            onClick={() => setIsLogin(false)}
          >
            Sign Up
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-secondary border-border"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="analyst@silentshield.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={!!invitation}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-secondary border-border"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isLogin ? "Signing in..." : "Creating account..."}
              </>
            ) : (
              <>
                {isLogin ? "Sign In" : "Create Account"}
                {invitation && !isLogin && " & Join Workspace"}
              </>
            )}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Secure access to Fortress AI intelligence network
        </p>
      </Card>
    </div>
  );
};

export default Auth;
