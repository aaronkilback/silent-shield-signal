-- Flight-recorder additions (operator 2026-08-20). Applied to prod via MCP apply_migration; committed for
-- git<->ledger parity. Three columns the recorder now populates from dashboard-ai-assistant:
--   1. offered_tools        — the full tool menu offered to the model this request (names only). Forensics can
--                             see what Aegis COULD have called, not just what it did.
--   2. final_response_text  — the redacted final assistant text actually streamed to the user (+ sha256 of the
--                             full text). Previously only final_response_path (a status/pointer) was kept, so
--                             "what did Aegis say?" was unanswerable from a trace.
--   3. result_summary       — a redacted summary of WHAT a tool returned, beside returned_object_count.
alter table public.aegis_request_trace add column if not exists offered_tools jsonb;
alter table public.aegis_request_trace add column if not exists final_response_text text;
alter table public.aegis_request_trace add column if not exists final_response_sha256 text;
alter table public.aegis_tool_trace   add column if not exists result_summary jsonb;
