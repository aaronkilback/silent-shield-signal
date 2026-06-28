import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCreateInvestigationV2Args } from "@/lib/investigation-create-authority";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260628120000_create_investigation_v2_authority.sql"),
  "utf8"
);
const investigationsPage = readFileSync(join(root, "src/pages/Investigations.tsx"), "utf8");
const incidentsPage = readFileSync(join(root, "src/pages/Incidents.tsx"), "utf8");
const investigationAiAssist = readFileSync(join(root, "supabase/functions/investigation-ai-assist/index.ts"), "utf8");
const learnFromInvestigations = readFileSync(join(root, "supabase/functions/learn-from-investigations/index.ts"), "utf8");

describe("investigation create authority", () => {
  it("does not let the frontend submit or override privileged fields", () => {
    const args = buildCreateInvestigationV2Args({
      clientId: "client-a",
      templateId: "template-a",
      incidentId: null,
    });

    expect(args).toEqual({
      p_client_id: "client-a",
      p_template_id: "template-a",
      p_incident_id: null,
    });
    expect(args).not.toHaveProperty("file_number");
    expect(args).not.toHaveProperty("p_file_number");
    expect(args).not.toHaveProperty("p_prepared_by");
    expect(args).not.toHaveProperty("p_created_by_name");
    expect(args).not.toHaveProperty("p_tenant_id");
  });

  it("uses SECURITY DEFINER with a locked search path and explicit owner", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.create_investigation_v2");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path TO 'pg_catalog', 'pg_temp'");
    expect(migration).not.toContain("SET search_path TO 'public'");
    expect(migration).not.toContain("SET search_path = public");
    expect(migration).toContain("ALTER FUNCTION public.create_investigation_v2(uuid, uuid, uuid) OWNER TO postgres");
  });

  it("revokes broad execution and grants only authenticated", () => {
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.create_investigation_v2(uuid, uuid, uuid) FROM PUBLIC");
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.create_investigation_v2(uuid, uuid, uuid) FROM anon");
    expect(migration).toContain("REVOKE EXECUTE ON FUNCTION public.create_investigation_v2(uuid, uuid, uuid) FROM service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.create_investigation_v2(uuid, uuid, uuid) TO authenticated");
    expect(migration).not.toContain("GRANT EXECUTE ON FUNCTION public.create_investigation_v2(uuid, uuid, uuid) TO service_role");
  });

  it("derives actor identity and authorization server-side without dynamic SQL", () => {
    expect(migration).toContain("v_caller uuid := auth.uid()");
    expect(migration).toContain("caller is unauthenticated");
    expect(migration).toContain("public.get_user_accessible_client_ids(v_caller)");
    expect(migration).toContain("v_created_by_name");
    expect(migration).not.toContain("EXECUTE format");
    expect(migration).not.toContain("EXECUTE '");
    expect(migration).not.toContain("EXECUTE v_");
    expect(migration).not.toContain("p_file_number");
    expect(migration).not.toContain("p_prepared_by");
    expect(migration).not.toContain("p_created_by_name");
    expect(migration).not.toContain("p_tenant_id");
  });

  it("rejects client-null and cross-client templates before persistence", () => {
    expect(migration).toContain("IF v_template.client_id IS NULL THEN");
    expect(migration).toContain("template is not client-owned");
    expect(migration).toContain("IF v_template.client_id IS DISTINCT FROM p_client_id THEN");
    expect(migration.indexOf("template is not client-owned")).toBeLessThan(
      migration.indexOf("INSERT INTO public.investigations")
    );
  });

  it("validates incident client and tenant consistency before persistence", () => {
    expect(migration).toContain("v_incident.client_id IS NULL OR v_incident.client_id IS DISTINCT FROM p_client_id");
    expect(migration).toContain("v_incident.tenant_id IS NOT NULL AND v_incident.tenant_id IS DISTINCT FROM v_client.tenant_id");
    expect(migration.indexOf("incident is not eligible for selected client")).toBeLessThan(
      migration.indexOf("INSERT INTO public.investigations")
    );
  });

  it("generates the next global current-year number under an advisory lock", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("pg_catalog.hashtextextended('inv-file-number-' || v_year, 0)");
    expect(migration).toContain("MAX(");
    expect(migration).toContain("pg_catalog.regexp_replace(file_number");
    expect(migration).toContain("WHERE file_number ~ ('^INV-' || v_year || '-[0-9]+$')");
    expect(migration).toContain("pg_catalog.LPAD(v_next_n::text, 4, '0')");
  });

  it("removes browser-side file number generation and direct investigation inserts from create callers", () => {
    for (const source of [investigationsPage, incidentsPage]) {
      expect(source).not.toContain("INV-${year}");
      expect(source).not.toContain(".from('investigations')\n        .insert");
      expect(source).not.toContain(".from(\"investigations\")\n        .insert");
      expect(source).toContain(".rpc('create_investigation_v2'");
    }
  });

  it("keeps investigation template suggestions client-owned", () => {
    expect(investigationAiAssist).toContain("return successResponse({ templates: [] })");
    expect(investigationAiAssist).toContain(".eq('client_id', client_id)");
    expect(investigationAiAssist).not.toContain(".or(`client_id.is.null,client_id.eq.${client_id}`)");
  });

  it("prevents investigation learning from creating client-null templates", () => {
    expect(learnFromInvestigations).toContain("client_id is required for investigation template learning");
    expect(learnFromInvestigations).toContain("query.eq('client_id', clientId)");
    expect(learnFromInvestigations).toContain("client_id: clientId");
    expect(learnFromInvestigations).not.toContain("const clientId = body.client_id || null;\n\n    console.log");
  });
});
