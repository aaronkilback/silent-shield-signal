import { Shield, Activity, CircleCheck, Radio } from "lucide-react";
import type { FortressHealth } from "@/hooks/useFortressHealth";
import type { SystemHealthStatus } from "@/hooks/useSystemHealth";

interface FortressStatusBarProps {
  health: FortressHealth | undefined;
  systemHealth: SystemHealthStatus | undefined;
  isLoading: boolean;
}

export function FortressStatusBar({ health, systemHealth, isLoading }: FortressStatusBarProps) {
  if (isLoading || !health) return null;

  const signalIntegrity = health.signalIntegrity.overall;
  const loopCoverage = Math.round(health.fortifyScore * 100);
  const runtimeStatus = systemHealth?.overallStatus ?? "healthy";

  const integrityColor = signalIntegrity >= 95 ? "#10b981" : signalIntegrity >= 80 ? "#f59e0b" : "#ef4444";
  const coverageColor = loopCoverage >= 80 ? "#10b981" : loopCoverage >= 50 ? "#f59e0b" : "#ef4444";
  const runtimeColor = runtimeStatus === "healthy" ? "#10b981" : runtimeStatus === "degraded" ? "#f59e0b" : "#ef4444";
  const runtimeLabel = runtimeStatus === "healthy" ? "Stable" : runtimeStatus === "degraded" ? "Degraded" : "Critical";

  return (
    <div className="absolute top-0 left-0 right-0 z-20 pointer-events-none">
      <div className="flex items-center justify-center gap-1 py-2 px-4 bg-card/60 backdrop-blur-xl border-b border-border/50">
        {/* Brand */}
        <div className="flex items-center gap-1.5 mr-4 pointer-events-auto">
          <Shield className="w-4 h-4 text-amber-400" />
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-amber-400">Fortress</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-semibold tracking-wider ml-1">
            PRODUCTION
          </span>
        </div>

        <div className="w-px h-5 bg-border/50 mx-2" />

        {/* Signal Integrity */}
        <StatusChip
          icon={<Activity className="w-3 h-3" />}
          label="SIGNAL INTEGRITY"
          value={`${signalIntegrity}%`}
          color={integrityColor}
        />

        <div className="w-px h-5 bg-border/50 mx-2" />

        {/* Loop Coverage */}
        <StatusChip
          icon={<CircleCheck className="w-3 h-3" />}
          label="LOOP COVERAGE"
          value={`${loopCoverage}%`}
          color={coverageColor}
        />

        <div className="w-px h-5 bg-border/50 mx-2" />

        {/* Runtime Confidence */}
        <StatusChip
          icon={<Radio className="w-3 h-3" />}
          label="RUNTIME CONFIDENCE"
          value={runtimeLabel}
          color={runtimeColor}
        />
      </div>
    </div>
  );
}

function StatusChip({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 pointer-events-auto">
      <span style={{ color }}>{icon}</span>
      <span className="text-[10px] tracking-wider text-muted-foreground font-medium">{label}</span>
      <span className="text-[11px] font-bold font-mono" style={{ color }}>{value}</span>
    </div>
  );
}
