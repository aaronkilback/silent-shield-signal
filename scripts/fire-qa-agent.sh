#!/bin/bash
# One-shot manual invocation of fortress-qa-agent.
# Verifies QA signals route to _qa_test_client (not Petronas).
#
# Requires: SUPABASE_SERVICE_ROLE_KEY in env. Source it from a
# .env.local or `supabase secrets list` rather than hardcoding —
# the previous version of this script committed a long-lived
# service-role JWT to the repo.

set -euo pipefail

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "error: SUPABASE_SERVICE_ROLE_KEY not set" >&2
  echo "  export SUPABASE_SERVICE_ROLE_KEY=...  (sb_secret_* preferred over legacy JWT)" >&2
  exit 1
fi

curl -X POST \
  "https://kpuqukppbmwebiptqmog.supabase.co/functions/v1/fortress-qa-agent" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  --max-time 120
