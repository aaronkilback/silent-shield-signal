import { Header } from "@/components/Header";
import { useIsEmbedded } from "@/hooks/useIsEmbedded";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignalMergeProposals } from "@/components/SignalMergeProposals";
import { MonitoringProposals } from "@/components/MonitoringProposals";

interface RuleProposal {
  key: string;
  value: {
    status: string;
    proposals: Array<{
      rule_name: string;
      description: string;
      conditions: any;
      actions: any;
      rationale: string;
      estimated_impact: string;
    }>;
    confidence_threshold: number;
    analysis_context: string;
  };
  updated_at: string;
}

const RuleApprovals = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<RuleProposal[]>([]);
  const [loadingProposals, setLoadingProposals] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const isEmbedded = useIsEmbedded();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (user) {
      fetchProposals();
    }
  }, [user]);

  const fetchProposals = async () => {
    try {
      const { data, error } = await supabase
        .from("intelligence_config")
        .select("*")
        .like("key", "signal_categorization_rules_proposal_%")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setProposals((data as any[]) || []);
    } catch (error) {
      console.error("Error fetching proposals:", error);
      toast.error("Failed to load rule proposals");
    } finally {
      setLoadingProposals(false);
    }
  };

  const handleApprove = async (proposalKey: string) => {
    setProcessingId(proposalKey);
    try {
      const proposal = proposals.find(p => p.key === proposalKey);
      if (!proposal) return;

      const updatedValue = {
        ...proposal.value,
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: user?.id
      };

      const { error } = await supabase
        .from("intelligence_config")
        .update({ value: updatedValue })
        .eq("key", proposalKey);

      if (error) throw error;

      toast.success("Rule proposal approved successfully!");
      fetchProposals();
    } catch (error) {
      console.error("Error approving proposal:", error);
      toast.error("Failed to approve proposal");
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (proposalKey: string) => {
    setProcessingId(proposalKey);
    try {
      const proposal = proposals.find(p => p.key === proposalKey);
      if (!proposal) return;

      const updatedValue = {
        ...proposal.value,
        status: "rejected",
        rejected_at: new Date().toISOString(),
        rejected_by: user?.id
      };

      const { error } = await supabase
        .from("intelligence_config")
        .update({ value: updatedValue })
        .eq("key", proposalKey);

      if (error) throw error;

      toast.success("Rule proposal rejected");
      fetchProposals();
    } catch (error) {
      console.error("Error rejecting proposal:", error);
      toast.error("Failed to reject proposal");
    } finally {
      setProcessingId(null);
    }
  };

  if (loading || loadingProposals) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const pendingProposals = proposals.filter(p => p.value.status === "pending_review");
  const reviewedProposals = proposals.filter(p => p.value.status !== "pending_review");

  const rulesContent = (
    <>
      <div>
        <h1 className="text-3xl font-bold">Approvals</h1>
        <p className="text-muted-foreground mt-2">
          Review and approve AI-proposed actions
        </p>
      </div>

      <Tabs defaultValue="rules" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="rules">Categorization Rules</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring Updates</TabsTrigger>
            <TabsTrigger value="merges">Signal Merges</TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="space-y-6">

        {pendingProposals.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No pending rule proposals
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {pendingProposals.map((proposal) => (
            <Card key={proposal.key} className="border-primary/20">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="w-5 h-5 text-yellow-500" />
                      Pending Review
                    </CardTitle>
                    <CardDescription className="mt-2">
                      Submitted: {new Date(proposal.updated_at).toLocaleString()}
                    </CardDescription>
                    <CardDescription className="mt-1">
                      Confidence: {(proposal.value.confidence_threshold * 100).toFixed(0)}%
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="default"
                      onClick={() => handleApprove(proposal.key)}
                      disabled={processingId === proposal.key}
                    >
                      {processingId === proposal.key ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Approve
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleReject(proposal.key)}
                      disabled={processingId === proposal.key}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {proposal.value.analysis_context && (
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">Context</h4>
                    <p className="text-sm">{proposal.value.analysis_context}</p>
                  </div>
                )}
                
                {proposal.value.proposals.map((rule, idx) => (
                  <div key={idx} className="border rounded-lg p-4 space-y-3">
                    <div>
                      <h3 className="font-semibold text-lg">{rule.rule_name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
                    </div>

                    <div>
                      <h4 className="font-medium text-sm mb-2">When to trigger:</h4>
                      <div className="bg-muted/30 p-3 rounded text-sm space-y-1">
                        {Object.entries(rule.conditions).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium">{key}:</span>{" "}
                            <span className="text-muted-foreground">
                              {Array.isArray(value) ? value.join(", ") : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium text-sm mb-2">Actions to take:</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(rule.actions).map(([action, value]) => (
                          <Badge key={action} variant="secondary">
                            {action}: {String(value)}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="font-medium">Rationale:</span>
                        <p className="text-muted-foreground mt-1">{rule.rationale}</p>
                      </div>
                      <div>
                        <span className="font-medium">Expected Impact:</span>
                        <p className="text-muted-foreground mt-1">{rule.estimated_impact}</p>
                      </div>
                    </div>
                  </div>
                ))}
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
                  <Card key={proposal.key} className="opacity-70">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          {proposal.value.status === "approved" ? (
                            <>
                              <CheckCircle className="w-5 h-5 text-green-500" />
                              Approved
                            </>
                          ) : (
                            <>
                              <XCircle className="w-5 h-5 text-red-500" />
                              Rejected
                            </>
                          )}
                        </CardTitle>
                        <CardDescription>
                          {new Date(proposal.updated_at).toLocaleString()}
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        {proposal.value.proposals.length} rule(s) in this proposal
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}
          </TabsContent>

          <TabsContent value="monitoring" className="space-y-6">
            {user && <MonitoringProposals userId={user.id} />}
          </TabsContent>

          <TabsContent value="merges" className="space-y-6">
            {user && <SignalMergeProposals userId={user.id} />}
          </TabsContent>
        </Tabs>
    </>
  );

  if (isEmbedded) {
    return <div className="space-y-6">{rulesContent}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        {rulesContent}
      </main>
    </div>
  );
};
