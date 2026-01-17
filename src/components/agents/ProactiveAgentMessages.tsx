import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Volume2, VolumeX, X, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface PendingMessage {
  id: string;
  message: string;
  agent_id: string;
  sender_user_id: string;
  created_at: string;
  agent?: {
    codename: string;
    avatar_color: string;
    avatar_image: string | null;
  };
  sender?: {
    name: string;
  };
}

interface AgentPreference {
  agent_id: string | null;
  proactive_enabled: boolean;
  muted_until: string | null;
}

export function ProactiveAgentMessages() {
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<PendingMessage | null>(null);
  const [preferences, setPreferences] = useState<AgentPreference | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkForPendingMessages();
  }, []);

  const checkForPendingMessages = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check user preferences first
      const { data: prefs } = await supabase
        .from('user_agent_preferences')
        .select('*')
        .eq('user_id', user.id)
        .is('agent_id', null)
        .maybeSingle();

      if (prefs) {
        setPreferences(prefs);
        // If proactive is disabled globally, don't show messages
        if (!prefs.proactive_enabled) {
          setLoading(false);
          return;
        }
        // If muted and still within mute period
        if (prefs.muted_until && new Date(prefs.muted_until) > new Date()) {
          setLoading(false);
          return;
        }
      }

      // Fetch undelivered pending messages
      const { data: messages, error } = await supabase
        .from('agent_pending_messages')
        .select(`
          id,
          message,
          agent_id,
          sender_user_id,
          created_at
        `)
        .eq('recipient_user_id', user.id)
        .is('delivered_at', null)
        .is('dismissed_at', null)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching pending messages:', error);
        return;
      }

      if (messages && messages.length > 0) {
        // Fetch agent details separately
        const agentIds = [...new Set(messages.map(m => m.agent_id).filter(Boolean))];
        const senderIds = [...new Set(messages.map(m => m.sender_user_id).filter(Boolean))];

        const [agentsRes, sendersRes] = await Promise.all([
          agentIds.length > 0 
            ? supabase.from('ai_agents').select('id, codename, avatar_color, avatar_image').in('id', agentIds)
            : { data: [] },
          senderIds.length > 0
            ? supabase.from('profiles').select('id, name').in('id', senderIds)
            : { data: [] }
        ]);

        const agentsMap = new Map((agentsRes.data || []).map(a => [a.id, a]));
        const sendersMap = new Map((sendersRes.data || []).map(s => [s.id, s]));

        const enrichedMessages = messages.map(m => ({
          ...m,
          agent: m.agent_id ? agentsMap.get(m.agent_id) : undefined,
          sender: m.sender_user_id ? sendersMap.get(m.sender_user_id) : undefined
        }));

        setPendingMessages(enrichedMessages);
        
        // Show consent dialog for first message
        if (enrichedMessages.length > 0) {
          setCurrentMessage(enrichedMessages[0]);
          setShowConsentDialog(true);
        }
      }
    } catch (error) {
      console.error('Error checking pending messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const acceptMessage = async () => {
    if (!currentMessage) return;

    // Mark as delivered
    await supabase
      .from('agent_pending_messages')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', currentMessage.id);

    // Show toast with the message
    toast(
      <div className="flex items-start gap-3">
        <div 
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: currentMessage.agent?.avatar_color || '#6366f1' }}
        >
          {currentMessage.agent?.avatar_image ? (
            <img 
              src={currentMessage.agent.avatar_image} 
              alt={currentMessage.agent?.codename || 'Agent'} 
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <Shield className="h-4 w-4 text-white" />
          )}
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm">{currentMessage.agent?.codename || 'Agent'}</p>
          <p className="text-sm text-muted-foreground">{currentMessage.message}</p>
          {currentMessage.sender && (
            <p className="text-xs text-muted-foreground mt-1">
              — Requested by {currentMessage.sender.name}
            </p>
          )}
        </div>
      </div>,
      {
        duration: 10000,
      }
    );

    setShowConsentDialog(false);
    
    // Process next message if any
    const remaining = pendingMessages.filter(m => m.id !== currentMessage.id);
    setPendingMessages(remaining);
    
    if (remaining.length > 0) {
      setTimeout(() => {
        setCurrentMessage(remaining[0]);
        setShowConsentDialog(true);
      }, 1000);
    } else {
      setCurrentMessage(null);
    }
  };

  const dismissMessage = async () => {
    if (!currentMessage) return;

    await supabase
      .from('agent_pending_messages')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', currentMessage.id);

    setShowConsentDialog(false);
    
    const remaining = pendingMessages.filter(m => m.id !== currentMessage.id);
    setPendingMessages(remaining);
    
    if (remaining.length > 0) {
      setTimeout(() => {
        setCurrentMessage(remaining[0]);
        setShowConsentDialog(true);
      }, 500);
    } else {
      setCurrentMessage(null);
    }
  };

  const muteForHour = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const mutedUntil = new Date();
    mutedUntil.setHours(mutedUntil.getHours() + 1);

    await supabase
      .from('user_agent_preferences')
      .upsert({
        user_id: user.id,
        agent_id: null,
        proactive_enabled: true,
        muted_until: mutedUntil.toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,agent_id' });

    setShowConsentDialog(false);
    toast.info('Agent messages muted for 1 hour');
  };

  const disableProactive = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('user_agent_preferences')
      .upsert({
        user_id: user.id,
        agent_id: null,
        proactive_enabled: false,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,agent_id' });

    setShowConsentDialog(false);
    setPreferences({ agent_id: null, proactive_enabled: false, muted_until: null });
    toast.info('Proactive agent messages disabled. You can re-enable in settings.');
  };

  if (loading || !currentMessage) return null;

  return (
    <Dialog open={showConsentDialog} onOpenChange={setShowConsentDialog}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: currentMessage.agent?.avatar_color || '#6366f1' }}
            >
              {currentMessage.agent?.avatar_image ? (
                <img 
                  src={currentMessage.agent.avatar_image} 
                  alt={currentMessage.agent?.codename || 'Agent'} 
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <Shield className="h-5 w-5 text-white" />
              )}
            </div>
            <div>
              <DialogTitle>{currentMessage.agent?.codename || 'Agent'} has a message</DialogTitle>
              <DialogDescription>
                {currentMessage.sender 
                  ? `${currentMessage.sender.name} asked to send you a message`
                  : 'An agent wants to communicate with you'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4">
          <Card>
            <CardContent className="pt-4">
              <p className="text-sm">{currentMessage.message}</p>
            </CardContent>
          </Card>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 flex-1">
            <Button variant="outline" size="sm" onClick={muteForHour}>
              <VolumeX className="h-4 w-4 mr-1" />
              Mute 1hr
            </Button>
            <Button variant="outline" size="sm" onClick={disableProactive}>
              <X className="h-4 w-4 mr-1" />
              Disable
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={dismissMessage}>
              Dismiss
            </Button>
            <Button onClick={acceptMessage}>
              <Check className="h-4 w-4 mr-1" />
              Accept
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
