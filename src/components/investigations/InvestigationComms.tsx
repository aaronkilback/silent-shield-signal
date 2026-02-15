import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  MessageSquare, Send, Phone, User, Loader2, ChevronLeft, Plus, ArrowUpRight, ArrowDownLeft, Mail, Copy, Check
} from "lucide-react";

interface InvestigationCommsProps {
  investigationId: string;
  fileNumber: string;
  intakeEmailTag?: string | null;
}

interface Contact {
  contact_identifier: string;
  contact_name: string | null;
  channel: string;
  last_message: string;
  last_timestamp: string;
  message_count: number;
  investigators: string[];
}

interface Communication {
  id: string;
  investigator_user_id: string;
  contact_identifier: string;
  contact_name: string | null;
  channel: string;
  direction: string;
  message_body: string;
  message_timestamp: string;
  provider_status: string | null;
}

export const InvestigationComms = ({ investigationId, fileNumber, intakeEmailTag }: InvestigationCommsProps) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showNewThread, setShowNewThread] = useState(false);
  const [newContactNumber, setNewContactNumber] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [copiedEmail, setCopiedEmail] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const intakeEmail = intakeEmailTag ? `${intakeEmailTag}@intake.yourdomain.com` : null;

  const handleCopyEmail = () => {
    if (intakeEmail) {
      navigator.clipboard.writeText(intakeEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  // Fetch all communications for this investigation
  const { data: commsData, isLoading } = useQuery({
    queryKey: ['investigation-comms', investigationId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('list-communications', {
        body: null,
        method: 'GET',
        headers: {},
      });
      // The edge function uses query params, so we call it differently
      const { data: result, error: fetchError } = await supabase
        .from('investigation_communications')
        .select('*')
        .eq('investigation_id', investigationId)
        .order('message_timestamp', { ascending: true });

      if (fetchError) throw fetchError;

      // Build contacts from raw data
      const contactMap = new Map<string, Contact>();
      for (const comm of result || []) {
        const key = `${comm.contact_identifier}_${comm.channel}`;
        const existing = contactMap.get(key);
        if (existing) {
          existing.message_count++;
          existing.last_message = comm.message_body;
          existing.last_timestamp = comm.message_timestamp;
          if (!existing.investigators.includes(comm.investigator_user_id)) {
            existing.investigators.push(comm.investigator_user_id);
          }
          if (comm.contact_name && !existing.contact_name) {
            existing.contact_name = comm.contact_name;
          }
        } else {
          contactMap.set(key, {
            contact_identifier: comm.contact_identifier,
            contact_name: comm.contact_name,
            channel: comm.channel,
            last_message: comm.message_body,
            last_timestamp: comm.message_timestamp,
            message_count: 1,
            investigators: [comm.investigator_user_id],
          });
        }
      }

      return {
        communications: result || [],
        contacts: Array.from(contactMap.values()).sort(
          (a, b) => new Date(b.last_timestamp).getTime() - new Date(a.last_timestamp).getTime()
        ),
      };
    },
    enabled: !!investigationId,
    refetchInterval: 15000, // Poll every 15s for new messages
  });

  const contacts = commsData?.contacts || [];
  const allMessages = commsData?.communications || [];

  // Filter messages for selected contact
  const threadMessages = selectedContact
    ? allMessages.filter(
        (m: any) =>
          m.contact_identifier === selectedContact.contact_identifier &&
          m.channel === selectedContact.channel
      )
    : [];

  // Auto-scroll to bottom when new messages appear
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threadMessages.length]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !user) return;

    const toNumber = selectedContact?.contact_identifier || newContactNumber;
    const contactName = selectedContact?.contact_name || newContactName || undefined;

    if (!toNumber) {
      toast.error("No recipient specified");
      return;
    }

    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: {
          investigation_id: investigationId,
          to_number: toNumber,
          message: newMessage,
          contact_name: contactName,
        },
      });

      if (error) throw error;

      toast.success("Message sent");
      setNewMessage("");
      setShowNewThread(false);
      setNewContactNumber("");
      setNewContactName("");

      // Refresh communications
      queryClient.invalidateQueries({ queryKey: ['investigation-comms', investigationId] });
      queryClient.invalidateQueries({ queryKey: ['investigation-entries', investigationId] });
    } catch (err: any) {
      console.error("[Comms] Send failed:", err);
      toast.error(err.message || "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // New thread form
  if (showNewThread && !selectedContact) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setShowNewThread(false)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <CardTitle className="text-lg">New SMS Thread</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Phone Number</label>
            <Input
              placeholder="+1 555 123 4567"
              value={newContactNumber}
              onChange={(e) => setNewContactNumber(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Contact Name (optional)</label>
            <Input
              placeholder="John Doe"
              value={newContactName}
              onChange={(e) => setNewContactName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Message</label>
            <Textarea
              placeholder="Type your message..."
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              rows={4}
            />
          </div>
          <Button
            onClick={handleSendMessage}
            disabled={isSending || !newMessage.trim() || !newContactNumber.trim()}
            className="w-full"
          >
            {isSending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> Send SMS</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Thread view — conversation with a selected contact
  if (selectedContact) {
    return (
      <Card className="flex flex-col h-[600px]">
        <CardHeader className="pb-3 border-b">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => setSelectedContact(null)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">
                  {selectedContact.contact_name || selectedContact.contact_identifier}
                </p>
                {selectedContact.contact_name && (
                  <p className="text-xs text-muted-foreground">{selectedContact.contact_identifier}</p>
                )}
              </div>
            </div>
            <div className="ml-auto text-xs text-muted-foreground">
              {selectedContact.investigators.length} investigator{selectedContact.investigators.length > 1 ? 's' : ''} · {selectedContact.message_count} messages
            </div>
          </div>
        </CardHeader>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {threadMessages.map((msg: any) => {
            const isOutbound = msg.direction === 'outbound';
            return (
              <div
                key={msg.id}
                className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    isOutbound
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.message_body}</p>
                  <div className={`flex items-center gap-1 mt-1 text-[10px] ${
                    isOutbound ? 'text-primary-foreground/70' : 'text-muted-foreground'
                  }`}>
                    {isOutbound ? (
                      <ArrowUpRight className="w-3 h-3" />
                    ) : (
                      <ArrowDownLeft className="w-3 h-3" />
                    )}
                    <span>{format(new Date(msg.message_timestamp), 'MMM d, HH:mm')}</span>
                    {msg.provider_status && (
                      <span className="ml-1">· {msg.provider_status}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Compose */}
        <div className="border-t p-3 flex gap-2">
          <Textarea
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            rows={1}
            className="min-h-[40px] resize-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
          />
          <Button
            size="icon"
            onClick={handleSendMessage}
            disabled={isSending || !newMessage.trim()}
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </Card>
    );
  }

  // Contact list view (default)
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            Communications
          </CardTitle>
          <Button size="sm" onClick={() => setShowNewThread(true)}>
            <Plus className="w-4 h-4 mr-1" />
            New Thread
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {intakeEmail && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-accent/30 border border-border">
            <Mail className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Email Intake Address</p>
              <p className="text-sm font-mono truncate text-foreground">{intakeEmail}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Forward emails here to auto-log as entries</p>
            </div>
            <Button variant="ghost" size="icon" onClick={handleCopyEmail} className="shrink-0">
              {copiedEmail ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        )}
        {contacts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No communications yet</p>
            <p className="text-sm mt-1">Start an SMS thread or forward emails to the intake address above</p>
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact) => (
              <div
                key={`${contact.contact_identifier}_${contact.channel}`}
                onClick={() => setSelectedContact(contact)}
                className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent/50 transition-colors border border-transparent hover:border-border"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  {contact.channel === 'sms' ? (
                    <Phone className="w-4 h-4 text-primary" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm truncate">
                      {contact.contact_name || contact.contact_identifier}
                    </p>
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                      {format(new Date(contact.last_timestamp), 'MMM d, HH:mm')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{contact.last_message}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">
                      {contact.message_count} msg{contact.message_count > 1 ? 's' : ''}
                    </span>
                    {contact.investigators.length > 1 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {contact.investigators.length} investigators
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
