import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Loader2, Plus, Target, CheckCircle, Clock, AlertCircle, Bot, Sparkles
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";

interface BriefingTasksProps {
  workspaceId: string;
  briefingId: string;
}

interface Task {
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
  assignee_name?: string;
}

interface Member {
  user_id: string;
  name: string;
}

const STATUS_CONFIG: Record<string, { color: string; icon: any }> = {
  pending: { color: 'bg-yellow-500/10 text-yellow-500', icon: Clock },
  in_progress: { color: 'bg-blue-500/10 text-blue-500', icon: AlertCircle },
  completed: { color: 'bg-green-500/10 text-green-500', icon: CheckCircle }
};

export function BriefingTasks({ workspaceId, briefingId }: BriefingTasksProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAddTask, setShowAddTask] = useState(false);
  const [showAISuggest, setShowAISuggest] = useState(false);
  const [suggestInput, setSuggestInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [suggestedTask, setSuggestedTask] = useState<any>(null);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    assigned_to: '',
    priority: 'medium'
  });

  // Fetch tasks
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['workspace-tasks', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_tasks')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      
      // Fetch assignee names
      const assigneeIds = [...new Set(data.filter(t => t.assigned_to_user_id).map(t => t.assigned_to_user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', assigneeIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p.name]) || []);
      
      return data.map(t => ({
        ...t,
        assignee_name: t.assigned_to_user_id ? profileMap.get(t.assigned_to_user_id) : null
      })) as Task[];
    },
    enabled: !!workspaceId
  });

  // Fetch workspace members for assignment
  const { data: members = [] } = useQuery({
    queryKey: ['workspace-members', workspaceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', workspaceId);
      if (error) throw error;
      
      const userIds = data.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', userIds);
      
      return (profiles || []).map(p => ({ user_id: p.id, name: p.name || 'Unknown' })) as Member[];
    },
    enabled: !!workspaceId
  });

  // Add task
  const addTask = useMutation({
    mutationFn: async (taskData?: any) => {
      const data = taskData || newTask;
      const { error } = await supabase
        .from('workspace_tasks')
        .insert({
          workspace_id: workspaceId,
          title: data.title,
          description: data.description || null,
          assigned_to_user_id: data.assigned_to && data.assigned_to !== "__unassigned__" ? data.assigned_to : null,
          created_by_user_id: user?.id,
          status: 'pending'
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tasks', workspaceId] });
      setShowAddTask(false);
      setNewTask({ title: '', description: '', assigned_to: '', priority: 'medium' });
      setSuggestedTask(null);
      setShowAISuggest(false);
      toast.success("Task created");
    },
    onError: () => toast.error("Failed to create task")
  });

  // Update task status
  const updateStatus = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: string; status: string }) => {
      const updates: any = { status };
      if (status === 'completed') updates.completed_at = new Date().toISOString();
      
      const { error } = await supabase
        .from('workspace_tasks')
        .update(updates)
        .eq('id', taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-tasks', workspaceId] });
      toast.success("Task updated");
    }
  });

  // AI task suggestion (using BRAVO-1 concept)
  const generateTaskSuggestion = async () => {
    if (!suggestInput.trim()) return;
    
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-decision-engine', {
        body: {
          action: 'formalize_task',
          input: suggestInput,
          context: {
            workspaceId,
            briefingId,
            existingTasks: tasks.slice(0, 5).map(t => t.title),
            teamMembers: members.map(m => m.name)
          }
        }
      });

      if (error) throw error;

      // Parse AI response into structured task
      const suggestion = data?.task || {
        title: suggestInput,
        description: 'Task created from briefing discussion',
        priority: 'medium',
        suggested_assignee: null,
        rationale: 'User-defined task'
      };

      setSuggestedTask(suggestion);
    } catch (error: any) {
      // Fallback - create basic task from input
      setSuggestedTask({
        title: suggestInput,
        description: '',
        priority: 'medium',
        suggested_assignee: null,
        rationale: 'Created from briefing input'
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />
            Briefing Tasks
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {pendingTasks.length} pending, {inProgressTasks.length} in progress, {completedTasks.length} completed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={showAISuggest} onOpenChange={setShowAISuggest}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Sparkles className="w-4 h-4 mr-1" />
                AI Assist
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Bot className="w-5 h-5 text-primary" />
                  BRAVO-1 Task Assistant
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Describe what needs to be done</label>
                  <Textarea
                    value={suggestInput}
                    onChange={(e) => setSuggestInput(e.target.value)}
                    placeholder="e.g., Need to get the firewall logs from Server XYZ"
                    rows={3}
                  />
                </div>
                
                {!suggestedTask && (
                  <Button 
                    onClick={generateTaskSuggestion}
                    disabled={!suggestInput.trim() || isGenerating}
                    className="w-full"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 mr-1" />
                    )}
                    Formalize Task
                  </Button>
                )}

                {suggestedTask && (
                  <div className="p-4 rounded-lg border bg-primary/5">
                    <h4 className="font-medium mb-2">Suggested Task</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Title:</span>{' '}
                        <span className="font-medium">{suggestedTask.title}</span>
                      </div>
                      {suggestedTask.description && (
                        <div>
                          <span className="text-muted-foreground">Description:</span>{' '}
                          {suggestedTask.description}
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Priority:</span>{' '}
                        <Badge variant="outline">{suggestedTask.priority}</Badge>
                      </div>
                      {suggestedTask.rationale && (
                        <div className="text-xs text-muted-foreground italic mt-2">
                          Rationale: {suggestedTask.rationale}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => {
                  setShowAISuggest(false);
                  setSuggestInput("");
                  setSuggestedTask(null);
                }}>Cancel</Button>
                {suggestedTask && (
                  <Button 
                    onClick={() => addTask.mutate({
                      title: suggestedTask.title,
                      description: suggestedTask.description,
                      assigned_to: '',
                      priority: suggestedTask.priority
                    })}
                    disabled={addTask.isPending}
                  >
                    {addTask.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                    Create Task
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          <Dialog open={showAddTask} onOpenChange={setShowAddTask}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-1" />
                Add Task
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Task</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                    placeholder="Task title"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description (optional)</label>
                  <Textarea
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                    placeholder="Task details..."
                    rows={2}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Assign To</label>
                  <Select
                    value={newTask.assigned_to}
                    onValueChange={(v) => setNewTask({ ...newTask, assigned_to: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select team member" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned__">Unassigned</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.user_id} value={member.user_id}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddTask(false)}>Cancel</Button>
                <Button 
                  onClick={() => addTask.mutate(newTask)}
                  disabled={!newTask.title || addTask.isPending}
                >
                  {addTask.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No tasks yet</p>
            <p className="text-xs">Create tasks to track action items from the briefing</p>
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {tasks.map((task) => {
                const statusConfig = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
                const StatusIcon = statusConfig.icon;
                
                return (
                  <div 
                    key={task.id}
                    className="p-3 rounded-lg border"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge className={statusConfig.color}>
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {task.status.replace('_', ' ')}
                          </Badge>
                          {task.assignee_name && (
                            <span className="text-xs text-muted-foreground">
                              → {task.assignee_name}
                            </span>
                          )}
                        </div>
                        <p className="font-medium mt-1">{task.title}</p>
                        {task.description && (
                          <p className="text-sm text-muted-foreground">{task.description}</p>
                        )}
                        <div className="text-xs text-muted-foreground mt-1">
                          Created {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1">
                        {task.status === 'pending' && (
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => updateStatus.mutate({ taskId: task.id, status: 'in_progress' })}
                          >
                            Start
                          </Button>
                        )}
                        {task.status === 'in_progress' && (
                          <Button 
                            size="sm" 
                            variant="ghost"
                            className="text-green-500"
                            onClick={() => updateStatus.mutate({ taskId: task.id, status: 'completed' })}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Complete
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
