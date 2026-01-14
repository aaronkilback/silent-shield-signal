-- =============================================
-- FORTRESS AI INTEGRATION & API EXPANSION - PHASE 1
-- =============================================

-- 1. API Keys Table - For external system authentication
CREATE TABLE public.api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  key_hash TEXT NOT NULL UNIQUE, -- SHA256 hash of the API key (never store plaintext)
  key_prefix TEXT NOT NULL, -- First 8 chars for identification (e.g., "fai_abc1...")
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL, -- Optional: scope to specific client
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  permissions JSONB NOT NULL DEFAULT '["read:signals", "read:clients"]'::jsonb,
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. API Usage Logs - Track all API requests for observability
CREATE TABLE public.api_usage_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_time_ms INTEGER,
  request_params JSONB,
  ip_address TEXT,
  user_agent TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Webhooks Configuration Table
CREATE TABLE public.webhooks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  secret TEXT, -- HMAC signing secret
  auth_type TEXT DEFAULT 'none', -- 'none', 'bearer', 'api_key', 'basic'
  auth_credentials JSONB, -- Encrypted auth details
  trigger_events TEXT[] NOT NULL DEFAULT '{}', -- e.g., ['signal.critical', 'signal.client_match']
  filter_conditions JSONB, -- Optional: filter by client_id, severity, etc.
  output_format TEXT NOT NULL DEFAULT 'json', -- 'json', 'cef'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Webhook Delivery Logs - Track webhook deliveries with retry support
CREATE TABLE public.webhook_deliveries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  trigger_event TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'delivered', 'failed', 'retrying'
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ,
  response_status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. OAuth Clients Table - For OAuth 2.0 Client Credentials flow
CREATE TABLE public.oauth_clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name TEXT NOT NULL,
  client_id TEXT NOT NULL UNIQUE, -- OAuth client_id
  client_secret_hash TEXT NOT NULL, -- Hashed client secret
  redirect_uris TEXT[] DEFAULT '{}',
  scopes TEXT[] NOT NULL DEFAULT '{"read:signals", "read:clients"}',
  grant_types TEXT[] NOT NULL DEFAULT '{"client_credentials"}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. OAuth Access Tokens Table
CREATE TABLE public.oauth_access_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  oauth_client_id UUID NOT NULL REFERENCES public.oauth_clients(id) ON DELETE CASCADE,
  access_token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_access_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies for api_keys (admin only)
CREATE POLICY "Admins can manage API keys" ON public.api_keys
  FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for api_usage_logs (admin read-only)
CREATE POLICY "Admins can view API usage logs" ON public.api_usage_logs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for webhooks (admin only)
CREATE POLICY "Admins can manage webhooks" ON public.webhooks
  FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for webhook_deliveries (admin read-only)
CREATE POLICY "Admins can view webhook deliveries" ON public.webhook_deliveries
  FOR SELECT USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for oauth_clients (admin only)
CREATE POLICY "Admins can manage OAuth clients" ON public.oauth_clients
  FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- RLS Policies for oauth_access_tokens (system use only via service role)
CREATE POLICY "Service role manages OAuth tokens" ON public.oauth_access_tokens
  FOR ALL USING (false); -- Only accessible via service role

-- Indexes for performance
CREATE INDEX idx_api_keys_key_hash ON public.api_keys(key_hash);
CREATE INDEX idx_api_keys_key_prefix ON public.api_keys(key_prefix);
CREATE INDEX idx_api_keys_client_id ON public.api_keys(client_id);
CREATE INDEX idx_api_usage_logs_api_key_id ON public.api_usage_logs(api_key_id);
CREATE INDEX idx_api_usage_logs_created_at ON public.api_usage_logs(created_at DESC);
CREATE INDEX idx_webhooks_trigger_events ON public.webhooks USING GIN(trigger_events);
CREATE INDEX idx_webhook_deliveries_status ON public.webhook_deliveries(status);
CREATE INDEX idx_webhook_deliveries_next_retry ON public.webhook_deliveries(next_retry_at) WHERE status = 'retrying';
CREATE INDEX idx_oauth_access_tokens_hash ON public.oauth_access_tokens(access_token_hash);
CREATE INDEX idx_oauth_access_tokens_expires ON public.oauth_access_tokens(expires_at);

-- Triggers for updated_at
CREATE TRIGGER update_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_webhooks_updated_at
  BEFORE UPDATE ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_oauth_clients_updated_at
  BEFORE UPDATE ON public.oauth_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();