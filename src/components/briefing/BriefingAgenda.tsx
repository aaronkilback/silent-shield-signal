import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { 
  Loader2, Plus, Play, Check, SkipForward, Clock, GripVertical
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface BriefingAgendaProps {
  briefingId: string;
  isFacilitator: boolean;
}

interface AgendaItem {
  id: string;
  briefing_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  sort_order: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  presenter_user_id: string | null;
  created_at: string;
}

export function BriefingAgenda({ briefingId, isFacilitator }: BriefingAgendaProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItem, setNewItem] = useState({ title: '', description: '', duration_minutes: 5 });

  // Fetch agenda items
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['briefing-agenda', briefingId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('briefing_agenda_items')
        .select('*')
        .eq('briefing_id', briefingId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as AgendaItem[];
    },
    enabled: !!briefingId
  });

  // Add agenda item
  const addItem = useMutation({
    mutationFn: async () => {
      const maxOrder = items.length > 0 ? Math.max(...items.map(i => i.sort_order)) : 0;
      const { error } = await supabase
        .from('briefing_agenda_items')
        .insert({
          briefing_id: briefingId,
          title: newItem.title,
          description: newItem.description || null,
          duration_minutes: newItem.duration_minutes,
          sort_order: maxOrder + 1
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-agenda', briefingId] });
      setShowAddItem(false);
      setNewItem({ title: '', description: '', duration_minutes: 5 });
      toast.success("Agenda item added");
    },
    onError: () => toast.error("Failed to add item")
  });

  // Update item status
  const updateStatus = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: string; status: string }) => {
      const updates: any = { status };
      if (status === 'in_progress') updates.started_at = new Date().toISOString();
      if (status === 'completed' || status === 'skipped') updates.completed_at = new Date().toISOString();
      
      const { error } = await supabase
        .from('briefing_agenda_items')
        .update(updates)
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['briefing-agenda', briefingId] });
      toast.success("Agenda updated");
    }
  });

  const totalDuration = items.reduce((acc, item) => acc + (item.duration_minutes || 0), 0);
  const completedDuration = items
    .filter(i => i.status === 'completed' || i.status === 'skipped')
    .reduce((acc, item) => acc + (item.duration_minutes || 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base">Briefing Agenda</CardTitle>
          <p className="text-sm text-muted-foreground">
            {completedDuration} / {totalDuration} minutes completed
          </p>
        </div>
        {isFacilitator && (
          <Dialog open={showAddItem} onOpenChange={setShowAddItem}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="w-4 h-4 mr-1" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Agenda Item</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Topic</label>
                  <Input
                    value={newItem.title}
                    onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                    placeholder="Agenda topic"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Description (optional)</label>
                  <Input
                    value={newItem.description}
                    onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                    placeholder="Brief description"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Duration (minutes)</label>
                  <Input
                    type="number"
                    min={1}
                    value={newItem.duration_minutes}
                    onChange={(e) => setNewItem({ ...newItem, duration_minutes: parseInt(e.target.value) || 5 })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowAddItem(false)}>Cancel</Button>
                <Button 
                  onClick={() => addItem.mutate()}
                  disabled={!newItem.title || addItem.isPending}
                >
                  {addItem.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Add
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No agenda items yet</p>
            {isFacilitator && <p className="text-xs">Add topics to structure the briefing</p>}
          </div>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {items.map((item, index) => (
                <div 
                  key={item.id}
                  className={`p-3 rounded-lg border ${
                    item.status === 'in_progress' 
                      ? 'border-primary bg-primary/5' 
                      : item.status === 'completed' 
                        ? 'border-green-500/20 bg-green-500/5' 
                        : item.status === 'skipped'
                          ? 'border-muted bg-muted/20 opacity-50'
                          : 'border-border'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <span className="text-sm font-medium text-muted-foreground w-6">
                        {index + 1}.
                      </span>
                      <div>
                        <p className={`font-medium ${item.status === 'skipped' ? 'line-through' : ''}`}>
                          {item.title}
                        </p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground">{item.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>{item.duration_minutes} min</span>
                          {item.status === 'in_progress' && item.started_at && (
                            <>
                              <span>•</span>
                              <span>Started {format(new Date(item.started_at), 'HH:mm')}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <Badge variant={
                        item.status === 'in_progress' ? 'default' :
                        item.status === 'completed' ? 'secondary' :
                        item.status === 'skipped' ? 'outline' : 'outline'
                      }>
                        {item.status}
                      </Badge>
                      
                      {isFacilitator && item.status === 'pending' && (
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="h-7 w-7"
                          onClick={() => updateStatus.mutate({ itemId: item.id, status: 'in_progress' })}
                        >
                          <Play className="w-3 h-3" />
                        </Button>
                      )}
                      
                      {isFacilitator && item.status === 'in_progress' && (
                        <>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-7 w-7 text-green-500"
                            onClick={() => updateStatus.mutate({ itemId: item.id, status: 'completed' })}
                          >
                            <Check className="w-3 h-3" />
                          </Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-7 w-7"
                            onClick={() => updateStatus.mutate({ itemId: item.id, status: 'skipped' })}
                          >
                            <SkipForward className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
