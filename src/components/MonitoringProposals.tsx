import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, CheckCircle, XCircle, Clock, Brain, Plus, Minus, Building2 } from "lucide-react";

interface MonitoringProposal {
  id: string;
  client_id: string;
  proposal_type: string;
  proposed_value: string;
  proposed_by_agent: string;
  reasoning: string;
  confidence: number;
  source_evidence: any;
  status: string;
  reviewed_at: string | null;
  applied_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface Props {
  userId: string;
}

const typeConfig: Record<string, { icon: typeof Plus; label: string; color: string }> = {
  add_keyword: { icon: Plus, label: 'Add Keyword', color: 'text-green-500' },
  remove_keyword: { icon: Minus, label: 'Remove Keyword', color: 'text-red-500' },
  add_entity: { icon: Building2, label: 'Add Entity', color: 'text-blue-500' },
  add_source: { icon: Plus, label: 'Add Source', color: 'text-purple-500' },
  update_source: { icon: Brain, label: 'Update Source', color: 'text-amber-500' },
};

export function MonitoringProposals({ userId }: Props) {
  const [proposals, setProposals] = useState<MonitoringProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchProposals();

    // Realtime subscription
    const channel = supabase
      .channel('monitoring-proposals')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'monitoring_proposals',
      }, () => fetchProposals())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchProposals = async () => {
    try {
      const { data, error } = await supabase
        .from('monitoring_proposals')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setProposals((data as MonitoringProposal[]) || []);

      // Fetch client names
      const clientIds = [...new Set((data || []).map(p => p.client_id).filter(Boolean))];
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, name')
          .in('id', clientIds);
        
        const names: Record<string, string> = {};
        (clients || []).forEach(c => { names[c.id] = c.name; });
        setClientNames(names);
      }
    } catch (error) {
      console.error('Error fetching monitoring proposals:', error);
      toast.error('Failed to load monitoring proposals');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (proposalId: string, action: 'approve' | 'reject') => {
    setProcessingId(proposalId);
    try {
      const { data, error } = await supabase.functions.invoke('apply-monitoring-proposal', {
        body: { proposal_id: proposalId, action, user_id: userId }
      });

      if (error) throw error;

      toast.success(action === 'approve' 
        ? `Monitoring change applied to ${data?.client_name || 'client'}` 
        : 'Proposal rejected'
      );
      fetchProposals();
    } catch (error) {
      console.error(`Error ${action}ing proposal:`, error);
      toast.error(`Failed to ${action} proposal`);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const pending = proposals.filter(p => p.status === 'pending');
  const reviewed = proposals.filter(p => p.status !== 'pending');

  return (
    <div className="space-y-6">
      {pending.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Brain className="w-10 h-10 mx-auto mb-3 opacity-40" />
            No pending monitoring proposals
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pending.map((proposal) => {
            const config = typeConfig[proposal.proposal_type] || typeConfig.add_keyword;
            const Icon = config.icon;
            
            return (
              <Card key={proposal.id} className="border-primary/20">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Clock className="w-4 h-4 text-yellow-500" />
                        <Icon className={`w-4 h-4 ${config.color}`} />
                        <Badge variant="outline" className="font-mono text-xs">
                          {config.label}
                        </Badge>
                        <span className="font-bold text-lg">{proposal.proposed_value}</span>
                      </CardTitle>
                      <CardDescription>
                        Client: <span className="text-foreground font-medium">{clientNames[proposal.client_id] || 'Unknown'}</span>
                        {' · '}Proposed by <span className="font-mono text-xs">{proposal.proposed_by_agent}</span>
                        {' · '}{new Date(proposal.created_at).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleAction(proposal.id, 'approve')}
                        disabled={processingId === proposal.id}
                      >
                        {processingId === proposal.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Approve
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction(proposal.id, 'reject')}
                        disabled={processingId === proposal.id}
                      >
                        <XCircle className="w-4 h-4 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="bg-muted/50 p-3 rounded-lg">
                      <h4 className="font-semibold text-sm mb-1">Agent Reasoning</h4>
                      <p className="text-sm text-muted-foreground">{proposal.reasoning}</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Confidence: <span className="font-mono text-foreground">{(proposal.confidence * 100).toFixed(0)}%</span></span>
                      {proposal.expires_at && (
                        <span>Expires: {new Date(proposal.expires_at).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {reviewed.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 text-muted-foreground">Previously Reviewed</h3>
          <div className="space-y-2">
            {reviewed.slice(0, 10).map((proposal) => {
              const config = typeConfig[proposal.proposal_type] || typeConfig.add_keyword;
              return (
                <Card key={proposal.id} className="opacity-60">
                  <CardContent className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      {proposal.status === 'applied' ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500" />
                      )}
                      <Badge variant="outline" className="text-xs">{config.label}</Badge>
                      <span className="font-medium">{proposal.proposed_value}</span>
                      <span className="text-muted-foreground">· {clientNames[proposal.client_id] || 'Unknown'}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {proposal.reviewed_at ? new Date(proposal.reviewed_at).toLocaleDateString() : ''}
                    </span>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
