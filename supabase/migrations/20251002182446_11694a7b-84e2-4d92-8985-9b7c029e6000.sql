-- Phase 1: Create Role-Based Access Control System
-- Step 1: Create user_roles table and security definer function
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (prevents RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Step 2: Migrate existing role data from profiles to user_roles
INSERT INTO public.user_roles (user_id, role, created_at)
SELECT id, role, created_at 
FROM public.profiles
WHERE role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- Step 3: Drop ALL existing policies that reference profiles.role
DROP POLICY IF EXISTS "All authenticated users can view clients" ON public.clients;
DROP POLICY IF EXISTS "Admins and analysts can manage clients" ON public.clients;
DROP POLICY IF EXISTS "All authenticated users can view signals" ON public.signals;
DROP POLICY IF EXISTS "Analysts and admins can manage signals" ON public.signals;
DROP POLICY IF EXISTS "All authenticated users can view incidents" ON public.incidents;
DROP POLICY IF EXISTS "Analysts and admins can manage incidents" ON public.incidents;
DROP POLICY IF EXISTS "All authenticated users can view alerts" ON public.alerts;
DROP POLICY IF EXISTS "Analysts and admins can manage alerts" ON public.alerts;
DROP POLICY IF EXISTS "All authenticated users can view escalation rules" ON public.escalation_rules;
DROP POLICY IF EXISTS "Analysts and admins can manage escalation rules" ON public.escalation_rules;
DROP POLICY IF EXISTS "All authenticated users can view sources" ON public.sources;
DROP POLICY IF EXISTS "Analysts and admins can manage sources" ON public.sources;
DROP POLICY IF EXISTS "All authenticated users can view rules" ON public.rules;
DROP POLICY IF EXISTS "Analysts and admins can manage rules" ON public.rules;
DROP POLICY IF EXISTS "All authenticated users can view reports" ON public.reports;
DROP POLICY IF EXISTS "Analysts and admins can manage reports" ON public.reports;
DROP POLICY IF EXISTS "All authenticated users can view attachments" ON public.attachments;
DROP POLICY IF EXISTS "Analysts and admins can manage attachments" ON public.attachments;
DROP POLICY IF EXISTS "All authenticated users can view improvements" ON public.improvements;
DROP POLICY IF EXISTS "Analysts and admins can manage improvements" ON public.improvements;
DROP POLICY IF EXISTS "All authenticated users can view outcomes" ON public.incident_outcomes;
DROP POLICY IF EXISTS "Analysts and admins can manage outcomes" ON public.incident_outcomes;
DROP POLICY IF EXISTS "All authenticated users can view playbooks" ON public.playbooks;
DROP POLICY IF EXISTS "Admins can manage playbooks" ON public.playbooks;
DROP POLICY IF EXISTS "All authenticated users can view metrics" ON public.automation_metrics;
DROP POLICY IF EXISTS "System can manage metrics" ON public.automation_metrics;

-- Step 4: Now safely remove role column from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;

-- Step 5: Create NEW RLS policies using has_role function

-- CLIENTS TABLE
CREATE POLICY "Analysts and admins can view clients"
ON public.clients FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins and analysts can manage clients"
ON public.clients FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- SIGNALS TABLE
CREATE POLICY "Analysts and admins can view signals"
ON public.signals FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage signals"
ON public.signals FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- INCIDENTS TABLE
CREATE POLICY "Analysts and admins can view incidents"
ON public.incidents FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage incidents"
ON public.incidents FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- ALERTS TABLE
CREATE POLICY "Analysts and admins can view alerts"
ON public.alerts FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage alerts"
ON public.alerts FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- ESCALATION RULES TABLE
CREATE POLICY "Analysts and admins can view escalation rules"
ON public.escalation_rules FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage escalation rules"
ON public.escalation_rules FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- SOURCES TABLE
CREATE POLICY "Analysts and admins can view sources"
ON public.sources FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage sources"
ON public.sources FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- RULES TABLE
CREATE POLICY "Analysts and admins can view rules"
ON public.rules FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage rules"
ON public.rules FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- REPORTS TABLE
CREATE POLICY "Analysts and admins can view reports"
ON public.reports FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage reports"
ON public.reports FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- ATTACHMENTS TABLE
CREATE POLICY "Analysts and admins can view attachments"
ON public.attachments FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage attachments"
ON public.attachments FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- IMPROVEMENTS TABLE
CREATE POLICY "Analysts and admins can view improvements"
ON public.improvements FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage improvements"
ON public.improvements FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- INCIDENT OUTCOMES TABLE
CREATE POLICY "Analysts and admins can view outcomes"
ON public.incident_outcomes FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Analysts and admins can manage outcomes"
ON public.incident_outcomes FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- PLAYBOOKS TABLE
CREATE POLICY "Analysts and admins can view playbooks"
ON public.playbooks FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage playbooks"
ON public.playbooks FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Phase 3: Secure System Metrics
-- AUTOMATION METRICS TABLE
CREATE POLICY "Service role can manage metrics"
ON public.automation_metrics FOR ALL
TO service_role
USING (true);

CREATE POLICY "Analysts and admins can view metrics"
ON public.automation_metrics FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'analyst') OR public.has_role(auth.uid(), 'admin'));

-- RLS policies for user_roles table
CREATE POLICY "Admins can view all user roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage user roles"
ON public.user_roles FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));