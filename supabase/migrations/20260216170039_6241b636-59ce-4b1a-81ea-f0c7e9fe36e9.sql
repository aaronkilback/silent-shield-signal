
-- Add password age tracking to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_password_changed_at TIMESTAMPTZ DEFAULT now();

-- Set existing users to now (they'll have 90 days from this point)
UPDATE public.profiles SET last_password_changed_at = now() WHERE last_password_changed_at IS NULL;
