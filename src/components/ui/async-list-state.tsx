/**
 * AsyncListState — the error-first contract for any list/queue/inbox surface.
 *
 * WO-QUEUE-VIEW-PERMISSION / Absence-Is-Not-A-Value in the UI: a FAILED read must
 * never render as a confirmed empty ("inbox zero", "all clear", "all systems nominal").
 * This primitive evaluates states in a fixed order — loading -> error -> empty -> data —
 * so an error can NEVER fall through to the empty/success state. The error branch uses
 * destructive styling and carries NO success language or iconography.
 *
 * Every list surface renders through this. A new list component that does not use it is
 * the eighth false-zero waiting to be written (follow-on: a lint rule, WO-EMPTY-STATE-LINT).
 */
import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

// Operator-ratified wording: says it could not load, and that this is NOT a statement
// about whether anything is there. Kept to two sentences — a report, not an apology.
export const ASYNC_LOAD_ERROR_COPY =
  "This data could not be loaded. That is not the same as nothing being here — we could not read the list. Retry, and if it persists, contact support.";

interface AsyncListStateProps {
  /** true while the read is in flight */
  loading: boolean;
  /** truthy when the read FAILED — takes precedence over empty */
  error: unknown;
  /** only consulted when NOT loading and NOT error */
  isEmpty: boolean;
  /** the component's own genuine-empty UI (success language allowed HERE only) */
  emptyState: ReactNode;
  /** the populated list */
  children: ReactNode;
  /** optional custom loading UI */
  loadingState?: ReactNode;
}

export function AsyncListState({ loading, error, isEmpty, emptyState, children, loadingState }: AsyncListStateProps) {
  if (loading) {
    return <>{loadingState ?? <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>}</>;
  }
  if (error) {
    return (
      <Card className="border-destructive/50" data-testid="async-list-error">
        <CardContent className="py-10 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive/70" />
          <p className="text-sm text-destructive">{ASYNC_LOAD_ERROR_COPY}</p>
        </CardContent>
      </Card>
    );
  }
  if (isEmpty) {
    return <>{emptyState}</>;
  }
  return <>{children}</>;
}
