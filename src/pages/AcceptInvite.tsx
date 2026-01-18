import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function AcceptInvite() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, session, loading: authLoading } = useAuth();
  const { refetchTenants } = useTenant();
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'needs-auth'>('loading');
  const [message, setMessage] = useState('');
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  const token = searchParams.get('token');

  // Fetch invite details to show which email it's for
  const fetchInviteDetails = async () => {
    if (!token) return;
    
    try {
      // We'll peek at the invite to get the email (this is a lightweight check)
      const { data, error } = await supabase.functions.invoke('accept-invite', {
        body: { token, peek: true }
      });
      
      if (data?.invite_email) {
        setInviteEmail(data.invite_email);
      }
    } catch {
      // Ignore errors - this is just for UX improvement
    }
  };

  useEffect(() => {
    if (authLoading) return;

    if (!token) {
      setStatus('error');
      setMessage('Invalid invite link - no token provided');
      return;
    }

    if (!user || !session) {
      setStatus('needs-auth');
      setMessage('Please sign in or create an account to accept this invitation');
      fetchInviteDetails();
      return;
    }

    // Accept the invite
    acceptInvite();
  }, [token, user, session, authLoading]);

  const acceptInvite = async () => {
    try {
      setStatus('loading');
      
      const { data, error } = await supabase.functions.invoke('accept-invite', {
        body: { token }
      });

      if (error) {
        console.error('Accept invite error:', error);
        // Try to extract error details from the response
        let errorMessage = 'Failed to accept invitation';
        try {
          // The error context might contain the response body
          if (error.context?.body) {
            const bodyText = await error.context.text?.() || error.context.body;
            const parsed = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText;
            if (parsed?.error) {
              errorMessage = parsed.error;
            }
          }
        } catch {
          // If parsing fails, use the error message
          errorMessage = error.message || 'Failed to accept invitation';
        }
        setStatus('error');
        setMessage(errorMessage);
        return;
      }

      if (data?.error) {
        setStatus('error');
        setMessage(data.error);
        return;
      }

      setStatus('success');
      setTenantName(data.tenant_name);
      setMessage(data.message || 'Successfully joined the tenant!');
      
      // Refresh tenant list
      await refetchTenants();
      
      toast.success(`Welcome to ${data.tenant_name}!`);

    } catch (err: any) {
      console.error('Accept invite error:', err);
      setStatus('error');
      setMessage(err?.message || 'An unexpected error occurred');
    }
  };

  const handleGoToAuth = () => {
    // Store the current URL to redirect back after auth
    const currentUrl = window.location.href;
    sessionStorage.setItem('invite_redirect', currentUrl);
    navigate('/auth');
  };

  const handleSignOutAndRetry = async () => {
    const currentUrl = window.location.href;
    sessionStorage.setItem('invite_redirect', currentUrl);
    await supabase.auth.signOut();
    navigate('/auth');
  };

  const handleContinue = () => {
    navigate('/');
  };

  const isEmailMismatch = message.toLowerCase().includes('email');

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${
            status === 'success' ? 'bg-green-500/10' : 
            status === 'error' ? 'bg-destructive/10' : 
            'bg-primary/10'
          }`}>
            {status === 'loading' && <Loader2 className="h-8 w-8 animate-spin text-primary" />}
            {status === 'success' && <CheckCircle className="h-8 w-8 text-green-500" />}
            {status === 'error' && <XCircle className="h-8 w-8 text-destructive" />}
            {status === 'needs-auth' && <Shield className="h-8 w-8 text-primary" />}
          </div>
          <CardTitle className="text-2xl">
            {status === 'loading' && 'Accepting Invitation...'}
            {status === 'success' && 'Welcome Aboard!'}
            {status === 'error' && 'Invitation Failed'}
            {status === 'needs-auth' && 'Sign In Required'}
          </CardTitle>
          <CardDescription>
            {status === 'loading' && 'Please wait while we process your invitation'}
            {status === 'success' && `You've successfully joined ${tenantName || 'the tenant'}`}
            {status === 'error' && message}
            {status === 'needs-auth' && message}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'success' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                You now have access to the tenant's resources and can start collaborating with your team.
              </p>
              <Button onClick={handleContinue} className="w-full">
                Continue to Fortress
              </Button>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-4">
              <p className="text-center text-sm text-muted-foreground">
                {isEmailMismatch 
                  ? 'Please sign out and sign in with the correct email address, or request a new invitation.'
                  : 'The invitation may have expired or already been used.'}
              </p>
              {isEmailMismatch ? (
                <Button onClick={handleSignOutAndRetry} className="w-full">
                  Sign Out & Try Again
                </Button>
              ) : (
                <Button variant="outline" onClick={() => navigate('/')} className="w-full">
                  Go to Home
                </Button>
              )}
            </div>
          )}

          {status === 'needs-auth' && (
            <div className="space-y-4">
              {inviteEmail && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg text-center">
                  <p className="text-xs text-muted-foreground mb-1">Invitation sent to:</p>
                  <p className="font-medium text-sm">{inviteEmail}</p>
                </div>
              )}
              <p className="text-center text-sm text-muted-foreground">
                {inviteEmail 
                  ? `Please sign up or sign in with the email address above to accept this invitation.`
                  : 'You need to sign in or create an account to accept this invitation.'}
              </p>
              <Button onClick={handleGoToAuth} className="w-full">
                Sign Up / Sign In
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
