/**
 * Agent Actions page
 *
 * Analyst review hub for agent-proposed actions awaiting approval. Right
 * now this page is just the queue; future revisions can add tabs for
 * "Recently executed" and "Rejected" history.
 */

import { AgentActionApprovalQueue } from "@/components/agents/AgentActionApprovalQueue";

export default function AgentActions() {
  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Action Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-proposed actions awaiting your approval. Auto-tier actions (e.g.
          filing follow-ups, scheduling rescans) execute immediately and don't
          appear here. Propose-tier actions (severity corrections, oncall pages)
          require your call.
        </p>
      </div>
      <AgentActionApprovalQueue />
    </div>
  );
}
