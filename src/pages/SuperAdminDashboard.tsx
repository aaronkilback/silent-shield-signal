import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { 
  Building2, 
  Users, 
  Clock, 
  Mail, 
  Plus, 
  ArrowRight, 
  Settings, 
  Activity,
  UserPlus,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  MoreHorizontal
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TenantStats {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  pending_invites: number;
  last_activity: string | null;
  is_active: boolean;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  tenant_id: string;
  tenant_name: string;
  created_at: string;
  expires_at: string;
  invited_by_email: string | null;
}

interface RecentActivity {
  id: string;
  action: string;
  resource: string;
  tenant_name: string;
  user_email: string | null;
  created_at: string;
}

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { isSuperAdmin, isLoading: loadingAdmin } = useIsSuperAdmin();
  const [tenants, setTenants] = useState<TenantStats[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loadingAdmin && !isSuperAdmin) {
      navigate("/");
      return;
    }
    if (isSuperAdmin) {
      loadDashboardData();
    }
  }, [isSuperAdmin, loadingAdmin, navigate]);

  const loadDashboardData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadTenantStats(),
        loadPendingInvites(),
        loadRecentActivity()
      ]);
    } finally {
      setLoading(false);
    }
  };

  const loadTenantStats = async () => {
    // Get all tenants
    const { data: tenantsData, error: tenantsError } = await supabase
      .from("tenants")
      .select("id, name, created_at")
      .order("created_at", { ascending: false });

    if (tenantsError) {
      console.error("Error loading tenants:", tenantsError);
      return;
    }

    // Get member counts per tenant
    const { data: memberships } = await supabase
      .from("tenant_users")
      .select("tenant_id");

    // Get pending invites per tenant
    const { data: invites } = await supabase
      .from("tenant_invites")
      .select("tenant_id")
      .is("used_at", null);

    // Get last activity per tenant
    const { data: activities } = await supabase
      .from("audit_events")
      .select("tenant_id, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    const tenantStats: TenantStats[] = (tenantsData || []).map(tenant => {
      const memberCount = memberships?.filter(m => m.tenant_id === tenant.id).length || 0;
      const pendingCount = invites?.filter(i => i.tenant_id === tenant.id).length || 0;
      const lastActivity = activities?.find(a => a.tenant_id === tenant.id)?.created_at || null;

      return {
        id: tenant.id,
        name: tenant.name,
        created_at: tenant.created_at,
        member_count: memberCount,
        pending_invites: pendingCount,
        last_activity: lastActivity,
        is_active: memberCount > 0
      };
    });

    setTenants(tenantStats);
  };

  const loadPendingInvites = async () => {
    const { data, error } = await supabase
      .from("tenant_invites")
      .select(`
        id,
        email,
        role,
        tenant_id,
        created_at,
        expires_at,
        invited_by,
        tenants!inner(name)
      `)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error loading invites:", error);
      return;
    }

    // Get inviter names from profiles (profiles uses 'name' not 'email')
    const inviterIds = [...new Set(data?.map(d => d.invited_by).filter(Boolean))];
    let inviterProfiles: Record<string, string> = {};
    
    if (inviterIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", inviterIds as string[]);
      
      (profiles || []).forEach((p: any) => {
        inviterProfiles[p.id] = p.name || "Unknown";
      });
    }

    const invites: PendingInvite[] = (data || []).map(invite => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      tenant_id: invite.tenant_id,
      tenant_name: (invite.tenants as any)?.name || "Unknown",
      created_at: invite.created_at,
      expires_at: invite.expires_at,
      invited_by_email: invite.invited_by ? inviterProfiles[invite.invited_by] || null : null
    }));

    setPendingInvites(invites);
  };

  const loadRecentActivity = async () => {
    const { data, error } = await supabase
      .from("tenant_activity")
      .select(`
        id,
        activity_type,
        resource_type,
        resource_name,
        description,
        tenant_id,
        user_id,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error loading activity:", error);
      return;
    }

    // Get tenant names
    const tenantIds = [...new Set(data?.map(d => d.tenant_id).filter(Boolean))];
    let tenantNames: Record<string, string> = {};
    
    if (tenantIds.length > 0) {
      const { data: tenantData } = await supabase
        .from("tenants")
        .select("id, name")
        .in("id", tenantIds);
      
      tenantData?.forEach(t => {
        tenantNames[t.id] = t.name;
      });
    }

    // Get user names from profiles
    const userIds = [...new Set(data?.map(d => d.user_id).filter(Boolean))];
    let userEmails: Record<string, string> = {};
    
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", userIds as string[]);
      
      (profiles || []).forEach((p: any) => {
        userEmails[p.id] = p.name || "Unknown";
      });
    }

    const activities: RecentActivity[] = (data || []).map(event => ({
      id: event.id,
      action: event.activity_type,
      resource: event.resource_type,
      tenant_name: event.tenant_id ? tenantNames[event.tenant_id] || "Unknown" : "System",
      user_email: event.user_id ? userEmails[event.user_id] || null : null,
      created_at: event.created_at
    }));

    setRecentActivity(activities);
  };

  const switchToTenant = (tenantId: string, tenantName: string) => {
    localStorage.setItem("selectedTenantId", tenantId);
    toast.success(`Switched to ${tenantName}`);
    navigate("/");
  };

  const createTenant = async () => {
    if (!newTenantName.trim()) return;
    
    setCreating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("create-tenant", {
        body: { name: newTenantName.trim() }
      });

      if (error) throw error;

      toast.success(`Created tenant: ${newTenantName}`);
      setNewTenantName("");
      setCreateDialogOpen(false);
      loadTenantStats();
    } catch (error: any) {
      toast.error(error.message || "Failed to create tenant");
    } finally {
      setCreating(false);
    }
  };

  const cancelInvite = async (inviteId: string) => {
    const { error } = await supabase
      .from("tenant_invites")
      .delete()
      .eq("id", inviteId);

    if (error) {
      toast.error("Failed to cancel invite");
      return;
    }

    toast.success("Invite cancelled");
    loadPendingInvites();
  };

  const resendInvite = async (invite: PendingInvite) => {
    toast.info("Resend functionality coming soon");
  };

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalMembers = tenants.reduce((sum, t) => sum + t.member_count, 0);
  const totalPendingInvites = tenants.reduce((sum, t) => sum + t.pending_invites, 0);
  const activeTenants = tenants.filter(t => t.is_active).length;

  if (loadingAdmin) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </PageLayout>
    );
  }

  if (!isSuperAdmin) {
    return null;
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Super Admin Dashboard</h1>
            <p className="text-muted-foreground">Manage all tenants and monitor system health</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadDashboardData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Tenant
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Tenant</DialogTitle>
                  <DialogDescription>
                    Create a new organization. You'll be added as the owner.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="tenant-name">Tenant Name</Label>
                    <Input
                      id="tenant-name"
                      placeholder="e.g., Acme Corporation"
                      value={newTenantName}
                      onChange={(e) => setNewTenantName(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={createTenant} disabled={creating || !newTenantName.trim()}>
                    {creating ? "Creating..." : "Create Tenant"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Tenants</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{tenants.length}</div>
                  <p className="text-xs text-muted-foreground">{activeTenants} active</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{totalMembers}</div>
                  <p className="text-xs text-muted-foreground">across all tenants</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Invites</CardTitle>
              <Mail className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{totalPendingInvites}</div>
                  <p className="text-xs text-muted-foreground">awaiting response</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{recentActivity.length}</div>
                  <p className="text-xs text-muted-foreground">events (last 50)</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs defaultValue="tenants" className="space-y-4">
          <TabsList>
            <TabsTrigger value="tenants">Tenants</TabsTrigger>
            <TabsTrigger value="invites">
              Pending Invites
              {totalPendingInvites > 0 && (
                <Badge variant="secondary" className="ml-2">{totalPendingInvites}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="activity">Activity Feed</TabsTrigger>
          </TabsList>

          {/* Tenants Tab */}
          <TabsContent value="tenants" className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search tenants..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <Card>
              <ScrollArea className="h-[500px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead className="text-center">Members</TableHead>
                      <TableHead className="text-center">Pending</TableHead>
                      <TableHead>Last Activity</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    ) : filteredTenants.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No tenants found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredTenants.map((tenant) => (
                        <TableRow key={tenant.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">{tenant.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary">{tenant.member_count}</Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {tenant.pending_invites > 0 ? (
                              <Badge variant="outline" className="text-amber-600 border-amber-600">
                                {tenant.pending_invites}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {tenant.last_activity ? (
                              <span className="text-sm text-muted-foreground">
                                {formatDistanceToNow(new Date(tenant.last_activity), { addSuffix: true })}
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">Never</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground">
                              {format(new Date(tenant.created_at), "MMM d, yyyy")}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => switchToTenant(tenant.id, tenant.name)}>
                                  <ArrowRight className="h-4 w-4 mr-2" />
                                  Switch to Tenant
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/tenant-admin?tenant=${tenant.id}`)}>
                                  <Settings className="h-4 w-4 mr-2" />
                                  Manage Settings
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => navigate(`/tenant-admin?tenant=${tenant.id}&tab=invites`)}>
                                  <UserPlus className="h-4 w-4 mr-2" />
                                  Invite Users
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
            </Card>
          </TabsContent>

          {/* Pending Invites Tab */}
          <TabsContent value="invites" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">All Pending Invitations</CardTitle>
                <CardDescription>
                  Invitations awaiting acceptance across all tenants
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Tenant</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Invited By</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                            <TableCell><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      ) : pendingInvites.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                            No pending invitations
                          </TableCell>
                        </TableRow>
                      ) : (
                        pendingInvites.map((invite) => (
                          <TableRow key={invite.id}>
                            <TableCell className="font-medium">{invite.email}</TableCell>
                            <TableCell>{invite.tenant_name}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="capitalize">{invite.role}</Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {invite.invited_by_email || "Unknown"}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDistanceToNow(new Date(invite.created_at), { addSuffix: true })}
                            </TableCell>
                            <TableCell>
                              {new Date(invite.expires_at) < new Date() ? (
                                <Badge variant="destructive">Expired</Badge>
                              ) : (
                                <span className="text-muted-foreground">
                                  {format(new Date(invite.expires_at), "MMM d")}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => resendInvite(invite)}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Resend Invite
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => cancelInvite(invite.id)}
                                    className="text-destructive"
                                  >
                                    <XCircle className="h-4 w-4 mr-2" />
                                    Cancel Invite
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Feed Tab */}
          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Activity</CardTitle>
                <CardDescription>
                  Latest events across all tenants
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px]">
                  {loading ? (
                    <div className="space-y-4">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex items-start gap-3 p-3">
                          <Skeleton className="h-8 w-8 rounded-full" />
                          <div className="space-y-2 flex-1">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-3 w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : recentActivity.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No recent activity
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {recentActivity.map((event) => (
                        <div 
                          key={event.id} 
                          className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Activity className="h-4 w-4 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              <span className="font-medium">{event.action}</span>
                              {" on "}
                              <span className="text-muted-foreground">{event.resource}</span>
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                              <span>{event.tenant_name}</span>
                              <span>•</span>
                              <span>{event.user_email || "System"}</span>
                              <span>•</span>
                              <span>{formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PageLayout>
  );
}
