import { useState, useEffect, useCallback } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Clock, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const INACTIVITY_WARNING_MS = 25 * 60 * 1000; // 25 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_DURATION_MS = 5 * 60 * 1000; // 5 minutes warning

export function SessionTimeoutWarning() {
  const { user, signOut } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(WARNING_DURATION_MS);
  const [lastActivity, setLastActivity] = useState(Date.now());

  const resetTimer = useCallback(() => {
    setLastActivity(Date.now());
    setShowWarning(false);
    setTimeRemaining(WARNING_DURATION_MS);
  }, []);

  const handleStayLoggedIn = async () => {
    resetTimer();
    // Refresh the session
    const { error } = await supabase.auth.refreshSession();
    if (error) {
      console.error("Failed to refresh session:", error);
      toast.error("Failed to extend session");
    } else {
      toast.success("Session extended");
    }
  };

  const handleLogout = async () => {
    setShowWarning(false);
    await signOut();
  };

  // Track user activity
  useEffect(() => {
    if (!user) return;

    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    
    const handleActivity = () => {
      if (!showWarning) {
        setLastActivity(Date.now());
      }
    };

    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [user, showWarning]);

  // Check for inactivity
  useEffect(() => {
    if (!user) return;

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastActivity;
      
      if (elapsed >= SESSION_TIMEOUT_MS) {
        // Session expired - force logout
        setShowWarning(false);
        signOut();
        toast.error("Session expired due to inactivity");
      } else if (elapsed >= INACTIVITY_WARNING_MS && !showWarning) {
        // Show warning
        setShowWarning(true);
        setTimeRemaining(SESSION_TIMEOUT_MS - elapsed);
      }
    }, 1000);

    return () => clearInterval(checkInterval);
  }, [user, lastActivity, showWarning, signOut]);

  // Countdown while warning is shown
  useEffect(() => {
    if (!showWarning) return;

    const countdownInterval = setInterval(() => {
      setTimeRemaining(prev => {
        const newValue = prev - 1000;
        if (newValue <= 0) {
          signOut();
          toast.error("Session expired due to inactivity");
          return 0;
        }
        return newValue;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [showWarning, signOut]);

  if (!user) return null;

  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);
  const progress = (timeRemaining / WARNING_DURATION_MS) * 100;

  return (
    <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-500" />
            Session Timeout Warning
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                You've been inactive for a while. For security, your session will expire soon.
              </p>
              <div className="text-center">
                <div className="text-3xl font-bold text-foreground">
                  {minutes}:{seconds.toString().padStart(2, '0')}
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  until automatic logout
                </p>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleLogout} className="gap-2">
            <LogOut className="w-4 h-4" />
            Log Out Now
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleStayLoggedIn}>
            Stay Logged In
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
