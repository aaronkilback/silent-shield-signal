import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, X, Send, Loader2, Bug, CheckCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type BugSubmissionState = 'idle' | 'gathering' | 'ready' | 'submitting' | 'submitted';

export default function SupportChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Hi! I\'m your SOC platform assistant with access to our complete knowledge base. I can help you with:\n\n• Platform features and how-to guides\n• Troubleshooting common issues\n• Understanding signals, incidents, and entities\n• Configuring automation and OSINT sources\n• **Report bugs** - just describe the issue and I\'ll log it with full tracking!\n\nWhat would you like to know?',
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [bugState, setBugState] = useState<BugSubmissionState>('idle');
  const [submittedBugId, setSubmittedBugId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Subscribe to bug updates if we have a submitted bug
  useEffect(() => {
    if (!submittedBugId) return;

    const channel = supabase
      .channel(`bug-${submittedBugId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bug_reports',
          filter: `id=eq.${submittedBugId}`,
        },
        (payload) => {
          const bug = payload.new as any;
          if (bug.workflow_stage === 'verified' || bug.status === 'resolved') {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `🎉 Great news! Your bug report "${bug.title}" has been fixed and verified! The issue should no longer occur. Thank you for helping us improve the platform!`,
            }]);
            toast({
              title: "Bug Fixed!",
              description: `"${bug.title}" has been resolved.`,
            });
          } else if (bug.workflow_stage === 'fix_proposed') {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `📋 Update: A fix has been proposed for "${bug.title}". It's being reviewed and will be implemented soon.`,
            }]);
          } else if (bug.workflow_stage === 'testing') {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `🧪 Update: The fix for "${bug.title}" is now being tested to ensure it works correctly.`,
            }]);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [submittedBugId, toast]);

  const extractBugFromConversation = async (): Promise<any | null> => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/support-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ 
            messages,
            action: 'extract_bug'
          }),
        }
      );

      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('Error extracting bug:', error);
    }
    return null;
  };

  const submitBug = async () => {
    setBugState('submitting');
    
    try {
      // Get user info
      const { data: { user } } = await supabase.auth.getUser();
      
      // Extract bug details from conversation
      const bugDetails = await extractBugFromConversation();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/support-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ 
            messages,
            action: 'submit_bug',
            bugData: {
              ...bugDetails,
              page_url: window.location.href,
              browser_info: navigator.userAgent,
              email: user?.email,
            }
          }),
        }
      );

      const result = await response.json();
      
      if (result.success) {
        setBugState('submitted');
        setSubmittedBugId(result.bug_id);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ **Bug Report Created!**\n\nYour issue has been logged and assigned tracking ID. Here's what happens next:\n\n1. 🔍 **Investigation** - We'll analyze the issue\n2. 🔧 **Fix Development** - A solution will be developed\n3. 🧪 **Testing** - The fix will be verified\n4. 📣 **You'll be notified** - Right here in this chat when it's fixed!\n\nThank you for helping us improve the platform. Is there anything else I can help with?`,
        }]);
        toast({
          title: "Bug Report Submitted",
          description: "You'll be notified when it's fixed.",
        });
      } else {
        throw new Error(result.error || 'Failed to submit');
      }
    } catch (error) {
      console.error('Error submitting bug:', error);
      setBugState('idle');
      toast({
        title: "Error",
        description: "Failed to submit bug report. Please try again.",
        variant: "destructive",
      });
    }
  };

  const streamChat = async (userMessage: string) => {
    const newMessages = [...messages, { role: 'user' as const, content: userMessage }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/support-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ messages: newMessages }),
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          toast({
            title: "Rate Limit",
            description: "Too many requests. Please try again later.",
            variant: "destructive",
          });
          setMessages([...newMessages, {
            role: 'assistant',
            content: 'Sorry, I\'m receiving too many requests right now. Please try again in a moment.',
          }]);
          return;
        }
        if (response.status === 402) {
          toast({
            title: "Service Unavailable",
            description: "AI credits exhausted. Please contact support.",
            variant: "destructive",
          });
          setMessages([...newMessages, {
            role: 'assistant',
            content: 'Sorry, the AI service is temporarily unavailable. Please try again later or contact support.',
          }]);
          return;
        }
        throw new Error('Failed to start stream');
      }

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      let textBuffer = '';
      let streamDone = false;

      // Add empty assistant message that we'll update
      setMessages([...newMessages, { role: 'assistant', content: '' }]);

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            
            if (content) {
              assistantMessage += content;
              setMessages([...newMessages, { role: 'assistant', content: assistantMessage }]);
            }
          } catch {
            // Incomplete JSON, put it back
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (const raw of textBuffer.split('\n')) {
          if (!raw || raw.startsWith(':') || raw.trim() === '') continue;
          if (!raw.startsWith('data: ')) continue;
          
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              assistantMessage += content;
              setMessages([...newMessages, { role: 'assistant', content: assistantMessage }]);
            }
          } catch {
            // Ignore partial leftovers
          }
        }
      }

      // Check if AI indicated bug is ready to submit
      if (assistantMessage.includes('[BUG_READY]')) {
        setBugState('ready');
        // Remove the marker from displayed message
        const cleanMessage = assistantMessage.replace('[BUG_READY]', '').trim();
        setMessages([...newMessages, { role: 'assistant', content: cleanMessage }]);
      }

    } catch (error) {
      console.error('Chat error:', error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
      setMessages([...newMessages, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    streamChat(input.trim());
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
          size="icon"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      )}

      {/* Chat window */}
      {isOpen && (
        <Card className="fixed bottom-6 right-6 w-96 h-[600px] shadow-xl z-50 flex flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">Support Chat</CardTitle>
              <CardDescription className="text-xs">Ask anything or report bugs</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          
          <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
            <ScrollArea ref={scrollRef} className="flex-1 px-4">
              <div className="space-y-4 pb-4">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${
                      message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-4 py-2 overflow-hidden ${
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">{message.content}</p>
                    </div>
                  </div>
                ))}
                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-4 py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            <form onSubmit={handleSubmit} className="p-4 border-t space-y-2">
              {/* Bug submission button when ready */}
              {bugState === 'ready' && (
                <Button
                  type="button"
                  onClick={submitBug}
                  className="w-full bg-green-600 hover:bg-green-700"
                  disabled={isLoading}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Submit Bug Report
                </Button>
              )}
              
              {bugState === 'submitting' && (
                <div className="flex items-center justify-center py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating bug report...
                </div>
              )}

              {bugState === 'submitted' && submittedBugId && (
                <div className="flex items-center gap-2 p-2 bg-green-500/10 rounded text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  Bug tracked - you'll be notified when fixed
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your question or describe an issue..."
                  disabled={isLoading}
                  className="flex-1"
                />
                <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              
              <p className="text-xs text-muted-foreground text-center">
                Describe bugs naturally - I'll track them automatically
              </p>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}