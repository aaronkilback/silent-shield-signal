import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle, Clock, GitMerge } from "lucide-react";
import { Separator } from "@/components/ui/separator";

interface SignalMergeProposal {
  id: string;
  primary_signal_id: string;
  duplicate_signal_ids: string[];
  similarity_scores: number[];
  status: string;
  proposed_at: string;
  proposed_by: string;
  merge_rationale: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

interface SignalMergeProposalsProps {
  userId: string;
}

export const SignalMergeProposals = ({ userId }: SignalMergeProposalsProps) => {
  const [proposals, setProposals] = useState<SignalMergeProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    fetchProposals();
  }, []);

  const fetchProposals = async () => {
    try {
      const { data, error } = await supabase
        .from("signal_merge_proposals")
        .select("*")
        .order("proposed_at", { ascending: false });

      if (error) throw error;
      setProposals(data || []);
    } catch (error) {
      console.error("Error fetching merge proposals:", error);
      toast.error("Failed to load signal merge proposals");
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (proposalId: string) => {
    setProcessingId(proposalId);
    try {
      const proposal = proposals.find(p => p.id === proposalId);
      if (!proposal) return;

      // Call the execute-signal-merge edge function
      const { data, error } = await supabase.functions.invoke("execute-signal-merge", {
        body: {
          primary_signal_id: proposal.primary_signal_id,
          duplicate_signal_ids: proposal.duplicate_signal_ids
        }
      });

      if (error) throw error;

      // Update proposal status
      const { error: updateError } = await supabase
        .from("signal_merge_proposals")
        .update({
          status: "approved",
          reviewed_at: new Date().toISOString(),
          reviewed_by: userId
        })
        .eq("id", proposalId);

      if (updateError) throw updateError;

      toast.success(`Successfully merged ${proposal.duplicate_signal_ids.length} duplicate signals`);
      fetchProposals();
    } catch (error) {
      console.error("Error approving merge:", error);
      toast.error("Failed to approve merge proposal");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (proposalId: string) => {
    setProcessingId(proposalId);
    try {
      const { error } = await supabase
        .from("signal_merge_proposals")
        .update({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          reviewed_by: userId
        })
        .eq("id", proposalId);

      if (error) throw error;

      toast.success("Merge proposal rejected");
      fetchProposals();
    } catch (error) {
      console.error("Error rejecting proposal:", error);
      toast.error("Failed to reject proposal");
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const pendingProposals = proposals.filter(p => p.status === "pending");
  const reviewedProposals = proposals.filter(p => p.status !== "pending");

  return (
    <div className="space-y-6">
      {pendingProposals.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No pending signal merge proposals
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {pendingProposals.map((proposal) => (
          <Card key={proposal.id} className="border-primary/20">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <GitMerge className="w-5 h-5 text-yellow-500" />
                    Signal Merge Proposal
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Proposed: {new Date(proposal.proposed_at).toLocaleString()}
                  </CardDescription>
                  <CardDescription className="mt-1">
                    By: {proposal.proposed_by}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    onClick={() => handleApprove(proposal.id)}
                    disabled={processingId === proposal.id}
                  >
                    {processingId === proposal.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Merge Signals
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleReject(proposal.id)}
                    disabled={processingId === proposal.id}
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Keep Separate
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">Merge Rationale</h4>
                <p className="text-sm">{proposal.merge_rationale}</p>
              </div>

              <div>
                <h4 className="font-semibold mb-2">Duplicate Signals ({proposal.duplicate_signal_ids.length})</h4>
                <div className="space-y-2">
                  {proposal.duplicate_signal_ids.map((signalId, idx) => (
                    <div key={signalId} className="flex items-center justify-between bg-muted/30 p-3 rounded">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">
                          Signal {idx + 1}
                        </Badge>
                        <code className="text-xs text-muted-foreground">{signalId.slice(0, 8)}...</code>
                      </div>
                      {proposal.similarity_scores[idx] && (
                        <Badge variant="outline">
                          {(proposal.similarity_scores[idx] * 100).toFixed(1)}% similar
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded">
                <p className="text-sm">
                  <span className="font-medium">Primary Signal:</span>{" "}
                  <code className="text-xs">{proposal.primary_signal_id.slice(0, 8)}...</code>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Duplicates will be merged into this signal
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {reviewedProposals.length > 0 && (
        <>
          <Separator className="my-8" />
          <div>
            <h2 className="text-2xl font-bold mb-4">Previously Reviewed</h2>
            <div className="space-y-4">
              {reviewedProposals.map((proposal) => (
                <Card key={proposal.id} className="opacity-70">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        {proposal.status === "approved" ? (
                          <>
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            Merged
                          </>
                        ) : (
                          <>
                            <XCircle className="w-5 h-5 text-red-500" />
                            Kept Separate
                          </>
                        )}
                      </CardTitle>
                      <CardDescription>
                        {proposal.reviewed_at && new Date(proposal.reviewed_at).toLocaleString()}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {proposal.duplicate_signal_ids.length} duplicate signal(s)
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
