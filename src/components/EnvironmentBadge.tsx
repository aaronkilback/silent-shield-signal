import { Badge } from "@/components/ui/badge";
import { Shield, FlaskConical, Server } from "lucide-react";

type EnvironmentName = 'production' | 'staging' | 'test';

// #94 (2026-07-09) — ENVIRONMENT IS A BUILD-TIME FACT, not a runtime lookup.
//
// The bundle is built against exactly ONE Supabase project — VITE_SUPABASE_URL
// is inlined at build time (see integrations/supabase/client.ts) — so the
// environment is knowable SYNCHRONOUSLY: zero DB round-trip, zero react-query
// lifecycle, zero auth-attach race, zero cold-preview latency.
//
// This DELETES A FAILURE CATEGORY. The prior DB-read design produced THREE
// distinct badge outages in one week, all symptoms of treating a build-time
// constant as a runtime query:
//   • #66  — anon-null read cached as SUCCESS, staleTime pinned the badge absent
//   • #125 — the enabled:!!session / auth-attach retry race
//   • #94  — a successful but LATE read exceeding the assertion's render window
// A build-time derivation cannot exhibit any of them.
//
// environment_config is UNCHANGED and remains the runtime config store for other
// consumers (allow_untrusted_inputs, require_evidence, etc.) — ONLY the badge
// stops reading it. (The old DB-derived "• RELIABILITY FIRST" pill is dropped
// with the read; if that indicator is still wanted it should come from a
// build-time flag or a non-blocking surface, not gate the env label.)

// EXPLICIT, EXACT project-ref → environment map. Only these two refs are known
// real environments; the mapping is intentionally a hardcoded allowlist, not a
// heuristic, so it cannot silently mislabel.
const PROJECT_REF_ENV: Record<string, EnvironmentName> = {
  kpuqukppbmwebiptqmog: 'production', // prod
  lkvyrvuakzguszbpwnfz: 'staging',    // staging (aegis-staging)
};

function resolveEnvironment(): EnvironmentName {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  let ref = '';
  try {
    // project ref = first hostname label of `<ref>.supabase.co`
    ref = url ? new URL(url).hostname.split('.')[0] : '';
  } catch {
    ref = '';
  }
  // Anything that is NOT an exact known prod/staging ref → 'test'. Deliberate:
  // fail toward the LOUD, unmistakably-non-prod indicator (purple TEST) — never
  // hide the badge and never let an unrecognized env masquerade as PRODUCTION.
  return PROJECT_REF_ENV[ref] ?? 'test';
}

const environmentStyles: Record<EnvironmentName, {
  icon: typeof Shield;
  className: string;
  label: string;
}> = {
  production: {
    icon: Shield,
    className: "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700",
    label: "PRODUCTION"
  },
  staging: {
    icon: Server,
    className: "bg-amber-500 hover:bg-amber-600 text-black border-amber-600",
    label: "STAGING"
  },
  test: {
    icon: FlaskConical,
    className: "bg-purple-600 hover:bg-purple-700 text-white border-purple-700",
    label: "TEST"
  }
};

export const EnvironmentBadge = () => {
  // Synchronous, deterministic, always-rendered. No hooks, no data fetch.
  const style = environmentStyles[resolveEnvironment()];
  const Icon = style.icon;

  return (
    <Badge
      className={`${style.className} flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wider`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{style.label}</span>
    </Badge>
  );
};
