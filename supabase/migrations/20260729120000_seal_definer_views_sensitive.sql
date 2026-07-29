-- WO-SENTINEL advisor item 1 (INC): SEAL SECURITY DEFINER views that re-expose RLS-sealed
-- tenant/client tables to anon/authenticated. Applied prod 2026-07-29.
revoke select on public.agent_actions_awaiting_approval from anon, authenticated;  -- over signals
revoke select on public.agent_actions_24h              from anon, authenticated;  -- over agent_actions
revoke select on public.stuck_documents                from anon, authenticated;  -- over archival_documents
