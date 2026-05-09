#!/bin/bash
# One-shot manual invocation of fortress-qa-agent.
# Verifies QA signals route to _qa_test_client (not Petronas).

curl -X POST \
  "https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/fortress-qa-agent" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs" \
  -H "Content-Type: application/json" \
  -d '{}' \
  --max-time 120
