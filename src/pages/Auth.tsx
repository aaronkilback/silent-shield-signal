import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Shield, Loader2, Mail, FileText } from "lucide-react";
import { getMCMRoleInfo, type MCMRole } from "@/lib/mcmRoles";
import { MFAVerification } from "@/components/MFAVerification";
import { SMSMFAVerification } from "@/components/SMSMFAVerification";
import { MandatoryMFAEnrollment } from "@/components/MandatoryMFAEnrollment";

const USER_AGREEMENT_CONTENT = [
  {
    title: "1. Professionalism & Respect",
    content: "Treat all members with courtesy. Engage in discussions in a respectful, professional manner. Personal attacks, harassment, or any form of discrimination will not be tolerated."
  },
  {
    title: "2. Respect for Aegis & Agents",
    content: "Our digital agents, including Aegis and other AI-driven team members, are here to support you. Please interact with them courteously and respect the boundaries of their use. Abuse or misuse of our agents will not be permitted."
  },
  {
    title: "3. AI Limitations & Feedback",
    content: "Understand that our AI agents, while powerful, are not perfect. Some results may require your oversight and feedback. We encourage you to provide constructive feedback to help us improve and to ensure that the information or recommendations you receive are accurate and useful."
  },
  {
    title: "4. Confidentiality & Privacy",
    content: "Respect the confidentiality of any information shared within Fortress. Do not disclose private or sensitive details outside the group or platform."
  },
  {
    title: "5. Integrity & Authenticity",
    content: "Be honest and authentic in your contributions. Misleading or false information undermines the community and will be addressed accordingly."
  },
  {
    title: "6. Constructive Participation",
    content: "Contribute constructively. Share insights, ask questions, and provide feedback that helps others grow and learn."
  },
  {
    title: "7. Security First",
    content: "As a community focused on security, always prioritize safe practices. Do not share any content that could compromise the safety or security of others."
  }
];

interface InvitationInfo {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  mcm_role?: string;
  system_role?: string;
  workspace_title?: string;
}

const Auth = () => {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite");
  
  // Check if coming from tenant invite flow - default to signup
  const hasTenantInviteRedirect = typeof window !== 'undefined' && sessionStorage.getItem('invite_redirect');
  const [isLogin, setIsLogin] = useState(!inviteToken && !hasTenantInviteRedirect); // Default to signup if invite
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(!!inviteToken);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  
  // MFA state (TOTP)
  const [showMFAChallenge, setShowMFAChallenge] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  
  // SMS MFA state
  const [showSMSMFA, setShowSMSMFA] = useState(false);
  const [smsMFAPhone, setSmsMFAPhone] = useState<string | null>(null);
  
  // Mandatory MFA enrollment for new signups
  const [showMandatoryMFA, setShowMandatoryMFA] = useState(false);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  
  const navigate = useNavigate();

  // Fetch invitation details if token is present
  useEffect(() => {
    const fetchInvitation = async () => {
      if (!inviteToken) return;
      
      setLoadingInvite(true);
      try {
        const { data, error } = await (supabase
          .from("workspace_invitations" as any)
          .select("id, workspace_id, email, role, mcm_role, system_role")
          .eq("token", inviteToken)
          .eq("status", "pending")
          .gt("expires_at", new Date().toISOString())
          .single() as any);

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
        // Check for invite redirect first
        const inviteRedirect = sessionStorage.getItem('invite_redirect');
        if (inviteRedirect) {
          sessionStorage.removeItem('invite_redirect');
          window.location.href = inviteRedirect;
          return;
        }
        
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
      // Don't redirect if user just signed up and is on welcome page flow
      // The navigate("/welcome") is called explicitly in handleSubmit
      if (event === "SIGNED_IN" && window.location.pathname === "/auth") {
        // Check for invite redirect first
        const inviteRedirect = sessionStorage.getItem('invite_redirect');
        if (inviteRedirect) {
          sessionStorage.removeItem('invite_redirect');
          window.location.href = inviteRedirect;
          return;
        }
        
        // If there's an invitation, accept it
        if (invitation) {
          await handleAcceptInvitation(session!.user.id);
          navigate(`/workspace/${invitation.workspace_id}`);
        }
        // Don't navigate for regular sign-in here - let handleSubmit handle it
      } else if (session && event === "USER_UPDATED") {
        // This can happen after signup confirmation - check for invite redirect
        const inviteRedirect = sessionStorage.getItem('invite_redirect');
        if (inviteRedirect) {
          sessionStorage.removeItem('invite_redirect');
          window.location.href = inviteRedirect;
          return;
        }
        // Only redirect if not already on welcome page
        if (window.location.pathname !== "/welcome") {
          navigate("/");
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, invitation]);

  const handleAcceptInvitation = async (userId: string) => {
    if (!invitation) return;

    try {
      // Add user to workspace with MCM role
      const memberData = {
        workspace_id: invitation.workspace_id,
        user_id: userId,
        role: invitation.role,
        mcm_role: invitation.mcm_role || 'investigator',
      };
      await supabase.from("workspace_members").insert(memberData as any);

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
      await (supabase
        .from("workspace_invitations" as any)
        .update({ 
          status: "accepted", 
          accepted_at: new Date().toISOString() 
        })
        .eq("id", invitation.id) as any);

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
    
    // Require agreement acceptance for signup
    if (!isLogin && !agreementAccepted) {
      toast.error("Please accept the User Agreement & Code of Conduct to continue");
      return;
    }
    
    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        
        // Check if MFA is required
        if (data.session) {
          // First check for TOTP MFA
          const { data: factorsData } = await supabase.auth.mfa.listFactors();
          const verifiedFactors = factorsData?.totp?.filter(f => f.status === 'verified') || [];
          
          if (verifiedFactors.length > 0) {
            // TOTP MFA is enabled - show verification screen
            setMfaFactorId(verifiedFactors[0].id);
            setShowMFAChallenge(true);
            setLoading(false);
            return;
          }
          
          // Check for SMS MFA (cast to any until types regenerate)
          const { data: mfaSettings } = await (supabase as any)
            .from('user_mfa_settings')
            .select('mfa_enabled, phone_number')
            .eq('user_id', data.user!.id)
            .maybeSingle();
          
          if (mfaSettings?.mfa_enabled && mfaSettings?.phone_number) {
            // SMS MFA is enabled - show SMS verification screen
            setSmsMFAPhone(mfaSettings.phone_number);
            setShowSMSMFA(true);
            setLoading(false);
            return;
          }

          // No MFA enrolled — enforce for all users
          setPendingUserId(data.user!.id);
          setShowMandatoryMFA(true);
          toast.warning("Two-factor authentication is required to access Fortress.");
          setLoading(false);
          return;
        }

        toast.success("Welcome back to Fortress AI");

        // Navigate to dashboard after successful login (no MFA case)
        navigate("/");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              name: name || email,
              agreement_accepted: true,
              agreement_accepted_at: new Date().toISOString(),
            },
            emailRedirectTo: invitation 
              ? `${window.location.origin}/workspace/${invitation.workspace_id}`
              : `${window.location.origin}/`,
          },
        });

        if (error) throw error;
        
        // Get the newly created user
        const { data: { user } } = await supabase.auth.getUser();
        
        if (user) {
          // Store user ID for MFA enrollment
          setPendingUserId(user.id);
          
          // Show mandatory MFA enrollment for all new signups
          setShowMandatoryMFA(true);
          toast.success("Account created! Please set up two-factor authentication.");
        }
      }
    } catch (error: any) {
      console.error("Auth error:", error);
      toast.error(error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };
  
  const handleMFASuccess = async () => {
    setShowMFAChallenge(false);
    setMfaFactorId(null);
    toast.success("Welcome back to Fortress AI");
    
    if (invitation) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await handleAcceptInvitation(user.id);
      }
      navigate(`/workspace/${invitation.workspace_id}`);
    } else {
      navigate("/");
    }
  };
  
  const handleMFACancel = async () => {
    await supabase.auth.signOut();
    setShowMFAChallenge(false);
    setMfaFactorId(null);
  };
  
  const handleSMSMFASuccess = async () => {
    setShowSMSMFA(false);
    setSmsMFAPhone(null);
    toast.success("Welcome back to Fortress AI");
    
    if (invitation) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await handleAcceptInvitation(user.id);
      }
      navigate(`/workspace/${invitation.workspace_id}`);
    } else {
      navigate("/");
    }
  };
  
  const handleSMSMFACancel = async () => {
    await supabase.auth.signOut();
    setShowSMSMFA(false);
    setSmsMFAPhone(null);
  };

  const handleMandatoryMFAComplete = async () => {
    setShowMandatoryMFA(false);
    
    if (invitation && pendingUserId) {
      await handleAcceptInvitation(pendingUserId);
      navigate(`/workspace/${invitation.workspace_id}`);
    } else {
      navigate("/welcome");
    }
  };

  // Show mandatory MFA enrollment for new signups
  if (showMandatoryMFA) {
    return <MandatoryMFAEnrollment onComplete={handleMandatoryMFAComplete} />;
  }

  // Show TOTP MFA challenge screen
  if (showMFAChallenge && mfaFactorId) {
    return (
      <MFAVerification
        factorId={mfaFactorId}
        onSuccess={handleMFASuccess}
        onCancel={handleMFACancel}
      />
    );
  }
  
  // Show SMS MFA challenge screen
  if (showSMSMFA && smsMFAPhone) {
    return (
      <SMSMFAVerification
        phoneNumber={smsMFAPhone}
        onVerified={handleSMSMFASuccess}
        onCancel={handleSMSMFACancel}
      />
    );
  }

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
            <div className="flex gap-2 mt-2">
              <Badge variant={getMCMRoleInfo(invitation.mcm_role).badgeVariant}>
                {getMCMRoleInfo(invitation.mcm_role).label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {getMCMRoleInfo(invitation.mcm_role).description}
            </p>
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password (min. 8 characters)</Label>
              {isLogin && (
                <button
                  type="button"
                  onClick={() => setShowForgotPassword(true)}
                  className="text-xs text-primary hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="bg-secondary border-border"
            />
          </div>

          {/* User Agreement for Signup */}
          {!isLogin && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FileText className="w-4 h-4 text-primary" />
                <span>User Agreement & Code of Conduct</span>
              </div>
              
              <ScrollArea className="h-48 rounded-md border border-border bg-secondary/50 p-4">
                <div className="space-y-4 pr-4">
                  <p className="text-sm text-muted-foreground">
                    Welcome to Fortress! To ensure a secure, respectful, and professional environment for everyone, we ask all members to agree to the following principles before proceeding:
                  </p>
                  
                  {USER_AGREEMENT_CONTENT.map((item, index) => (
                    <div key={index} className="space-y-1">
                      <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">{item.content}</p>
                    </div>
                  ))}
                  
                  <p className="text-sm text-muted-foreground pt-2 border-t border-border">
                    By agreeing to these principles, you help us create a trusted and professional environment for all members. Thank you for being a part of Fortress!
                  </p>
                </div>
              </ScrollArea>
              
              <div className="flex items-start space-x-3 pt-1">
                <Checkbox
                  id="agreement"
                  checked={agreementAccepted}
                  onCheckedChange={(checked) => setAgreementAccepted(checked === true)}
                  className="mt-0.5"
                />
                <Label 
                  htmlFor="agreement" 
                  className="text-sm text-muted-foreground leading-snug cursor-pointer"
                >
                  I have read and agree to the <span className="font-medium text-foreground">Fortress User Agreement & Code of Conduct</span>
                </Label>
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={loading || (!isLogin && !agreementAccepted)}
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

        {/* Forgot Password Dialog */}
        {showForgotPassword && (
          <div className="mt-4 p-4 border border-border rounded-lg bg-secondary/50 space-y-3">
            <p className="text-sm font-medium">Reset your password</p>
            <Input
              type="email"
              placeholder="Enter your email"
              value={resetEmail}
              onChange={(e) => setResetEmail(e.target.value)}
              className="bg-secondary border-border"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  if (!resetEmail) { toast.error("Enter your email"); return; }
                  const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
                    redirectTo: `${window.location.origin}/reset-password`,
                  });
                  if (error) toast.error(error.message);
                  else {
                    toast.success("Password reset email sent. Check your inbox.");
                    setShowForgotPassword(false);
                  }
                }}
              >
                <Mail className="w-3 h-3 mr-1" /> Send Reset Link
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForgotPassword(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center mt-6">
          Secure access to Fortress AI intelligence network
        </p>
      </Card>
    </div>
  );
};

export default Auth;
