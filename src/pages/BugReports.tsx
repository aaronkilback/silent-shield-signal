import { Header } from "@/components/Header";
import { useIsEmbedded } from "@/hooks/useIsEmbedded";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Bug, Filter, Activity, TestTube } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ErrorMonitoringDashboard, SystemTestRunner, BugScanVoiceAssistant } from "@/components/monitoring";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { getTestSummary } from "@/lib/testing/e2eTests";
import { useSystemTestRun } from "@/hooks/useSystemTestRun";

type FixProposal = {
  root_cause: string;
  fix_strategy: string;
  code_changes: Array<{
    file: string;
    change: string;
    example?: string;
  }>;
  affected_files?: string[];
  testing_steps?: string[];
  deployment_notes?: string[];
  generated_at?: string;
  ai_model?: string;
};

const BugReports = () => {
  const { user, loading } = useAuth();
  const { isAdmin, isAnalyst, isLoading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("reports");
  const queryClient = useQueryClient();
  const { results: testResults } = useSystemTestRun();
  const isEmbedded = useIsEmbedded();
  
  const testSummary = testResults ? getTestSummary(testResults) : null;

  useEffect(() => {
    if (!loading && !user) {
      navigate("/auth");
    }
  }, [user, loading, navigate]);

  const { data: bugReports, isLoading } = useQuery({
    queryKey: ["bug-reports", statusFilter, severityFilter],
    queryFn: async () => {
      let query = supabase
        .from("bug_reports")
        .select(`
          *,
          reporter:profiles!user_id (name),
          approver:profiles!approved_by (name)
        `);

      if (!isAdmin && !isAnalyst) {
        query = query.eq("user_id", user?.id);
      }

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      if (severityFilter !== "all") {
        query = query.eq("severity", severityFilter);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("bug_reports")
        .update({ 
          status,
          resolved_at: status === "resolved" || status === "closed" ? new Date().toISOString() : null
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bug-reports"] });
      toast.success("Status updated successfully");
    },
    onError: (error) => {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    },
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "destructive";
      case "high": return "destructive";
      case "medium": return "default";
      case "low": return "secondary";
      default: return "secondary";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open": return "destructive";
      case "in_progress": return "default";
      case "resolved": return "secondary";
      case "closed": return "secondary";
      case "duplicate": return "outline";
      default: return "secondary";
    }
  };

  if (loading || isLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const canManage = isAdmin || isAnalyst;

  const bugContent = (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bug className="w-8 h-8" />
            System Stability
          </h1>
          <p className="text-muted-foreground mt-2">
            Monitor errors, run tests, and track bug reports
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="reports" className="gap-2">
            <Bug className="h-4 w-4" /> Bug Reports
          </TabsTrigger>
            <TabsTrigger value="monitoring" className="gap-2">
              <Activity className="h-4 w-4" /> Error Monitoring
            </TabsTrigger>
            <TabsTrigger value="tests" className="gap-2">
              <TestTube className="h-4 w-4" /> System Tests
            </TabsTrigger>
          </TabsList>

          <TabsContent value="monitoring" className="mt-6">
            <ErrorMonitoringDashboard />
          </TabsContent>

          <TabsContent value="tests" className="mt-6">
            <SystemTestRunner />
          </TabsContent>

          <TabsContent value="reports" className="mt-6">
            <div className="flex gap-4 items-center mb-4">
          <Filter className="w-5 h-5 text-muted-foreground" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="duplicate">Duplicate</SelectItem>
            </SelectContent>
          </Select>

          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
            </div>

            <div className="space-y-4">
          {bugReports && bugReports.length > 0 ? (
            bugReports.map((report) => (
              <Card key={report.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={getSeverityColor(report.severity)}>
                          {report.severity}
                        </Badge>
                        <Badge variant={getStatusColor(report.status)}>
                          {report.status.replace("_", " ")}
                        </Badge>
                      </div>
                      <CardTitle>{report.title}</CardTitle>
                      <CardDescription className="mt-2">
                        Reported by {report.reporter?.name || "Unknown"} •{" "}
                        {formatDistanceToNow(new Date(report.created_at), { addSuffix: true })}
                      </CardDescription>
                    </div>
                    {canManage && (
                      <Select
                        value={report.status}
                        onValueChange={(status) =>
                          updateStatusMutation.mutate({ id: report.id, status })
                        }
                      >
                        <SelectTrigger className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                          <SelectItem value="duplicate">Duplicate</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap mb-4">{report.description}</p>
                  
                  {report.fix_proposal && report.fix_status && (() => {
                    const proposal = report.fix_proposal as FixProposal;
                    return (
                      <div className="mb-4 p-4 bg-muted/50 rounded-lg border">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-semibold">🤖 AI Fix Proposal</p>
                          <Badge variant={
                            report.fix_status === 'approved' ? 'default' :
                            report.fix_status === 'implemented' ? 'secondary' :
                            report.fix_status === 'rejected' ? 'destructive' :
                            'outline'
                          }>
                            {report.fix_status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <div className="text-sm space-y-2">
                          <p><span className="font-medium">Root Cause:</span> {proposal.root_cause}</p>
                          <p><span className="font-medium">Strategy:</span> {proposal.fix_strategy}</p>
                          {proposal.affected_files && proposal.affected_files.length > 0 && (
                            <p><span className="font-medium">Files:</span> {proposal.affected_files.join(', ')}</p>
                          )}
                          {canManage && report.fix_status === 'proposal_ready' && (
                            <div className="flex gap-2 mt-3">
                              <Button 
                                size="sm" 
                                onClick={async () => {
                                  const { error } = await supabase
                                    .from("bug_reports")
                                    .update({ 
                                      fix_status: 'approved',
                                      approved_by: user?.id,
                                      approved_at: new Date().toISOString()
                                    })
                                    .eq("id", report.id);
                                  
                                  if (error) {
                                    toast.error("Failed to approve fix");
                                  } else {
                                    queryClient.invalidateQueries({ queryKey: ["bug-reports"] });
                                    toast.success("Fix approved! Ask Lovable editor: 'Implement approved fix for bug " + report.id + "'");
                                  }
                                }}
                              >
                                Approve Fix
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={async () => {
                                  const { error } = await supabase
                                    .from("bug_reports")
                                    .update({ fix_status: 'rejected' })
                                    .eq("id", report.id);
                                  
                                  if (error) {
                                    toast.error("Failed to reject fix");
                                  } else {
                                    queryClient.invalidateQueries({ queryKey: ["bug-reports"] });
                                    toast.info("Fix proposal rejected");
                                  }
                                }}
                              >
                                Reject
                              </Button>
                            </div>
                          )}
                          {report.fix_status === 'approved' && report.approver && (
                            <p className="text-xs text-muted-foreground mt-2">
                              Approved by {report.approver.name} {report.approved_at && `• ${formatDistanceToNow(new Date(report.approved_at), { addSuffix: true })}`}
                            </p>
                          )}
                          {report.fix_status === 'implemented' && report.implemented_at && (
                            <p className="text-xs text-green-600 mt-2">
                              ✅ Implemented {formatDistanceToNow(new Date(report.implemented_at), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  
                  {report.screenshots && report.screenshots.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium mb-2">Screenshots:</p>
                      <div className="flex gap-2 flex-wrap">
                        {report.screenshots.map((screenshot, idx) => (
                          <ImageLightbox 
                            key={idx}
                            src={screenshot} 
                            alt={`Screenshot ${idx + 1}`}
                            className="w-32 h-32 object-contain rounded border bg-muted"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  
                  <div className="text-xs text-muted-foreground space-y-1">
                    {report.page_url && (
                      <p>
                        <span className="font-medium">Page:</span> {report.page_url}
                      </p>
                    )}
                    {report.browser_info && (
                      <p>
                        <span className="font-medium">Browser:</span>{" "}
                        {report.browser_info.split(" ").slice(-2).join(" ")}
                      </p>
                    )}
                    {report.resolved_at && (
                      <p>
                        <span className="font-medium">Resolved:</span>{" "}
                        {formatDistanceToNow(new Date(report.resolved_at), { addSuffix: true })}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              No bug reports found. Adjust your filters or submit a new report.
            </div>
          )}
            </div>
          </TabsContent>
        </Tabs>

        <BugScanVoiceAssistant 
          activeTab={activeTab}
          bugReportCount={bugReports?.length ?? 0}
          testResults={testSummary}
        />
    </>
  );

  if (isEmbedded) {
    return <div className="space-y-6">{bugContent}</div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        {bugContent}
      </main>
    </div>
  );
};

export default BugReports;
