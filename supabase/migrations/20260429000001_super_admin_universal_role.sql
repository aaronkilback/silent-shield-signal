-- Make super_admin satisfy any role check.
--
-- Background: 62 RLS policies across ~40 tables checked for 'analyst' and/or
-- 'admin' explicitly but did not include 'super_admin'. The akilback@hotmail.com
-- account (sole super_admin) was silently locked out of bug_reports, alerts,
-- clients, entities, knowledge base, reports, rules, user_roles, and many
-- other tables — every UPDATE/INSERT silently returned 0 rows because RLS
-- rejected the row, and the UI surfaced no error.
--
-- Rather than rewrite 62 policies, we make the has_role() helper treat
-- super_admin as a universal role: a user with super_admin returns true for
-- has_role(uid, ANY_ROLE). This matches the conventional "super_admin > admin"
-- semantics and is consistent with the 219 policies that already include
-- explicit super_admin checks (so this only widens behaviour for the gap;
-- it doesn't conflict with any existing rule).
--
-- Knock-on effects:
--   * Frontend useUserRole hook now reports isAdmin=true / isAnalyst=true
--     for super_admins. UI hides keyed on those flags now apply to super_admins.
--   * Any edge function calling has_role(uid, 'admin') for authorization
--     now lets super_admins through.
-- Both are intended.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND (
        role = _role
        OR role = 'super_admin'::app_role
      )
  );
$$;

-- Also tighten the bug_reports policies so they explicitly mention super_admin
-- (defensive depth — works even if has_role is later reverted).
DROP POLICY IF EXISTS "Analysts and admins can update bug reports" ON public.bug_reports;
DROP POLICY IF EXISTS "Privileged roles can update bug reports" ON public.bug_reports;
CREATE POLICY "Privileged roles can update bug reports"
ON public.bug_reports
FOR UPDATE
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

DROP POLICY IF EXISTS "Analysts and admins can view all bug reports" ON public.bug_reports;
DROP POLICY IF EXISTS "Privileged roles can view all bug reports" ON public.bug_reports;
CREATE POLICY "Privileged roles can view all bug reports"
ON public.bug_reports
FOR SELECT
USING (
  has_role(auth.uid(), 'analyst'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);
