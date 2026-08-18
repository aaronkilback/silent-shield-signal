// subject-retrieval — the SHARED entry function for Module #1 (_shared/subject-retrieval.ts).
// The un-trapped caller: vip-deep-scan / AEGIS chat / entity Investigate / CRT all call THIS (or the
// module directly), so retrieval is never reimplemented inline. Caller passes subject + scope + owner;
// module does battery → verify → pivot → cluster → persist; returns exposure items. Report format,
// remediation, and trigger stay caller-side.
import {
  createServiceClient, handleCors, successResponse, errorResponse, getCallerIdentity, userCanAccessClient,
} from "../_shared/supabase-client.ts";
import { retrieveSubject } from "../_shared/subject-retrieval.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  try {
    const caller = await getCallerIdentity(req);
    if (caller.kind === "unauthorized") return errorResponse(caller.error, caller.status);

    const body = await req.json().catch(() => null);
    const subject = body?.subject;
    if (!subject?.name || String(subject.name).trim().length < 2) {
      return errorResponse("subject.name is required (min 2 chars)", 400);
    }
    const scope = body?.scope ?? {};
    const owner = body?.owner ?? {};
    const persist = body?.persist === true;

    const supabase = createServiceClient();

    // Authorization stays caller-side (module doesn't decide who may scan whom). If persisting to a
    // client, the user must be a member (or super_admin); service_role is trusted internal.
    let createdBy: string | null = null;
    if (caller.kind === "user") {
      createdBy = caller.userId;
      if (persist && owner?.clientId) {
        let ok = await userCanAccessClient(supabase, caller.userId, owner.clientId);
        if (!ok) {
          const { data: sa } = await supabase.from("user_roles").select("role").eq("user_id", caller.userId).eq("role", "super_admin").maybeSingle();
          ok = !!sa;
        }
        if (!ok) return errorResponse("CLIENT_NOT_AUTHORIZED: caller cannot access owner.clientId", 403);
      }
    }

    const result = await retrieveSubject(supabase, subject, scope, { persist, owner, createdBy });
    return successResponse(result);
  } catch (e) {
    console.error("[subject-retrieval] error:", e);
    return errorResponse(e instanceof Error ? e.message : "unknown error", 500);
  }
});
