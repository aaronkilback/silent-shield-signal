
-- ═══════════════════════════════════════════════════════════════
-- Investigation Communications: Multi-investigator SMS/Email tracking
-- ═══════════════════════════════════════════════════════════════

-- Track individual communication threads per investigator per case
CREATE TABLE public.investigation_communications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  investigator_user_id UUID NOT NULL REFERENCES public.profiles(id),
  
  -- Contact info
  contact_name TEXT,
  contact_identifier TEXT NOT NULL, -- phone number or email
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'email', 'voice')),
  
  -- Message content
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_body TEXT NOT NULL,
  
  -- Twilio/provider metadata
  provider_message_id TEXT, -- e.g. Twilio MessageSid
  provider_status TEXT, -- delivered, failed, etc.
  
  -- Platform number used (for multi-number support)
  platform_number TEXT,
  
  -- Auto-created investigation entry reference
  investigation_entry_id UUID REFERENCES public.investigation_entries(id),
  
  -- Tenant isolation
  tenant_id UUID REFERENCES public.tenants(id),
  
  -- Timestamps (message_timestamp = actual time of the communication)
  message_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX idx_inv_comms_investigation ON public.investigation_communications(investigation_id);
CREATE INDEX idx_inv_comms_investigator ON public.investigation_communications(investigator_user_id);
CREATE INDEX idx_inv_comms_contact ON public.investigation_communications(contact_identifier);
CREATE INDEX idx_inv_comms_timestamp ON public.investigation_communications(message_timestamp);
CREATE INDEX idx_inv_comms_tenant ON public.investigation_communications(tenant_id);
CREATE INDEX idx_inv_comms_channel_dir ON public.investigation_communications(channel, direction);

-- Enable RLS
ALTER TABLE public.investigation_communications ENABLE ROW LEVEL SECURITY;

-- RLS: Super admins can do everything
CREATE POLICY "Super admins full access to comms"
  ON public.investigation_communications
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- RLS: Admins and analysts can view all comms in their tenant
CREATE POLICY "Admins and analysts can view tenant comms"
  ON public.investigation_communications
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (SELECT unnest(public.get_user_tenant_ids(auth.uid())))
    AND (
      public.has_role(auth.uid(), 'admin') 
      OR public.has_role(auth.uid(), 'analyst')
    )
  );

-- RLS: Analysts can insert comms (send messages)
CREATE POLICY "Analysts can send messages"
  ON public.investigation_communications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    investigator_user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin') 
      OR public.has_role(auth.uid(), 'analyst')
    )
  );

-- RLS: Investigators can update their own messages (status updates)
CREATE POLICY "Investigators can update own comms"
  ON public.investigation_communications
  FOR UPDATE
  TO authenticated
  USING (investigator_user_id = auth.uid())
  WITH CHECK (investigator_user_id = auth.uid());

-- Updated_at trigger
CREATE TRIGGER update_inv_comms_updated_at
  BEFORE UPDATE ON public.investigation_communications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live message updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.investigation_communications;
