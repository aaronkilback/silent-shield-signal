import {
  createServiceClient,
  errorResponse,
  getAccessibleClientIds,
  getCallerIdentity,
  handleCors,
  successResponse,
} from "../_shared/supabase-client.ts";
import { handleIncidentDecisionBriefRequest } from "../_shared/incident-decision-brief-handler.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  return handleIncidentDecisionBriefRequest(req, {
    createServiceClient,
    getCallerIdentity,
    getAccessibleClientIds,
    errorResponse,
    successResponse,
  });
});
