import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * #148 — No-forever-spinner global guard.
 *
 * Replaces the bare `<Loader2 ... />` full-screen loaders. After
 * `timeoutMs` (default 9s) the component renders a recoverable reset
 * surface: a "Loading is taking longer than expected" message plus
 * actions the operator can use to recover without DevTools (clear app
 * state + reload, or reload-only).
 *
 * Background: the 2026-05-21 prod hang showed an indefinite spinner
 * that was completely unrecoverable without DevTools/curl knowledge.
 * Any future state-deadlock that produces a spinner now self-surfaces
 * a recovery path.
 */
export interface RecoverableLoaderProps {
  /** ms before the "still loading" reset surface appears. Default 9000. */
  timeoutMs?: number;
  /** ms before a more strident timeout banner appears. Default 20000. */
  hardTimeoutMs?: number;
  /** Label shown beneath the spinner during normal (pre-timeout) state. */
  label?: string;
}

export function RecoverableLoader({
  timeoutMs = 9_000,
  hardTimeoutMs = 20_000,
  label,
}: RecoverableLoaderProps) {
  const [stage, setStage] = useState<"loading" | "soft" | "hard">("loading");

  useEffect(() => {
    const softT = window.setTimeout(() => setStage("soft"), timeoutMs);
    const hardT = window.setTimeout(() => setStage("hard"), hardTimeoutMs);
    return () => {
      window.clearTimeout(softT);
      window.clearTimeout(hardT);
    };
  }, [timeoutMs, hardTimeoutMs]);

  const clearAppStateAndReload = () => {
    try {
      // Surgical clear: tenant/client selection state. Preserve auth
      // session — clearing it would force re-login which is more
      // disruptive than necessary for a state-deadlock recovery.
      localStorage.removeItem("fortress_current_tenant_id");
      localStorage.removeItem("fortress_all_tenants_view");
      sessionStorage.clear();
    } catch {
      /* ignore storage access errors (Safari private mode etc) */
    }
    window.location.reload();
  };

  if (stage === "loading") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        {label && <p className="text-sm text-muted-foreground">{label}</p>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-6 text-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary opacity-50" />
      <div className="max-w-md space-y-2">
        <p className="text-base font-medium text-foreground">
          {stage === "hard"
            ? "Loading is stuck."
            : "Loading is taking longer than expected."}
        </p>
        <p className="text-sm text-muted-foreground">
          {stage === "hard"
            ? "The app has been waiting more than 20 seconds. This usually means a stale client/tenant selection or a transient deploy issue."
            : "If this persists, you can reset local state without signing out."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
        <Button
          variant={stage === "hard" ? "default" : "outline"}
          size="sm"
          onClick={clearAppStateAndReload}
        >
          Clear app state &amp; reload
        </Button>
      </div>
      {stage === "hard" && (
        <p className="text-xs text-muted-foreground">
          Still stuck? Open DevTools console and check for errors, or contact
          support.
        </p>
      )}
    </div>
  );
}
