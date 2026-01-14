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
import { toast } from "sonner";
import { Plus, Trash2, Copy, Key, AlertTriangle, Check } from "lucide-react";
import { format } from "date-fns";

interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  key_prefix: string;
  client_id: string | null;
  permissions: string[];
  rate_limit_per_minute: number;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  clients?: { name: string } | null;
}

export function ApiKeysManager() {
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newKeyRevealed, setNewKeyRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    client_id: "",
    permissions: ["read:signals", "read:clients"],
    rate_limit_per_minute: 60,
    expires_in_days: "",
  });

  const { data: apiKeys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke("api-key-management", {
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
      });
      if (response.error) throw response.error;
      return response.data.data as ApiKey[];
    },
  });

  const { data: clients } = useQuery({
    queryKey: ["clients-for-api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke("api-key-management", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
        body: {
          name: data.name,
          description: data.description || null,
          client_id: data.client_id || null,
          permissions: data.permissions,
          rate_limit_per_minute: data.rate_limit_per_minute,
          expires_at: data.expires_in_days 
            ? new Date(Date.now() + parseInt(data.expires_in_days) * 24 * 60 * 60 * 1000).toISOString()
            : null,
        },
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setNewKeyRevealed(data.data.api_key);
      setFormData({
        name: "",
        description: "",
        client_id: "",
        permissions: ["read:signals", "read:clients"],
        rate_limit_per_minute: 60,
        expires_in_days: "",
      });
    },
    onError: (error: any) => {
      toast.error("Failed to create API key", { description: error.message });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke(`api-key-management/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
        body: { is_active },
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key updated");
    },
    onError: (error: any) => {
      toast.error("Failed to update API key", { description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: session } = await supabase.auth.getSession();
      const response = await supabase.functions.invoke(`api-key-management/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.session?.access_token}` },
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast.success("API key deleted");
    },
    onError: (error: any) => {
      toast.error("Failed to delete API key", { description: error.message });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  const handlePermissionToggle = (permission: string) => {
    setFormData(prev => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter(p => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API Keys
              </CardTitle>
              <CardDescription>
                Manage API keys for external system access to Fortress AI
              </CardDescription>
            </div>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Create API Key
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Create API Key</DialogTitle>
                  <DialogDescription>
                    Generate a new API key for external system access
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      placeholder="e.g., SIEM Integration"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      placeholder="What is this key used for?"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Scope to Client (optional)</Label>
                    <Select
                      value={formData.client_id}
                      onValueChange={(value) => setFormData(prev => ({ ...prev, client_id: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="All clients (no restriction)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">All clients</SelectItem>
                        {clients?.map(client => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Permissions</Label>
                    <div className="flex flex-wrap gap-2">
                      {["read:signals", "read:clients", "read:incidents", "read:entities"].map(perm => (
                        <Badge
                          key={perm}
                          variant={formData.permissions.includes(perm) ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => handlePermissionToggle(perm)}
                        >
                          {perm}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Rate Limit (req/min)</Label>
                      <Input
                        type="number"
                        value={formData.rate_limit_per_minute}
                        onChange={(e) => setFormData(prev => ({ ...prev, rate_limit_per_minute: parseInt(e.target.value) || 60 }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Expires In (days)</Label>
                      <Input
                        type="number"
                        placeholder="Never"
                        value={formData.expires_in_days}
                        onChange={(e) => setFormData(prev => ({ ...prev, expires_in_days: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createMutation.mutate(formData)}
                    disabled={!formData.name || createMutation.isPending}
                  >
                    {createMutation.isPending ? "Creating..." : "Create Key"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading API keys...</div>
          ) : !apiKeys?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              No API keys created yet. Create one to enable external integrations.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key Prefix</TableHead>
                  <TableHead>Client Scope</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{key.name}</div>
                        {key.description && (
                          <div className="text-sm text-muted-foreground">{key.description}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-2 py-1 rounded">{key.key_prefix}</code>
                    </TableCell>
                    <TableCell>
                      {key.clients?.name || <span className="text-muted-foreground">All clients</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {key.permissions.slice(0, 2).map(p => (
                          <Badge key={p} variant="secondary" className="text-xs">
                            {p.split(":")[1]}
                          </Badge>
                        ))}
                        {key.permissions.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{key.permissions.length - 2}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {key.last_used_at
                        ? format(new Date(key.last_used_at), "MMM d, HH:mm")
                        : <span className="text-muted-foreground">Never</span>
                      }
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={key.is_active}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: key.id, is_active: checked })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete API Key?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently revoke access for any systems using this key.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground"
                              onClick={() => deleteMutation.mutate(key.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* New Key Revealed Dialog */}
      <Dialog open={!!newKeyRevealed} onOpenChange={() => setNewKeyRevealed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Save Your API Key
            </DialogTitle>
            <DialogDescription>
              This is the only time you'll see this key. Copy and store it securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg font-mono text-sm break-all">
              {newKeyRevealed}
            </div>
            <Button
              className="w-full"
              onClick={() => newKeyRevealed && copyToClipboard(newKeyRevealed)}
            >
              {copied ? (
                <><Check className="h-4 w-4 mr-2" /> Copied!</>
              ) : (
                <><Copy className="h-4 w-4 mr-2" /> Copy to Clipboard</>
              )}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewKeyRevealed(null)}>
              I've saved the key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
