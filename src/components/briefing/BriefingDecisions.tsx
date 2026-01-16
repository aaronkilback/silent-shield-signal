import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Loader2, Plus, CheckCircle, XCircle, Clock, Gavel
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

interface BriefingDecisionsProps {
  briefingId: string;
}

interface Decision {
  id: string;
  briefing_id: string;
  decision_text: string;
  rationale: string | null;
  decision_maker_user_id: string | null;
  category: string;
  priority: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-green-500/10 text-green-500',
  medium: 'bg-yellow-500/10 text-yellow-500',
  high: 'bg-orange-500/10 text-orange-500',
  critical: 'bg-red-500/10 text-red-500'
};

const STATUS_COLORS: Record<string, string> = {
  proposed: 'bg-blue-500/10 text-blue-500',
  approved: 'bg-green-500/10 text-green-500',
  rejected: 'bg-red-500/10 text-red-500',
  implemented: 'bg-purple-500/10 text-purple-500'
};

export function BriefingDecisions({ briefingId }: BriefingDecisionsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAddDecision, setShowAddDecision] = useState(false);
  const [newDecision, setNewDecision] = useState({
    decision_text: '',
    rationale: '',
    category: 'general',
    priority: 'medium'
  });

  // Fetch decisions
  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['briefing-decisions', briefingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('briefing_decisions')
        .select('*')
        .eq('briefing_id', briefingId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Decision[];
    },
    enabled: !!briefingId
  });

  // Add decision
  const addDecision = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('briefing_decisions')
        .insert({
          briefing_id: briefingId,
          decision_text: newDecision.decision_text,
          rationale: newDecision.rationale || null,
          category: newDecision.category,
          priority: newDecision.priority,
          decision_maker_user_id: user?.id
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-decisions', briefingId] });
      setShowAddDecision(false);
      setNewDecision({ decision_text: '', rationale: '', category: 'general', priority: 'medium' });
      toast.success("Decision recorded");
    },
    onError: () => toast.error("Failed to record decision")
  });

  // Update decision status
  const updateStatus = useMutation({
    mutationFn: async ({ decisionId, status }: { decisionId: string; status: string }) => {
      const updates: any = { status };
      if (status === 'approved') {
        updates.approved_by = user?.id;
        updates.approved_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from('briefing_decisions')
        .update(updates)
        .eq('id', decisionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-decisions', briefingId] });
      toast.success("Decision updated");
    }
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Gavel className="w-4 h-4" />
            Decision Log
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {decisions.filter(d => d.status === 'approved').length} approved, {decisions.filter(d => d.status === 'proposed').length} pending
          </p>
        </div>
        <Dialog open={showAddDecision} onOpenChange={setShowAddDecision}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="w-4 h-4 mr-1" />
              Record Decision
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Decision</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Decision</label>
                <Textarea
                  value={newDecision.decision_text}
                  onChange={(e) => setNewDecision({ ...newDecision, decision_text: e.target.value })}
                  placeholder="What was decided?"
                  rows={3}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Rationale (optional)</label>
                <Textarea
                  value={newDecision.rationale}
                  onChange={(e) => setNewDecision({ ...newDecision, rationale: e.target.value })}
                  placeholder="Why was this decision made?"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Category</label>
                  <Select
                    value={newDecision.category}
                    onValueChange={(v) => setNewDecision({ ...newDecision, category: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General</SelectItem>
                      <SelectItem value="tactical">Tactical</SelectItem>
                      <SelectItem value="resource">Resource</SelectItem>
                      <SelectItem value="escalation">Escalation</SelectItem>
                      <SelectItem value="policy">Policy</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Priority</label>
                  <Select
                    value={newDecision.priority}
                    onValueChange={(v) => setNewDecision({ ...newDecision, priority: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAddDecision(false)}>Cancel</Button>
              <Button 
                onClick={() => addDecision.mutate()}
                disabled={!newDecision.decision_text || addDecision.isPending}
              >
                {addDecision.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Record
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : decisions.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Gavel className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No decisions recorded yet</p>
            <p className="text-xs">Formal decisions will be logged here for accountability</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {decisions.map((decision) => (
                <div 
                  key={decision.id}
                  className="p-4 rounded-lg border"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Badge className={PRIORITY_COLORS[decision.priority]}>
                        {decision.priority}
                      </Badge>
                      <Badge variant="outline">{decision.category}</Badge>
                    </div>
                    <Badge className={STATUS_COLORS[decision.status]}>
                      {decision.status}
                    </Badge>
                  </div>
                  
                  <p className="font-medium">{decision.decision_text}</p>
                  
                  {decision.rationale && (
                    <p className="text-sm text-muted-foreground mt-2">
                      <span className="font-medium">Rationale:</span> {decision.rationale}
                    </p>
                  )}
                  
                  <div className="flex items-center justify-between mt-3 pt-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(decision.created_at), 'MMM d, yyyy HH:mm')}
                    </span>
                    
                    {decision.status === 'proposed' && (
                      <div className="flex items-center gap-1">
                        <Button 
                          size="sm" 
                          variant="ghost"
                          className="h-7 text-green-500"
                          onClick={() => updateStatus.mutate({ decisionId: decision.id, status: 'approved' })}
                        >
                          <CheckCircle className="w-3 h-3 mr-1" />
                          Approve
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          className="h-7 text-red-500"
                          onClick={() => updateStatus.mutate({ decisionId: decision.id, status: 'rejected' })}
                        >
                          <XCircle className="w-3 h-3 mr-1" />
                          Reject
                        </Button>
                      </div>
                    )}
                    
                    {decision.status === 'approved' && (
                      <Button 
                        size="sm" 
                        variant="ghost"
                        className="h-7"
                        onClick={() => updateStatus.mutate({ decisionId: decision.id, status: 'implemented' })}
                      >
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Mark Implemented
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
