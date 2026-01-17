import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  const { data: envConfig, isLoading } = useQuery({
    queryKey: ['environment-config'],
    queryFn: async () => {
      // Cast to any until types are regenerated for new table
      const { data, error } = await (supabase as any)
        .from('environment_config')
        .select('*')
        .eq('is_active', true)
        .single();
      
      if (error) {
        console.error('[EnvironmentBadge] Error fetching config:', error);
        return null;
      }
      
      return data as EnvironmentConfig;
    }
  });

  if (isLoading || !envConfig) {
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
