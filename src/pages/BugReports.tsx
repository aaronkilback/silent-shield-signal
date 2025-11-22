import { Header } from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2, Bug, Filter } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

const BugReports = () => {
  const { user, loading } = useAuth();
  const { isAdmin, isAnalyst, isLoading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const queryClient = useQueryClient();

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
          profiles:user_id (name)
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

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Bug className="w-8 h-8" />
              Bug Reports
            </h1>
            <p className="text-muted-foreground mt-2">
              {canManage ? "View and manage all bug reports" : "Track your submitted bug reports"}
            </p>
          </div>
        </div>

        <div className="flex gap-4 items-center">
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
                        Reported by {report.profiles?.name || "Unknown"} •{" "}
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
                  
                  {report.screenshots && report.screenshots.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium mb-2">Screenshots:</p>
                      <div className="flex gap-2 flex-wrap">
                        {report.screenshots.map((screenshot, idx) => (
                          <a 
                            key={idx}
                            href={screenshot}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block"
                          >
                            <img 
                              src={screenshot} 
                              alt={`Screenshot ${idx + 1}`}
                              className="w-32 h-32 object-cover rounded border hover:opacity-80 transition-opacity cursor-pointer"
                            />
                          </a>
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
      </main>
    </div>
  );
};

export default BugReports;
