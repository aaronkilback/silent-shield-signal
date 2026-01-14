import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { toast } from "sonner";
import { Plus, Trash2, Webhook, Play, Copy, Check, RefreshCw, ChevronDown } from "lucide-react";
import { format } from "date-fns";

interface WebhookConfig {
  id: string;
  name: string;
  description: string | null;
  url: string;
  secret: string | null;
  auth_type: string;
  trigger_events: string[];
  filter_conditions: any;
  output_format: string;
  is_active: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

const TRIGGER_EVENTS = [
  { value: "signal.critical", label: "New Critical Signal", description: "Fires when a critical severity signal is created" },
  { value: "signal.high", label: "New High Severity Signal", description: "Fires when a high severity signal is created" },
  { value: "signal.client_match", label: "Client Match", description: "Fires when a signal matches a client's keywords" },
  { value: "incident.created", label: "Incident Created", description: "Fires when a new incident is created" },
  { value: "incident.escalated", label: "Incident Escalated", description: "Fires when an incident priority is escalated" },
];

export function WebhooksManager() {
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    url: "",
    auth_type: "none",
    auth_token: "",
    trigger_events: [] as string[],
    output_format: "json",
  });

  const { data: webhooks, isLoading } = useQuery({
    queryKey: ["webhooks"],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke("webhook-management", {
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
      });
      if (response.error) throw response.error;
      return response.data.data as WebhookConfig[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke("webhook-management", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
        body: {
          name: data.name,
          description: data.description || null,
          url: data.url,
          auth_type: data.auth_type,
          auth_credentials: data.auth_type === "bearer" ? { token: data.auth_token } : null,
          trigger_events: data.trigger_events,
          output_format: data.output_format,
        },
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success("Webhook created successfully");
      setIsCreateDialogOpen(false);
      setFormData({
        name: "",
        description: "",
        url: "",
        auth_type: "none",
        auth_token: "",
        trigger_events: [],
        output_format: "json",
      });
    },
    onError: (error: any) => {
      toast.error("Failed to create webhook", { description: error.message });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke(`webhook-management/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
        body: { is_active },
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success("Webhook updated");
    },
    onError: (error: any) => {
      toast.error("Failed to update webhook", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke(`webhook-management/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success("Webhook deleted");
    },
    onError: (error: any) => {
      toast.error("Failed to delete webhook", { description: error.message });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: string) => {
      setTestingWebhookId(id);
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke(`webhook-management/${id}/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) {
        toast.success("Test webhook delivered successfully");
      } else {
        toast.error("Test webhook failed", { description: data.error });
      }
    },
    onError: (error: any) => {
      toast.error("Failed to test webhook", { description: error.message });
    },
    onSettled: () => {
      setTestingWebhookId(null);
    },
  });

  const handleTriggerToggle = (event: string) => {
    setFormData(prev => ({
      ...prev,
      trigger_events: prev.trigger_events.includes(event)
        ? prev.trigger_events.filter(e => e !== event)
        : [...prev.trigger_events, event],
    }));
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Webhook className="h-5 w-5" />
                Webhooks
              </CardTitle>
              <CardDescription>
                Push real-time alerts to external systems when specific events occur
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Webhook
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Webhook</DialogTitle>
                  <DialogDescription>
                    Configure a webhook to receive real-time alerts from Fortress AI
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Splunk SIEM Integration"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="url">Webhook URL *</Label>
                    <Input
                      id="url"
                      placeholder="https://your-system.com/webhook"
                      value={formData.url}
                      onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      placeholder="What system receives this webhook?"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Trigger Events *</Label>
                    <div className="space-y-2">
                      {TRIGGER_EVENTS.map(event => (
                        <div
                          key={event.value}
                          className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                            formData.trigger_events.includes(event.value)
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50"
                          }`}
                          onClick={() => handleTriggerToggle(event.value)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm">{event.label}</div>
                              <div className="text-xs text-muted-foreground">{event.description}</div>
                            </div>
                            <Switch checked={formData.trigger_events.includes(event.value)} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Authentication</Label>
                      <Select
                        value={formData.auth_type}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, auth_type: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="bearer">Bearer Token</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Output Format</Label>
                      <Select
                        value={formData.output_format}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, output_format: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="json">JSON</SelectItem>
                          <SelectItem value="cef">CEF (SIEM)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {formData.auth_type === "bearer" && (
                    <div className="space-y-2">
                      <Label>Bearer Token</Label>
                      <Input
                        type="password"
                        placeholder="Enter authentication token"
                        value={formData.auth_token}
                        onChange={(e) => setFormData(prev => ({ ...prev, auth_token: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createMutation.mutate(formData)}
                    disabled={!formData.name || !formData.url || !formData.trigger_events.length || createMutation.isPending}
                  >
                    {createMutation.isPending ? "Creating..." : "Create Webhook"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading webhooks...</div>
          ) : !webhooks?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No webhooks configured yet. Create one to start receiving real-time alerts.
            </div>
          ) : (
            <Accordion type="single" collapsible className="space-y-2">
              {webhooks.map((webhook) => (
                <AccordionItem key={webhook.id} value={webhook.id} className="border rounded-lg px-4">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center justify-between w-full mr-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${webhook.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                        <div className="text-left">
                          <div className="font-medium">{webhook.name}</div>
                          <div className="text-sm text-muted-foreground truncate max-w-[300px]">
                            {webhook.url}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {webhook.output_format.toUpperCase()}
                        </Badge>
                        {webhook.trigger_events.map(e => (
                          <Badge key={e} variant="secondary" className="text-xs">
                            {e.split(".")[1]}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Last Triggered:</span>{" "}
                        {webhook.last_triggered_at
                          ? format(new Date(webhook.last_triggered_at), "MMM d, yyyy HH:mm")
                          : "Never"
                        }
                      </div>
                      <div>
                        <span className="text-muted-foreground">Created:</span>{" "}
                        {format(new Date(webhook.created_at), "MMM d, yyyy")}
                      </div>
                    </div>
                    
                    {webhook.secret && (
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Signing Secret</div>
                            <code className="text-xs">{webhook.secret}</code>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => webhook.secret && copyToClipboard(webhook.secret)}
                          >
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => testMutation.mutate(webhook.id)}
                        disabled={testingWebhookId === webhook.id}
                      >
                        {testingWebhookId === webhook.id ? (
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-2" />
                        )}
                        Test Webhook
                      </Button>
                      <div className="flex items-center gap-2 ml-auto">
                        <span className="text-sm text-muted-foreground">Active</span>
                        <Switch
                          checked={webhook.is_active}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: webhook.id, is_active: checked })}
                        />
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Webhook?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will stop sending alerts to this endpoint. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground"
                              onClick={() => deleteMutation.mutate(webhook.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Test Result Dialog */}
      <Dialog open={!!testResult} onOpenChange={() => setTestResult(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook Test Result</DialogTitle>
          </DialogHeader>
          {testResult && (
            <div className="space-y-4">
              <div className={`p-4 rounded-lg ${testResult.success ? "bg-green-500/10" : "bg-red-500/10"}`}>
                <div className="font-medium">
                  {testResult.success ? "✅ Delivery Successful" : "❌ Delivery Failed"}
                </div>
                {testResult.status_code && (
                  <div className="text-sm text-muted-foreground">
                    HTTP Status: {testResult.status_code}
                  </div>
                )}
                {testResult.error && (
                  <div className="text-sm text-destructive mt-2">{testResult.error}</div>
                )}
              </div>
              {testResult.response_body && (
                <div className="space-y-2">
                  <Label>Response Body</Label>
                  <pre className="p-3 bg-muted rounded-lg text-xs overflow-auto max-h-40">
                    {testResult.response_body}
                  </pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setTestResult(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
