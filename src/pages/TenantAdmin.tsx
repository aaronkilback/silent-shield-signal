import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useTenant, TenantRole } from "@/hooks/useTenant";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  UserPlus, 
  Mail, 
  Trash2, 
  Shield, 
  Clock, 
  Copy,
  Users,
  Settings,
  Plus,
  Building2
} from "lucide-react";
import { format } from "date-fns";
import { PageLayout } from "@/components/PageLayout";

export default function TenantAdmin() {
  const { session } = useAuth();
  const { currentTenant, isOwnerOrAdmin, isOwner, refetchTenants } = useTenant();
  const { isSuperAdmin, isLoading: roleLoading } = useUserRole();
  const queryClient = useQueryClient();
  
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TenantRole>("viewer");
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  
  // Create tenant state
  const [createTenantDialogOpen, setCreateTenantDialogOpen] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantOwnerEmail, setNewTenantOwnerEmail] = useState("");

  // Fetch tenant members
  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['tenant-members', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant?.id) return [];
      
      const { data, error } = await supabase
        .from('tenant_users')
        .select(`
          id,
          role,
          created_at,
          user_id
        `)
        .eq('tenant_id', currentTenant.id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant?.id && isOwnerOrAdmin,
  });

  // Fetch pending invites
  const { data: invites, isLoading: invitesLoading } = useQuery({
    queryKey: ['tenant-invites', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant?.id) return [];
      
      const { data, error } = await supabase
        .from('tenant_invites')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant?.id && isOwnerOrAdmin,
  });

  // Create invite mutation
  const createInviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: TenantRole }) => {
      const { data, error } = await supabase.functions.invoke('create-invite', {
        body: {
          tenant_id: currentTenant?.id,
          email,
          role
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success('Invite sent successfully!');
      setInviteEmail("");
      setInviteDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['tenant-invites', currentTenant?.id] });
      
      // Copy invite URL to clipboard
      if (data?.invite_url) {
        navigator.clipboard.writeText(data.invite_url);
        toast.info('Invite URL copied to clipboard');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create invite');
    }
  });

  // Delete invite mutation
  const deleteInviteMutation = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from('tenant_invites')
        .delete()
        .eq('id', inviteId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Invite revoked');
      queryClient.invalidateQueries({ queryKey: ['tenant-invites', currentTenant?.id] });
    },
    onError: () => {
      toast.error('Failed to revoke invite');
    }
  });

  // Update member role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: TenantRole }) => {
      const { error } = await supabase
        .from('tenant_users')
        .update({ role })
        .eq('id', memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Role updated');
      queryClient.invalidateQueries({ queryKey: ['tenant-members', currentTenant?.id] });
    },
    onError: () => {
      toast.error('Failed to update role');
    }
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('tenant_users')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Member removed');
      queryClient.invalidateQueries({ queryKey: ['tenant-members', currentTenant?.id] });
    },
    onError: () => {
      toast.error('Failed to remove member');
    }
  });

  const handleCreateInvite = () => {
    if (!inviteEmail) {
      toast.error('Please enter an email address');
      return;
    }
    createInviteMutation.mutate({ email: inviteEmail, role: inviteRole });
  };

  // Create tenant mutation
  const createTenantMutation = useMutation({
    mutationFn: async ({ name, ownerEmail }: { name: string; ownerEmail?: string }) => {
      const { data, error } = await supabase.functions.invoke('create-tenant', {
        body: {
          name,
          owner_email: ownerEmail || undefined
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`
        }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Tenant "${data.tenant.name}" created successfully!`);
      setNewTenantName("");
      setNewTenantOwnerEmail("");
      setCreateTenantDialogOpen(false);
      refetchTenants();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create tenant');
    }
  });

  const handleCreateTenant = () => {
    if (!newTenantName.trim()) {
      toast.error('Please enter a tenant name');
      return;
    }
    createTenantMutation.mutate({ 
      name: newTenantName, 
      ownerEmail: newTenantOwnerEmail || undefined 
    });
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'owner': return 'default';
      case 'admin': return 'secondary';
      case 'analyst': return 'outline';
      default: return 'outline';
    }
  };

  if (!isOwnerOrAdmin && !isSuperAdmin) {
    return (
      <PageLayout>
        <div className="flex items-center justify-center h-[50vh]">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <Shield className="mx-auto h-12 w-12 text-muted-foreground" />
              <CardTitle>Access Denied</CardTitle>
              <CardDescription>
                You need to be an admin or owner to access this page.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Settings className="h-6 w-6" />
              Tenant Administration
            </h1>
            <p className="text-muted-foreground">
              {currentTenant ? `Manage members and invites for ${currentTenant.name}` : 'Manage tenants'}
            </p>
          </div>
        </div>

        {/* Super Admin: Create Tenant Section */}
        {isSuperAdmin && (
          <Card className="border-primary/50 bg-primary/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <CardTitle>Create New Tenant</CardTitle>
                  <Badge variant="destructive" className="ml-2">Super Admin</Badge>
                </div>
                <Dialog open={createTenantDialogOpen} onOpenChange={setCreateTenantDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Tenant
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create New Tenant</DialogTitle>
                      <DialogDescription>
                        Create a new organization/tenant in the system
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="tenant-name">Tenant Name *</Label>
                        <Input
                          id="tenant-name"
                          placeholder="Acme Corporation"
                          value={newTenantName}
                          onChange={(e) => setNewTenantName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="owner-email">Owner Email (optional)</Label>
                        <Input
                          id="owner-email"
                          type="email"
                          placeholder="owner@company.com"
                          value={newTenantOwnerEmail}
                          onChange={(e) => setNewTenantOwnerEmail(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                          If provided and the user exists, they'll be assigned as owner. Otherwise, you'll be the owner.
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateTenantDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button 
                        onClick={handleCreateTenant}
                        disabled={createTenantMutation.isPending}
                      >
                        {createTenantMutation.isPending ? 'Creating...' : 'Create Tenant'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <CardDescription>
                As a super admin, you can create new tenants for organizations
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {/* Members Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <CardTitle>Members</CardTitle>
              </div>
              <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Invite Member
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite New Member</DialogTitle>
                    <DialogDescription>
                      Send an invitation to join {currentTenant?.name}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="colleague@company.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role">Role</Label>
                      <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as TenantRole)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="analyst">Analyst</SelectItem>
                          {isOwner && <SelectItem value="admin">Admin</SelectItem>}
                          {isOwner && <SelectItem value="owner">Owner</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button 
                      onClick={handleCreateInvite}
                      disabled={createInviteMutation.isPending}
                    >
                      {createInviteMutation.isPending ? 'Sending...' : 'Send Invite'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Loading members...
                    </TableCell>
                  </TableRow>
                ) : members?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No members yet
                    </TableCell>
                  </TableRow>
                ) : (
                  members?.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        User {member.user_id?.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(member.created_at), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        {isOwner && member.role !== 'owner' && (
                          <div className="flex items-center justify-end gap-2">
                            <Select 
                              value={member.role} 
                              onValueChange={(v) => updateRoleMutation.mutate({ 
                                memberId: member.id, 
                                role: v as TenantRole 
                              })}
                            >
                              <SelectTrigger className="w-[100px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="viewer">Viewer</SelectItem>
                                <SelectItem value="analyst">Analyst</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeMemberMutation.mutate(member.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Pending Invites Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              <CardTitle>Pending Invites</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitesLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Loading invites...
                    </TableCell>
                  </TableRow>
                ) : invites?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No pending invites
                    </TableCell>
                  </TableRow>
                ) : (
                  invites?.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">
                        {invite.email}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(invite.role)}>
                          {invite.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(invite.expires_at), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteInviteMutation.mutate(invite.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
