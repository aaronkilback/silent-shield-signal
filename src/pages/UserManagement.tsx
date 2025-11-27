import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useNavigate } from "react-router-dom";
import { Loader2, Users, Shield, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type AppRole = 'admin' | 'analyst' | 'viewer';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
}

interface UserRole {
  user_id: string;
  role: AppRole;
}

const UserManagement = () => {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isLoading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: users, isLoading: usersLoading } = useQuery({
    queryKey: ['user-management'],
    queryFn: async () => {
      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, name')
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
        
        return {
          id: profile.id,
          name: profile.name,
          email: authUser?.email || 'N/A',
          created_at: authUser?.created_at || '',
          last_sign_in_at: authUser?.last_sign_in_at || null,
          role: (userRole?.role || 'viewer') as AppRole
        };
      });

      return combinedUsers;
    },
    enabled: !!user && isAdmin
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

  if (!isAdmin) {
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
      case 'admin':
        return 'destructive';
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
              <Badge variant="outline" className="gap-2">
                <Users className="w-4 h-4" />
                {users?.length || 0} Users
              </Badge>
            </div>

            {usersLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-4">
                {users?.map((userItem) => (
                  <Card key={userItem.id} className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold">{userItem.name}</h3>
                          <Badge variant={getRoleBadgeVariant(userItem.role)}>
                            <Shield className="w-3 h-3 mr-1" />
                            {userItem.role}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground space-y-1">
                          <p>Email: {userItem.email}</p>
                          <p>Joined: {format(new Date(userItem.created_at), 'PPP')}</p>
                          {userItem.last_sign_in_at && (
                            <p>Last sign in: {format(new Date(userItem.last_sign_in_at), 'PPP p')}</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {userItem.id === user.id ? (
                          <Badge variant="outline">You</Badge>
                        ) : (
                          <Select
                            value={userItem.role}
                            onValueChange={(value) => 
                              updateRoleMutation.mutate({ 
                                userId: userItem.id, 
                                newRole: value as AppRole 
                              })
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="analyst">Analyst</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
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
          <h3 className="text-lg font-semibold mb-4">Role Permissions</h3>
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Badge variant="destructive" className="mt-1">
                <Shield className="w-3 h-3 mr-1" />
                Admin
              </Badge>
              <p className="text-muted-foreground">
                Full system access including user management, configuration, and all features
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="default" className="mt-1">
                <Shield className="w-3 h-3 mr-1" />
                Analyst
              </Badge>
              <p className="text-muted-foreground">
                Can view and manage signals, incidents, investigations, entities, and reports
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Badge variant="secondary" className="mt-1">
                <Shield className="w-3 h-3 mr-1" />
                Viewer
              </Badge>
              <p className="text-muted-foreground">
                Read-only access to view dashboards and reports
              </p>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
};

export default UserManagement;
