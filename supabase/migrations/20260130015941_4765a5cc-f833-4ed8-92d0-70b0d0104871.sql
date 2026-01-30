-- Create MFA settings table for users
CREATE TABLE public.user_mfa_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number TEXT,
  phone_verified BOOLEAN DEFAULT FALSE,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Create MFA verification codes table
CREATE TABLE public.mfa_verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_mfa_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_verification_codes ENABLE ROW LEVEL SECURITY;

-- Policies for user_mfa_settings
CREATE POLICY "Users can view their own MFA settings"
  ON public.user_mfa_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own MFA settings"
  ON public.user_mfa_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own MFA settings"
  ON public.user_mfa_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- Policies for mfa_verification_codes (only backend should manage, but users can read their own for debugging)
CREATE POLICY "Users can view their own codes"
  ON public.mfa_verification_codes FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can manage verification codes via edge functions
CREATE POLICY "Service role can manage codes"
  ON public.mfa_verification_codes FOR ALL
  USING (true)
  WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_user_mfa_settings_updated_at
  BEFORE UPDATE ON public.user_mfa_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for faster lookups
CREATE INDEX idx_mfa_codes_user_expires ON public.mfa_verification_codes(user_id, expires_at);
CREATE INDEX idx_mfa_settings_user ON public.user_mfa_settings(user_id);