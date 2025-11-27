import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useNavigate } from "react-router-dom";
import { Loader2, Users, Shield, AlertCircle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type AppRole = 'super_admin' | 'admin' | 'analyst' | 'viewer';

interface Client {
  id: string;
  name: string;
}

interface UserProfile {
  id: string;
  name: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  client_id: string | null;
  client_name: string | null;
}

interface UserRole {
  user_id: string;
  role: AppRole;
}

const UserManagement = () => {
  const { user, loading: authLoading } = useAuth();
  const { isSuperAdmin, isAdmin, isLoading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteClientId, setInviteClientId] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<AppRole>("viewer");
  
  const canManageUsers = isSuperAdmin || isAdmin;

  const { data: clients } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      return data as Client[];
    },
    enabled: !!user && canManageUsers
  });

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['user-management'],
    queryFn: async () => {
      // Fetch profiles with client info
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name, client_id, clients(name)')
        .order('name');
      
      if (profilesError) throw profilesError;

      // Fetch auth users data (admin API)
      const { data, error: authError } = await supabase.auth.admin.listUsers();
      if (authError) throw authError;
      
      const authUsers = data?.users || [];

      // Fetch user roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');
      
      if (rolesError) throw rolesError;

      // Combine data
      const combinedUsers = profiles.map(profile => {
        const authUser = authUsers.find(u => u.id === profile.id);
        const userRole = roles.find(r => r.user_id === profile.id);
        const clientData = profile.clients as any;
        
        return {
          id: profile.id,
          name: profile.name,
          email: authUser?.email || 'N/A',
          created_at: authUser?.created_at || '',
          last_sign_in_at: authUser?.last_sign_in_at || null,
          client_id: profile.client_id,
          client_name: clientData?.name || null,
          role: (userRole?.role || 'viewer') as AppRole
        };
      });

      return combinedUsers;
    },
    enabled: !!user && canManageUsers
  });

  const inviteUserMutation = useMutation({
    mutationFn: async () => {
      // Create the user account
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: inviteEmail,
        email_confirm: true,
        user_metadata: { name: inviteName }
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create user');

      // Update profile with client_id
      if (inviteClientId) {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({ client_id: inviteClientId })
          .eq('id', authData.user.id);
        
        if (profileError) throw profileError;
      }

      // Update role if not viewer (default is viewer from trigger)
      if (inviteRole !== 'viewer') {
        await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', authData.user.id);

        const { error: roleError } = await supabase
          .from('user_roles')
          .insert({ user_id: authData.user.id, role: inviteRole });
        
        if (roleError) throw roleError;
      }

      return authData.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-management'] });
      toast.success('User invited successfully');
      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteClientId("");
      setInviteRole("viewer");
    },
    onError: (error) => {
      toast.error('Failed to invite user: ' + error.message);
    }
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, newRole }: { userId: string; newRole: AppRole }) => {
      // Delete existing role
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

      // Insert new role
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: newRole });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-management'] });
      toast.success('User role updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update user role: ' + error.message);
    }
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ userId, clientId }: { userId: string; clientId: string | null }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ client_id: clientId })
        .eq('id', userId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-management'] });
      toast.success('User client updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update user client: ' + error.message);
    }
  });

  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    navigate("/auth");
    return null;
  }

  if (!canManageUsers) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-6 py-8">
          <Card className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-muted-foreground">
              You must be an administrator to access user management.
            </p>
            <Button onClick={() => navigate('/')} className="mt-6">
              Return to Dashboard
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  const getRoleBadgeVariant = (role: AppRole) => {
    switch (role) {
      case 'super_admin':
        return 'destructive';
      case 'admin':
        return 'default';
      case 'analyst':
        return 'default';
      case 'viewer':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 rounded-lg bg-primary/10">
            <Users className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">User Management</h1>
            <p className="text-muted-foreground">Manage user accounts and permissions</p>
          </div>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-4 border-b">
              <h2 className="text-xl font-semibold">User Accounts</h2>
              <div className="flex gap-2 items-center">
                <Badge variant="outline" className="gap-2">
                  <Users className="w-4 h-4" />
                  {users?.length || 0} Users
                </Badge>
                <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button className="gap-2">
                      <UserPlus className="w-4 h-4" />
                      Invite User
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Invite New User</DialogTitle>
                      <DialogDescription>
                        Create a new user account and assign them to a client with specific permissions
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                          id="name"
                          value={inviteName}
                          onChange={(e) => setInviteName(e.target.value)}
                          placeholder="John Doe"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          placeholder="user@example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="client">Client</Label>
                        <Select value={inviteClientId} onValueChange={setInviteClientId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select client" />
                          </SelectTrigger>
                          <SelectContent>
                            {clients?.map((client) => (
                              <SelectItem key={client.id} value={client.id}>
                                {client.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as AppRole)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="analyst">Analyst</SelectItem>
                            <SelectItem value="viewer">Viewer</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        onClick={() => inviteUserMutation.mutate()}
                        disabled={!inviteEmail || !inviteName || !inviteClientId || inviteUserMutation.isPending}
                      >
                        {inviteUserMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Invite User
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>

            {usersLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-4">
                {users?.map((userItem) => (
                  <Card key={userItem.id} className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3 flex-wrap">
                          <h3 className="font-semibold">{userItem.name}</h3>
                          <Badge variant={getRoleBadgeVariant(userItem.role)}>
                            <Shield className="w-3 h-3 mr-1" />
                            {userItem.role}
                          </Badge>
                          {userItem.client_name && (
                            <Badge variant="outline">{userItem.client_name}</Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>Email: {userItem.email}</p>
                          <p>Joined: {format(new Date(userItem.created_at), 'PPP')}</p>
                          {userItem.last_sign_in_at && (
                            <p>Last sign in: {format(new Date(userItem.last_sign_in_at), 'PPP p')}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-2 min-w-[140px]">
                        {userItem.id === user.id ? (
                          <Badge variant="outline" className="w-full justify-center">You</Badge>
                        ) : (
                          <>
                            <Select
                              value={userItem.role}
                              onValueChange={(value) => 
                                updateRoleMutation.mutate({ 
                                  userId: userItem.id, 
                                  newRole: value as AppRole 
                                })
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {isSuperAdmin && <SelectItem value="super_admin">Super Admin</SelectItem>}
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="analyst">Analyst</SelectItem>
                                <SelectItem value="viewer">Viewer</SelectItem>
                              </SelectContent>
                            </Select>
                            <Select
                              value={userItem.client_id || "none"}
                              onValueChange={(value) => 
                                updateClientMutation.mutate({ 
                                  userId: userItem.id, 
                                  clientId: value === "none" ? null : value
                                })
                              }
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Assign client" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">No Client</SelectItem>
                                {clients?.map((client) => (
                                  <SelectItem key={client.id} value={client.id}>
                                    {client.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6 mt-6">
          <h3 className="text-lg font-semibold mb-4">Role Permissions & Access Control</h3>
          <div className="space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <Badge variant="destructive" className="mt-1 min-w-[110px] justify-center">
                <Shield className="w-3 h-3 mr-1" />
                Super Admin
              </Badge>
              <div className="flex-1">
                <p className="font-medium mb-1">Platform-Level Access</p>
                <p className="text-muted-foreground mb-2">
                  Complete control over all system features and ALL client data:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>Manage all users across all clients</li>
                  <li>View and manage data for ALL clients (cross-client access)</li>
                  <li>Configure global monitoring sources and automation</li>
                  <li>Create and delete clients</li>
                  <li>Full administrative control over the entire platform</li>
                </ul>
                <p className="text-amber-600 dark:text-amber-500 mt-2 font-medium">
                  ⚠️ Platform administrators only - not for client staff
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="default" className="mt-1 min-w-[110px] justify-center">
                <Shield className="w-3 h-3 mr-1" />
                Admin
              </Badge>
              <div className="flex-1">
                <p className="font-medium mb-1">Client Administrator</p>
                <p className="text-muted-foreground mb-2">
                  Administrative control within their assigned client only:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>Manage users within their client organization</li>
                  <li>View and manage data ONLY for their assigned client</li>
                  <li>Configure client-specific monitoring and automation</li>
                  <li>Full access to their client's signals, incidents, investigations</li>
                  <li>Cannot access other clients' data (client-isolated)</li>
                </ul>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="default" className="mt-1 min-w-[110px] justify-center">
                <Shield className="w-3 h-3 mr-1" />
                Analyst
              </Badge>
              <div className="flex-1">
                <p className="font-medium mb-1">Security Operations</p>
                <p className="text-muted-foreground mb-2">
                  Can manage day-to-day security operations for their assigned client only:
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>View and triage signals for their client</li>
                  <li>Create and manage incidents and investigations</li>
                  <li>Add and manage entities (people, organizations, locations, vehicles)</li>
                  <li>Manage travel itineraries and travelers</li>
                  <li>Generate client-specific reports</li>
                  <li>Cannot access other clients' data (client-isolated)</li>
                </ul>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="secondary" className="mt-1 min-w-[110px] justify-center">
                <Shield className="w-3 h-3 mr-1" />
                Viewer
              </Badge>
              <div className="flex-1">
                <p className="font-medium mb-1">Read-Only Access</p>
                <p className="text-muted-foreground mb-2">
                  Can view information but cannot make changes (client-scoped):
                </p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 ml-2">
                  <li>View dashboard and metrics for their assigned client</li>
                  <li>View signals, incidents, and investigations (read-only)</li>
                  <li>View entities and their relationships</li>
                  <li>View reports and analytics for their client</li>
                  <li>Cannot create, edit, or delete any records</li>
                  <li>Cannot access other clients' data (client-isolated)</li>
                </ul>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-6 mt-6 bg-muted/50">
          <h3 className="text-lg font-semibold mb-3">How to Add Users to RDOS Client</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Click the <strong>"Invite User"</strong> button above</li>
            <li>Enter the new user's name and email address</li>
            <li>Select <strong>"RDOS"</strong> from the Client dropdown</li>
            <li>Choose their role (Admin, Analyst, or Viewer) based on the permissions above</li>
            <li>Click "Invite User" to create their account</li>
          </ol>
          <p className="text-sm text-muted-foreground mt-4">
            <strong>Note:</strong> Users assigned to RDOS will only see data and features relevant to that client. 
            Analysts and Viewers cannot access data from other clients.
          </p>
        </Card>
      </main>
    </div>
  );
};

export default UserManagement;
