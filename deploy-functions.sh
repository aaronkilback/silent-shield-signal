#!/bin/bash
# Deploy pending edge function changes to kpuqukppbmwebiptqmog
# Run: npx supabase login   (once, to authenticate)
# Then: bash deploy-functions.sh

set -e
PROJECT_REF="kpuqukppbmwebiptqmog"

echo "Deploying edge functions to $PROJECT_REF..."

# New function
echo "→ autonomous-source-discovery (NEW)"
npx supabase functions deploy autonomous-source-discovery --project-ref "$PROJECT_REF" --no-verify-jwt

# Bug fixes
echo "→ monitor-entity-proximity (graceful degradation fix)"
npx supabase functions deploy monitor-entity-proximity --project-ref "$PROJECT_REF" --no-verify-jwt

echo "→ osint-collector (added discover-sources action)"
npx supabase functions deploy osint-collector --project-ref "$PROJECT_REF" --no-verify-jwt

# Signal quality improvements
echo "→ ingest-signal (severity_score + quality_score + source_key passed to scorer)"
npx supabase functions deploy ingest-signal --project-ref "$PROJECT_REF" --no-verify-jwt

# AI routing improvements + predictive score verification
echo "→ ai-decision-engine (27-agent routing + verifies predictive_incident_scores on escalation)"
npx supabase functions deploy ai-decision-engine --project-ref "$PROJECT_REF" --no-verify-jwt

# Feedback loop closure
echo "→ process-feedback (source_reliability_metrics + incident_outcomes + calibrate_analyst_accuracy)"
npx supabase functions deploy process-feedback --project-ref "$PROJECT_REF" --no-verify-jwt

echo ""
echo "→ Applying cron job migration..."
npx supabase db push --project-ref "$PROJECT_REF" --include-all 2>/dev/null || \
  echo "  (migration may already be applied or db push failed — check manually)"

echo ""
echo "All done. Now triggering source discovery (dry run first)..."
curl -s -X POST \
  "https://${PROJECT_REF}.supabase.co/functions/v1/autonomous-source-discovery" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwdXF1a3BwYm13ZWJpcHRxbW9nIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjY2MzAyMCwiZXhwIjoyMDg4MjM5MDIwfQ.2dYlHHA0NMu3-X5Q9-HmqG8xoX9KqsxqaciSHwsGXZs" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}' | python3 -m json.tool
