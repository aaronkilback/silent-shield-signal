import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield, Mail, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function InviteRequired() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Invitation Required</CardTitle>
          <CardDescription>
            You need an invitation to access Fortress
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg bg-muted p-4 text-center">
            <Mail className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Your account <span className="font-medium text-foreground">{user?.email}</span> is not currently a member of any tenant.
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-medium">How to get access:</h4>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>Ask your organization's administrator to send you an invite</li>
              <li>Check your email for an existing invitation link</li>
              <li>If you received an invite, click the link in the email</li>
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="w-full"
            >
              Check Again
            </Button>
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
