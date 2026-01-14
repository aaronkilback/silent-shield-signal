import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

interface ApiUsageLog {
  id: string;
  api_key_id: string | null;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number | null;
  request_params: any;
  ip_address: string | null;
  user_agent: string | null;
  error_message: string | null;
  created_at: string;
}

export function ApiUsageLogs() {
  const [filter, setFilter] = useState<"all" | "success" | "error">("all");
  const [limit, setLimit] = useState(50);

  const { data: logs, isLoading } = useQuery({
    queryKey: ["api-usage-logs", filter, limit],
    queryFn: async () => {
      let query = supabase
        .from("api_usage_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (filter === "success") {
        query = query.gte("status_code", 200).lt("status_code", 300);
      } else if (filter === "error") {
        query = query.gte("status_code", 400);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ApiUsageLog[];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["api-usage-stats"],
    queryFn: async () => {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from("api_usage_logs")
        .select("status_code, response_time_ms")
        .gte("created_at", oneDayAgo.toISOString());

      if (error) throw error;

      const total = data.length;
      const successful = data.filter(l => l.status_code >= 200 && l.status_code < 300).length;
      const errors = data.filter(l => l.status_code >= 400).length;
      const avgResponseTime = data.length > 0
        ? Math.round(data.reduce((sum, l) => sum + (l.response_time_ms || 0), 0) / data.length)
        : 0;

      return { total, successful, errors, avgResponseTime };
    },
  });

  const getStatusBadge = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) {
      return <Badge className="bg-green-600">{statusCode}</Badge>;
    } else if (statusCode >= 400 && statusCode < 500) {
      return <Badge variant="destructive">{statusCode}</Badge>;
    } else if (statusCode >= 500) {
      return <Badge className="bg-red-800">{statusCode}</Badge>;
    }
    return <Badge variant="secondary">{statusCode}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              <div>
                <div className="text-2xl font-bold">{stats?.total || 0}</div>
                <div className="text-sm text-muted-foreground">Requests (24h)</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <div>
                <div className="text-2xl font-bold">{stats?.successful || 0}</div>
                <div className="text-sm text-muted-foreground">Successful</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <XCircle className="h-8 w-8 text-destructive" />
              <div>
                <div className="text-2xl font-bold">{stats?.errors || 0}</div>
                <div className="text-sm text-muted-foreground">Errors</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-500" />
              <div>
                <div className="text-2xl font-bold">{stats?.avgResponseTime || 0}ms</div>
                <div className="text-sm text-muted-foreground">Avg Response</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>API Usage Logs</CardTitle>
              <CardDescription>Recent API requests and responses</CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="error">Errors</SelectItem>
                </SelectContent>
              </Select>
              <Select value={limit.toString()} onValueChange={(v) => setLimit(parseInt(v))}>
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading logs...</div>
          ) : !logs?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No API requests logged yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Response Time</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="text-sm">
                      {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.method}</Badge>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {log.endpoint}
                      </code>
                    </TableCell>
                    <TableCell>{getStatusBadge(log.status_code)}</TableCell>
                    <TableCell>
                      {log.response_time_ms ? `${log.response_time_ms}ms` : "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.ip_address || "-"}
                    </TableCell>
                    <TableCell>
                      {log.error_message ? (
                        <span className="text-xs text-destructive truncate max-w-[200px] block">
                          {log.error_message}
                        </span>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
