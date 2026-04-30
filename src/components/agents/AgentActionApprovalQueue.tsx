/**
 * AgentActionApprovalQueue
 *
 * Lists every agent-proposed action currently in awaiting_approval status.
 * Analyst clicks Approve or Reject, optionally supplies a rejection reason.
 * Calls execute-approved-action edge function which runs the per-type
 * executor and marks the row executed/failed.
 *
 * Backed by the agent_actions_awaiting_approval view created in migration
 * 20260430000010. The view joins to signals so the queue shows context.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, CheckCircle, X, Brain, FileText, BellRing, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

interface PendingAction {
  id: string;
  agent_call_sign: string;
  action_type: string;
  action_payload: Record<string, any>;
  rationale: string | null;
  context_signal_id: string | null;
  signal_title: string | null;
  created_at: string;
}

const ACTION_LABELS: Record<string, { label: string; icon: typeof Brain }> = {
  propose_severity_correction: { label: 'Severity correction', icon: AlertCircle },
  notify_oncall_via_slack: { label: 'Page oncall via Slack', icon: BellRing },
};

export function AgentActionApprovalQueue() {
  const { user } = useAuth();
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('agent_actions_awaiting_approval')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      toast.error(`Failed to load queue: ${error.message}`);
      setActions([]);
    } else {
      setActions((data as PendingAction[]) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleDecision = async (actionId: string, decision: 'approve' | 'reject') => {
    if (!user?.id) {
      toast.error('Must be signed in to approve actions');
      return;
    }
    setActing(actionId);
    const { data, error } = await supabase.functions.invoke('execute-approved-action', {
      body: {
        action_id: actionId,
        approver_user_id: user.id,
        decision,
        rejection_reason: decision === 'reject' ? rejectReason : undefined,
      },
    });
    setActing(null);
    if (error) {
      toast.error(`Failed: ${error.message}`);
      return;
    }
    const result = data as any;
    if (result?.status === 'rejected') {
      toast.success('Action rejected');
    } else if (result?.status === 'executed') {
      toast.success('Action approved and executed');
    } else if (result?.status === 'failed') {
      toast.error(`Approved but execution failed: ${result?.error ?? 'unknown'}`);
    } else {
      toast.message(`Action ${result?.status ?? 'processed'}`);
    }
    setRejectingId(null);
    setRejectReason("");
    await refresh();
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading approval queue…</div>;
  }
  if (actions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500/40" />
          <p className="text-sm text-muted-foreground">Inbox zero. No agent actions awaiting your approval.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{actions.length} action{actions.length === 1 ? '' : 's'} awaiting review</p>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="w-3 h-3 mr-1" /> Refresh
        </Button>
      </div>

      {actions.map((a) => {
        const meta = ACTION_LABELS[a.action_type] ?? { label: a.action_type, icon: Brain };
        const Icon = meta.icon;
        const isActing = acting === a.id;
        const isRejecting = rejectingId === a.id;
        return (
          <Card key={a.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-amber-400 mt-0.5" />
                  <div>
                    <CardTitle className="text-sm">{meta.label}</CardTitle>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>by</span>
                      <Badge variant="outline" className="text-[10px]">{a.agent_call_sign}</Badge>
                      <span>· {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* Rationale */}
              {a.rationale && (
                <div className="text-sm bg-muted/40 rounded-md p-3">
                  <strong className="text-xs uppercase tracking-wide text-muted-foreground">Rationale</strong>
                  <p className="mt-1 text-foreground/90">{a.rationale}</p>
                </div>
              )}

              {/* Action-specific payload preview */}
              {a.action_type === 'propose_severity_correction' && (
                <div className="text-sm border rounded-md p-3 space-y-1">
                  <div>
                    <strong className="text-xs uppercase tracking-wide text-muted-foreground">Proposed severity</strong>
                    <Badge className="ml-2" variant={
                      a.action_payload?.proposed_severity === 'critical' ? 'destructive' :
                      a.action_payload?.proposed_severity === 'high' ? 'destructive' :
                      a.action_payload?.proposed_severity === 'medium' ? 'default' : 'secondary'
                    }>
                      {a.action_payload?.proposed_severity}
                    </Badge>
                  </div>
                  {a.action_payload?.evidence && (
                    <div>
                      <strong className="text-xs uppercase tracking-wide text-muted-foreground">Evidence</strong>
                      <p className="text-foreground/90 text-sm">{a.action_payload.evidence}</p>
                    </div>
                  )}
                </div>
              )}
              {a.action_type === 'notify_oncall_via_slack' && (
                <div className="text-sm border rounded-md p-3 space-y-1">
                  <div className="flex items-center gap-2">
                    <strong className="text-xs uppercase tracking-wide text-muted-foreground">Urgency</strong>
                    <Badge variant={a.action_payload?.urgency === 'high' ? 'destructive' : 'secondary'}>
                      {a.action_payload?.urgency}
                    </Badge>
                  </div>
                  <div>
                    <strong className="text-xs uppercase tracking-wide text-muted-foreground">Proposed message</strong>
                    <p className="text-foreground/90 text-sm whitespace-pre-wrap">{a.action_payload?.message}</p>
                  </div>
                </div>
              )}

              {/* Signal context link */}
              {a.context_signal_id && a.signal_title && (
                <div className="text-xs text-muted-foreground">
                  <FileText className="w-3 h-3 inline mr-1" />
                  Re: <span className="text-foreground/80">{a.signal_title.substring(0, 100)}</span>
                </div>
              )}

              {/* Reject reason input (only when rejecting) */}
              {isRejecting && (
                <div>
                  <label className="text-xs uppercase tracking-wide text-muted-foreground block mb-1">
                    Why are you rejecting this? (optional but recommended)
                  </label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="e.g. severity is correct as-is, signal is historical, agent overconfident…"
                    rows={2}
                    className="text-sm"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                {!isRejecting ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isActing}
                      onClick={() => { setRejectingId(a.id); setRejectReason(""); }}
                    >
                      <X className="w-3 h-3 mr-1" /> Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={isActing}
                      onClick={() => handleDecision(a.id, 'approve')}
                    >
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {isActing ? 'Approving…' : 'Approve & execute'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => { setRejectingId(null); setRejectReason(""); }}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={isActing}
                      onClick={() => handleDecision(a.id, 'reject')}
                    >
                      {isActing ? 'Rejecting…' : 'Confirm reject'}
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
