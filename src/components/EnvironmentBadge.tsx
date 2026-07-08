import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Shield, FlaskConical, Server } from "lucide-react";

type EnvironmentName = 'production' | 'staging' | 'test';

interface EnvironmentConfig {
  id: string;
  environment_name: EnvironmentName;
  is_active: boolean;
  allow_untrusted_inputs: boolean;
  require_evidence: boolean;
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
  // environment_config is readable ONLY by the `authenticated` role
  // (RLS policy environment_config_global_read, roles=authenticated). If this
  // query fires before the Supabase session is attached, it runs as `anon`,
  // RLS returns zero rows, `.maybeSingle()` yields data=null with no error,
  // and react-query caches that null as a SUCCESS — with staleTime it then
  // never refetches, so the badge stays absent even after auth completes.
  // The redesigned home (MinimalHeader) mounts early enough to lose that race.
  // Gate the query on an established session so it only ever runs authenticated
  // and never caches an anon-null (#66).
  const { session } = useAuthContext();

  const { data: envConfig } = useQuery({
    queryKey: ['environment-config'],
    queryFn: async () => {
      // Cast to any until types are regenerated for new table
      const { data, error } = await (supabase as any)
        .from('environment_config')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        // Silently handle - RLS may block unauthenticated users
        return null;
      }

      return data as EnvironmentConfig | null;
    },
    enabled: !!session,
    retry: false,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  if (!envConfig) {
    return null;
  }

  const style = environmentStyles[envConfig.environment_name] || environmentStyles.test;
  const Icon = style.icon;

  return (
    <Badge 
      className={`${style.className} flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wider`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{style.label}</span>
      {envConfig.require_evidence && (
        <span className="ml-1 text-[10px] opacity-80">• RELIABILITY FIRST</span>
      )}
    </Badge>
  );
};
