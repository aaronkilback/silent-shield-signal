// Aegis Operational State Integrity — persisted recommendation objects (C/D slice).
//
// Doctrine: "No persisted object → no claim." A recommend/propose/suggest tool that wants
// Aegis to be able to say "I've recorded recommendation [id]" MUST call recordRecommendation()
// and return the resulting object. If it does not persist, Aegis may only say "I can propose…"
// — never "recorded", "submitted", "pending approval", or "applied".
//
// C/D only: status='proposed'. Approval (E) + execution (F) are NOT performed here.

// deno-lint-ignore no-explicit-any
type SB = any;

export interface RecommendationInput {
  kind: string;                 // 'monitoring_keywords' | 'source_recommendation' | 'signal_merge' | 'playbook' | 'tactical_countermeasure' | 'policy_adjustment' | 'compliance_remediation'
  tenantId: string;             // owning tenant (required — Provenance Doctrine)
  clientId?: string;
  entityId?: string;
  title: string;
  payload: Record<string, unknown>;
  rationale?: string;
  actorUserId?: string;         // who generated it
  actorSurface?: "aegis" | "aegis_ops";
  provenance?: Record<string, unknown>;  // source/traversal trace
}

export interface RecommendationObject {
  id: string;
  kind: string;
  status: "proposed";
  title: string;
  target_tenant_id: string;
  target_client_id: string | null;
  target_entity_id: string | null;
  created_at: string;
  // Claim-discipline contract: callers/persona may state existence ONLY using these fields.
  claim: string;                // the ONLY operationally-truthful sentence to surface
}

/**
 * Persist a recommendation as a real operational object. Returns the object incl. its id.
 * The recommendation lands at status='proposed' — recorded, NOT approved, NOT applied.
 */
export async function recordRecommendation(sb: SB, input: RecommendationInput): Promise<RecommendationObject> {
  if (!input.tenantId) throw new Error("TENANT_CONTEXT_MISSING: a recommendation must be tenant-scoped.");
  const row = {
    kind: input.kind,
    target_tenant_id: input.tenantId,
    target_client_id: input.clientId ?? null,
    target_entity_id: input.entityId ?? null,
    title: input.title,
    payload: input.payload ?? {},
    rationale: input.rationale ?? null,
    status: "proposed",
    actor_user_id: input.actorUserId ?? null,
    actor_surface: input.actorSurface ?? "aegis",
    provenance: input.provenance ?? {},
    audit: [{ at: new Date().toISOString(), event: "created", status: "proposed", actor: input.actorUserId ?? null }],
  };
  const { data, error } = await sb.from("aegis_recommendations").insert(row).select(
    "id, kind, status, title, target_tenant_id, target_client_id, target_entity_id, created_at",
  ).single();
  if (error) throw new Error(`Failed to persist recommendation: ${error.message}`);
  return {
    ...data,
    // Operationally-truthful claim — recorded, explicitly NOT approved or applied.
    claim: `Recorded recommendation [rec:${data.id}] (status: proposed — not yet submitted for approval or applied).`,
  };
}
