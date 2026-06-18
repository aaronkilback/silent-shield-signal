/**
 * AegisCore — lightweight STATIC Aegis presence for the traveller intake (Slice D2).
 * A glowing chevron-shield emblem + "AEGIS CORE" label, recreating the design handoff's feel
 * (deep-space dark, electric-blue glow, inverted-V chevron) WITHOUT the animated <canvas> core —
 * the full neural/agent-constellation core is deferred to a later UI-polish slice per the brief.
 * Purely presentational: no data, no network, no agents.
 */
export function AegisCore({ size = 84, label = "AEGIS CORE", sub = "INTAKE ASSISTANT" }: { size?: number; label?: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 select-none">
      <div className="relative" style={{ width: size, height: size }}>
        {/* halo */}
        <div
          className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 50% 45%, rgba(94,155,255,.28), rgba(94,155,255,0) 70%)" }}
        />
        <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: "drop-shadow(0 0 10px rgba(94,155,255,.55))" }}>
          {/* shield */}
          <path
            d="M50 12 L82 26 L82 54 C82 76 64 88 50 92 C36 88 18 76 18 54 L18 26 Z"
            fill="rgba(40,70,130,.18)" stroke="#7ea8ff" strokeWidth="2" strokeLinejoin="round"
          />
          {/* inverted-V chevron emblem (white -> #9fc8ff) */}
          <path d="M34 64 L50 36 L66 64" fill="none" stroke="#dcebff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M41 64 L50 48 L59 64" fill="none" stroke="#9fc8ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        </svg>
      </div>
      <div className="font-mono text-xs tracking-[0.32em] text-[#8fb0ff]">{label}</div>
      <div className="font-mono text-[10px] tracking-[0.34em] text-[#5e6c86]">{sub}</div>
    </div>
  );
}
