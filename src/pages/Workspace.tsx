import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { 
  Loader2, Send, Users, MessageSquare, CheckSquare, Clock, 
  ArrowLeft, Plus, UserPlus, AlertTriangle, Mail, Shield, CalendarIcon, Bot
} from "lucide-react";
import { InviteMemberDialog } from "@/components/workspace/InviteMemberDialog";
import { AgentInteraction } from "@/components/agents/AgentInteraction";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import { getMCMRoleInfo, MCM_ROLE_ORDER, MCM_ROLES, canManageAssignments, canSubmitFindings, type MCMRole } from "@/lib/mcmRoles";
import { cn } from "@/lib/utils";

interface WorkspaceMessage {
  id: string;
  workspace_id: string;
  user_id: string;
  content: string;
  sent_at: string;
  message_type: string;
  profiles?: { name: string | null };
}

interface WorkspaceTask {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  assigned_to_user_id: string | null;
  status: string;
  due_date: string | null;
  diary_date: string | null;
  created_at: string;
  created_by_user_id: string;
  completed_at: string | null;
  profiles?: { name: string | null };
  assignee?: { name: string | null };
}

interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: string;
  mcm_role?: string;
  joined_at: string;
  profiles?: { name: string | null };
}

const Workspace = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const [newMessage, setNewMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showInviteMember, setShowInviteMember] = useState(false);
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberMcmRole, setNewMemberMcmRole] = useState<MCMRole>("investigator");
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState<string>("");
  const [newTaskDiaryDate, setNewTaskDiaryDate] = useState<Date | undefined>(undefined);
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  
  // Fetch AI agents for workspace
  const { data: agents = [], isLoading: agentsLoading } = useQuery({
    queryKey: ['workspace-agents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('is_active', true)
        .order('codename');
      
      if (error) throw error;
      return data;
    },
    enabled: !!user
  });
  
  // Fetch workspace details
  const { data: workspace, isLoading: workspaceLoading } = useQuery({
    queryKey: ['workspace', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investigation_workspaces')
        .select(`
          *,
          incidents(id, status, priority, summary),
          investigations(id, file_number, synopsis)
        `)
        .eq('id', id)
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!id && !!user
  });

  // Fetch members with profiles
  const { data: members = [] } = useQuery({
    queryKey: ['workspace-members', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', id);
      
      if (error) throw error;
      
      // Fetch profiles for members
      const userIds = data.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      return data.map(m => ({
        ...m,
        profiles: profileMap.get(m.user_id) || { name: null }
      })) as WorkspaceMember[];
    },
    enabled: !!id && !!user
  });

  // Fetch messages with profiles
  const { data: messages = [] } = useQuery({
    queryKey: ['workspace-messages', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_messages')
        .select('*')
        .eq('workspace_id', id)
        .order('sent_at', { ascending: true });
      
      if (error) throw error;
      
      // Fetch profiles for message authors
      const userIds = [...new Set(data.map(m => m.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      return data.map(m => ({
        ...m,
        profiles: profileMap.get(m.user_id) || { name: null }
      })) as WorkspaceMessage[];
    },
    enabled: !!id && !!user,
    refetchInterval: 5000 // Poll every 5s as fallback
  });

  // Fetch tasks with profiles
  const { data: tasks = [] } = useQuery({
    queryKey: ['workspace-tasks', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_tasks')
        .select('*')
        .eq('workspace_id', id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Fetch profiles for creators and assignees
      const creatorIds = data.map(t => t.created_by_user_id);
      const assigneeIds = data.filter(t => t.assigned_to_user_id).map(t => t.assigned_to_user_id!);
      const allUserIds = [...new Set([...creatorIds, ...assigneeIds])];
      
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', allUserIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      return data.map(t => ({
        ...t,
        profiles: profileMap.get(t.created_by_user_id) || { name: null },
        assignee: t.assigned_to_user_id ? (profileMap.get(t.assigned_to_user_id) || { name: null }) : undefined
      })) as WorkspaceTask[];
    },
    enabled: !!id && !!user
  });

  // Current user's MCM role and permissions
  const currentMember = members.find(m => m.user_id === user?.id);
  const currentMcmRole = (currentMember?.mcm_role || 'viewer') as MCMRole;
  const isTeamCommander = currentMcmRole === 'team_commander';
  const canManage = canManageAssignments(currentMcmRole);
  const canSubmit = canSubmitFindings(currentMcmRole);
  // Legacy compatibility
  const isOwner = currentMember?.role === 'owner' || isTeamCommander;
  const canEdit = canSubmit;

  // Real-time subscription for messages
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`workspace-messages-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'workspace_messages', filter: `workspace_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['workspace-messages', id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  // Real-time subscription for tasks
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`workspace-tasks-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'workspace_tasks', filter: `workspace_id=eq.${id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['workspace-tasks', id] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, queryClient]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user || !id) return;

    setSendingMessage(true);
    try {
      const { error } = await supabase
        .from('workspace_messages')
        .insert({
          workspace_id: id,
          user_id: user.id,
          content: newMessage.trim(),
          message_type: 'chat'
        });

      if (error) throw error;

      // Audit log
      await supabase.from('workspace_audit_log').insert({
        workspace_id: id,
        user_id: user.id,
        action: 'MESSAGE_SENT',
        details: { content_preview: newMessage.substring(0, 50) }
      });

      setNewMessage("");
    } catch (error: any) {
      toast.error("Failed to send message");
      console.error(error);
    } finally {
      setSendingMessage(false);
    }
  };

  // Add member
  const handleAddMember = async () => {
    if (!newMemberEmail.trim() || !id || !user) return;

    try {
      // Find user by email
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .ilike('name', newMemberEmail)
        .maybeSingle();

      if (profileError || !profile) {
        toast.error("User not found. Try searching by their display name.");
        return;
      }

      const mcmRoleInfo = getMCMRoleInfo(newMemberMcmRole);
      
      const memberData = {
        workspace_id: id,
        user_id: profile.id,
        role: 'contributor', // Legacy role
        mcm_role: newMemberMcmRole,
      };
      
      const { error } = await supabase
        .from('workspace_members')
        .insert(memberData as any);

      if (error) throw error;

      // System message
      await supabase.from('workspace_messages').insert({
        workspace_id: id,
        user_id: user.id,
        content: `Added a new ${mcmRoleInfo.label} to the workspace`,
        message_type: 'system_event'
      });

      // Audit log
      await supabase.from('workspace_audit_log').insert({
        workspace_id: id,
        user_id: user.id,
        action: 'MEMBER_ADDED',
        details: { added_user_id: profile.id, mcm_role: newMemberMcmRole }
      });

      queryClient.invalidateQueries({ queryKey: ['workspace-members', id] });
      setNewMemberEmail("");
      setNewMemberMcmRole("investigator");
      setShowAddMember(false);
      toast.success("Member added successfully");
    } catch (error: any) {
      toast.error(error.message || "Failed to add member");
    }
  };

  // Create task
  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !id || !user) return;

    try {
      const { error } = await supabase
        .from('workspace_tasks')
        .insert({
          workspace_id: id,
          title: newTaskTitle.trim(),
          description: newTaskDescription.trim() || null,
          assigned_to_user_id: newTaskAssignee || null,
          diary_date: newTaskDiaryDate ? format(newTaskDiaryDate, 'yyyy-MM-dd') : null,
          created_by_user_id: user.id,
          status: 'pending'
        } as any);

      if (error) throw error;

      // System message
      await supabase.from('workspace_messages').insert({
        workspace_id: id,
        user_id: user.id,
        content: `Created task: "${newTaskTitle}"`,
        message_type: 'system_event'
      });

      // Audit log
      await supabase.from('workspace_audit_log').insert({
        workspace_id: id,
        user_id: user.id,
        action: 'TASK_CREATED',
        details: { title: newTaskTitle }
      });

      queryClient.invalidateQueries({ queryKey: ['workspace-tasks', id] });
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskAssignee("");
      setNewTaskDiaryDate(undefined);
      setShowCreateTask(false);
      toast.success("Task created");
    } catch (error: any) {
      toast.error("Failed to create task");
    }
  };

  // Update task status
  const handleUpdateTaskStatus = async (taskId: string, newStatus: string) => {
    if (!canEdit || !user || !id) return;

    try {
      const updateData: any = { status: newStatus };
      if (newStatus === 'completed') {
        updateData.completed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('workspace_tasks')
        .update(updateData)
        .eq('id', taskId);

      if (error) throw error;

      // Audit log
      await supabase.from('workspace_audit_log').insert({
        workspace_id: id,
        user_id: user.id,
        action: 'TASK_STATUS_CHANGED',
        details: { task_id: taskId, new_status: newStatus }
      });

      queryClient.invalidateQueries({ queryKey: ['workspace-tasks', id] });
      toast.success("Task updated");
    } catch (error: any) {
      toast.error("Failed to update task");
    }
  };

  if (authLoading || workspaceLoading) {
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

  if (!workspace) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-6 py-8">
          <Card className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Workspace Not Found</h2>
            <p className="text-muted-foreground mb-4">
              This workspace doesn't exist or you don't have access to it.
            </p>
            <Button onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  const parentLink = workspace.incident_id 
    ? `/incidents?highlight=${workspace.incident_id}` 
    : `/investigation/${workspace.investigation_id}`;
  const parentLabel = workspace.incident_id 
    ? `Incident: ${workspace.incidents?.summary?.substring(0, 40) || 'View Incident'}...`
    : `Investigation: ${workspace.investigations?.file_number || 'View Investigation'}`;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{workspace.title}</h1>
              <p className="text-muted-foreground text-sm">
                <a href={parentLink} className="hover:underline">{parentLabel}</a>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={workspace.status === 'active' ? 'default' : 'secondary'}>
              {workspace.status}
            </Badge>
            {isOwner && (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowInviteMember(true)}>
                  <Mail className="w-4 h-4 mr-2" />
                  Invite by Email
                </Button>
                <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      <UserPlus className="w-4 h-4 mr-2" />
                      Add Existing User
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Workspace Member</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div>
                        <label className="text-sm font-medium">User Name</label>
                        <Input
                          placeholder="Enter user's display name"
                          value={newMemberEmail}
                          onChange={(e) => setNewMemberEmail(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium flex items-center gap-2">
                          <Shield className="w-4 h-4" />
                          Investigation Role (MCM)
                        </label>
                        <Select value={newMemberMcmRole} onValueChange={(v) => setNewMemberMcmRole(v as MCMRole)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {MCM_ROLE_ORDER.map((role) => {
                              const info = MCM_ROLES[role];
                              return (
                                <SelectItem key={role} value={role}>
                                  <div className="flex items-center gap-2">
                                    <Badge variant={info.badgeVariant} className="text-xs px-1.5 py-0">
                                      {info.shortLabel}
                                    </Badge>
                                    <span>{info.label}</span>
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          {getMCMRoleInfo(newMemberMcmRole).description}
                        </p>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowAddMember(false)}>Cancel</Button>
                      <Button onClick={handleAddMember}>Add Member</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </>
            )}
          </div>
          
          {/* Invite Member Dialog */}
          {id && (
            <InviteMemberDialog
              open={showInviteMember}
              onOpenChange={setShowInviteMember}
              workspaceId={id}
            />
          )}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Sidebar - Members */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4" />
                Members ({members.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {members.map((member) => {
                const roleInfo = getMCMRoleInfo(member.mcm_role);
                return (
                  <div key={member.user_id} className="flex items-center gap-2">
                    <Avatar className="w-8 h-8">
                      <AvatarFallback className="text-xs">
                        {member.profiles?.name?.substring(0, 2).toUpperCase() || '??'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {member.profiles?.name || 'Unknown'}
                      </p>
                      <Badge variant={roleInfo.badgeVariant} className="text-xs">
                        {roleInfo.shortLabel} - {roleInfo.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Main Area - Chat & Tasks */}
          <Card className="lg:col-span-3">
            <Tabs defaultValue="chat" className="h-full">
              <CardHeader className="pb-0">
                <TabsList>
                  <TabsTrigger value="chat" className="gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Chat
                  </TabsTrigger>
                  <TabsTrigger value="tasks" className="gap-2">
                    <CheckSquare className="w-4 h-4" />
                    Tasks ({tasks.length})
                  </TabsTrigger>
                  <TabsTrigger value="agents" className="gap-2">
                    <Bot className="w-4 h-4" />
                    Agents ({agents.length})
                  </TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent className="pt-4">
                {/* Chat Tab */}
                <TabsContent value="chat" className="mt-0">
                  <ScrollArea className="h-[400px] pr-4 mb-4">
                    {messages.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No messages yet. Start the conversation!</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {messages.map((msg) => (
                          <div 
                            key={msg.id} 
                            className={`flex gap-3 ${msg.message_type === 'system_event' ? 'justify-center' : ''}`}
                          >
                            {msg.message_type === 'system_event' ? (
                              <div className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                                {msg.content}
                              </div>
                            ) : (
                              <>
                                <Avatar className="w-8 h-8 flex-shrink-0">
                                  <AvatarFallback className="text-xs">
                                    {msg.profiles?.name?.substring(0, 2).toUpperCase() || '??'}
                                  </AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-medium text-sm">
                                      {msg.profiles?.name || 'Unknown'}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {formatDistanceToNow(new Date(msg.sent_at), { addSuffix: true })}
                                    </span>
                                  </div>
                                  <p className="text-sm mt-1">{msg.content}</p>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                        <div ref={messagesEndRef} />
                      </div>
                    )}
                  </ScrollArea>
                  
                  {canEdit && (
                    <div className="flex gap-2">
                      <Input
                        placeholder="Type a message..."
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        disabled={sendingMessage}
                      />
                      <Button onClick={handleSendMessage} disabled={sendingMessage || !newMessage.trim()}>
                        {sendingMessage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </Button>
                    </div>
                  )}
                </TabsContent>

                {/* Tasks Tab */}
                <TabsContent value="tasks" className="mt-0">
                  {canEdit && (
                    <div className="mb-4">
                      <Dialog open={showCreateTask} onOpenChange={setShowCreateTask}>
                        <DialogTrigger asChild>
                          <Button size="sm">
                            <Plus className="w-4 h-4 mr-2" />
                            New Task
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Create Task</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div>
                              <label className="text-sm font-medium">Title</label>
                              <Input
                                placeholder="Task title"
                                value={newTaskTitle}
                                onChange={(e) => setNewTaskTitle(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className="text-sm font-medium">Description</label>
                              <Textarea
                                placeholder="Optional description"
                                value={newTaskDescription}
                                onChange={(e) => setNewTaskDescription(e.target.value)}
                              />
                            </div>
                            <div>
                              <label className="text-sm font-medium">Assign to</label>
                              <Select value={newTaskAssignee || "unassigned"} onValueChange={(v) => setNewTaskAssignee(v === "unassigned" ? "" : v)}>
                                <SelectTrigger>
                                  <SelectValue placeholder="Unassigned" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unassigned">Unassigned</SelectItem>
                                  {members.map((m) => (
                                    <SelectItem key={m.user_id} value={m.user_id}>
                                      {m.profiles?.name || 'Unnamed User'}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="text-sm font-medium">Diary Date</label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button
                                    variant="outline"
                                    className={cn(
                                      "w-full justify-start text-left font-normal",
                                      !newTaskDiaryDate && "text-muted-foreground"
                                    )}
                                  >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {newTaskDiaryDate ? format(newTaskDiaryDate, "PPP") : <span>Pick a date</span>}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <Calendar
                                    mode="single"
                                    selected={newTaskDiaryDate}
                                    onSelect={setNewTaskDiaryDate}
                                    initialFocus
                                    className="pointer-events-auto"
                                  />
                                </PopoverContent>
                              </Popover>
                              <p className="text-xs text-muted-foreground mt-1">
                                Date for progress review/follow-up
                              </p>
                            </div>
                          </div>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setShowCreateTask(false)}>Cancel</Button>
                            <Button onClick={handleCreateTask} disabled={!newTaskTitle.trim()}>Create</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}

                  <ScrollArea className="h-[400px]">
                    {tasks.length === 0 ? (
                      <div className="text-center text-muted-foreground py-12">
                        <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No tasks yet. Create one to get started!</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {tasks.map((task) => (
                          <Card key={task.id} className="p-4">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <h4 className={`font-medium ${task.status === 'completed' ? 'line-through text-muted-foreground' : ''}`}>
                                  {task.title}
                                </h4>
                                {task.description && (
                                  <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
                                  <span>Created by {task.profiles?.name || 'Unknown'}</span>
                                  {task.assigned_to_user_id && (
                                    <>
                                      <span>•</span>
                                      <span>Assigned to {task.assignee?.name || 'Unnamed User'}</span>
                                    </>
                                  )}
                                  {(task as any).diary_date && (
                                    <>
                                      <span>•</span>
                                      <Badge variant="outline" className="text-xs font-normal">
                                        <Clock className="w-3 h-3 mr-1" />
                                        Diary: {format(new Date((task as any).diary_date), 'MMM d, yyyy')}
                                      </Badge>
                                    </>
                                  )}
                                </div>
                              </div>
                              {canEdit && (
                                <Select
                                  value={task.status}
                                  onValueChange={(v) => handleUpdateTaskStatus(task.id, v)}
                                >
                                  <SelectTrigger className="w-32">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pending">Pending</SelectItem>
                                    <SelectItem value="in_progress">In Progress</SelectItem>
                                    <SelectItem value="completed">Completed</SelectItem>
                                    <SelectItem value="blocked">Blocked</SelectItem>
                                  </SelectContent>
                                </Select>
                              )}
                              {!canEdit && (
                                <Badge variant={
                                  task.status === 'completed' ? 'default' :
                                  task.status === 'blocked' ? 'destructive' :
                                  task.status === 'in_progress' ? 'secondary' : 'outline'
                                }>
                                  {task.status.replace('_', ' ')}
                                </Badge>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* Agents Tab */}
                <TabsContent value="agents" className="mt-0">
                  {agentsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : agents.length === 0 ? (
                    <div className="text-center text-muted-foreground py-12">
                      <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>No AI agents available yet.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Agent selector */}
                      <div className="flex flex-wrap gap-2">
                        {agents.map((agent: any) => (
                          <Button
                            key={agent.id}
                            variant={selectedAgent?.id === agent.id ? "default" : "outline"}
                            size="sm"
                            onClick={() => setSelectedAgent(agent)}
                            className="gap-2"
                          >
                            <Bot className="w-4 h-4" style={{ color: selectedAgent?.id === agent.id ? undefined : agent.avatar_color }} />
                            {agent.header_name || agent.codename}
                          </Button>
                        ))}
                      </div>

                      {/* Agent interaction */}
                      {selectedAgent ? (
                        <AgentInteraction agent={selectedAgent} />
                      ) : (
                        <div className="text-center text-muted-foreground py-8 border border-dashed rounded-lg">
                          <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
                          <p>Select an agent above to start a conversation</p>
                        </div>
                      )}
                    </div>
                  )}
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Workspace;
