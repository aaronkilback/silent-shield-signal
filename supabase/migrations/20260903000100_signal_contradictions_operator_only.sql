-- WO-CORRELATE-SIGNALS-TENANT-SCOPE: restrict signal_contradictions SELECT to operator-only.
--
-- Cross-client contradiction pairing is INTENTIONAL (operator ruling 2026-09-01) — the question
-- "do two sources disagree about the same fact?" does not respect client boundaries. That is safe
-- ONLY IF signal_contradictions is operator-only. The prior sc_sel policy let any authenticated user
-- who owned EITHER side of a pair read the whole row (naming the other client's signal + the
-- contradiction reasoning) — a cross-tenant disclosure path. Restrict to super_admin.
--
-- Impact:
--   - Frontend consumers: NONE (verified — only src/integrations/supabase/types.ts, a type def).
--   - Service-role consumers (system-watchdog, system-ops, ai-decision-engine) BYPASS RLS → unaffected.
--   - Tenant AI-assistant path (get_signal_contradictions) is separately containment-disabled.
--   - Currently 0 contradiction rows (forward-looking).

drop policy if exists sc_sel on public.signal_contradictions;

create policy sc_sel on public.signal_contradictions
  for select to authenticated
  using (is_super_admin(auth.uid()));
