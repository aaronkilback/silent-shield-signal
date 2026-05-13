-- F-019-A (2026-05-13): Neutralize the test agent WATCH-ALPHA-2.
--
-- The audit found a literal test agent (specialty='test specialty',
-- persona='test persona') in production. is_active was already false but
-- audit F-018 showed `is_active=false` is not enforced consistently
-- (Scout fired twice after deactivation).
--
-- Defense-in-depth: also delete the agent-router specialty embedding so
-- routing cannot surface this row regardless of the is_active flag.
--
-- Historical telemetry preserved: 32 autonomous_scan_results, 8
-- agent_beliefs rows referenced this agent. Hard-DELETE of the ai_agents
-- row would orphan those. Removing only the routing surface achieves the
-- security goal without data loss.
--
-- Already applied via MCP execute_sql; this file mirrors for git history.

DELETE FROM agent_specialty_embeddings WHERE call_sign = 'WATCH-ALPHA-2';
